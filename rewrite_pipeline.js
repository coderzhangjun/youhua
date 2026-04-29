import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import crypto from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import OpenAI from "openai";
import {
  createDeepSeekChatRequest,
  getDeepSeekApiKey,
  getDeepSeekBaseUrl
} from "./deepseek_config.js";

const MAX_RETRIES = 5;
const OUTPUT_ROOT = "outputs";
const MANIFEST_FILE = "manifest.json";
const EVENTS_FILE = "events.jsonl";
const FACTS_FILE = "facts_ledger.json";
const SUMMARY_FILE = "summary_state.json";

function getClient() {
  return new OpenAI({ apiKey: getDeepSeekApiKey(), baseURL: getDeepSeekBaseUrl() });
}

function nowIso() {
  return new Date().toISOString();
}

function timestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function safeTitle(filepath) {
  const title = path.basename(filepath, path.extname(filepath));
  return title.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "novel";
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function shortHash(content) {
  return sha256(content).slice(0, 12);
}

function safeLogPart(value) {
  return String(value ?? "unknown")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "unknown";
}

function countChars(value) {
  return typeof value === "string" ? value.length : JSON.stringify(value ?? "").length;
}

function compactConfig(projectConfig, customRules) {
  return JSON.stringify({ project_config: projectConfig, custom_rules: customRules }, null, 2);
}

async function pathExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readTxt(filepath) {
  const absolutePath = path.resolve(filepath);
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`读取失败，请确认文件为 UTF-8 编码: ${absolutePath}\n${error.message}`);
  }
}

async function loadJson(filepath) {
  return JSON.parse(await fs.readFile(filepath, "utf8"));
}

async function atomicWrite(filepath, content) {
  await ensureDir(path.dirname(filepath));
  const tempPath = `${filepath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filepath);
}

async function writeJson(filepath, data) {
  await atomicWrite(filepath, `${JSON.stringify(data, null, 2)}\n`);
}

function normalizeIssueList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function splitChapters(text, fallbackChunkChars) {
  const pattern = /^(第[零一二三四五六七八九十百千万\d]+[章节卷回部].*)$/gm;
  const matches = [...text.matchAll(pattern)];

  if (matches.length > 0) {
    const chapters = [];
    const preface = text.slice(0, matches[0].index).trim();
    if (preface) chapters.push({ title: "序章", content: preface, sourceStart: 0, sourceEnd: matches[0].index });

    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index].index;
      const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
      chapters.push({
        title: matches[index][1].trim(),
        content: text.slice(start, end).trim(),
        sourceStart: start,
        sourceEnd: end
      });
    }
    return chapters;
  }

  const parts = text.split(/(\n\s*\n)/);
  const chunks = [];
  let current = "";
  let start = 0;
  let cursor = 0;

  for (const part of parts) {
    if (current.length + part.length <= fallbackChunkChars) {
      current += part;
      cursor += part.length;
      continue;
    }
    if (current.trim()) chunks.push({ title: `分块${chunks.length + 1}`, content: current.trim(), sourceStart: start, sourceEnd: cursor });
    start = cursor;
    current = part;
    cursor += part.length;
  }

  if (current.trim()) chunks.push({ title: `分块${chunks.length + 1}`, content: current.trim(), sourceStart: start, sourceEnd: cursor });
  return chunks;
}

function chapterDirName(index, title) {
  return `${String(index + 1).padStart(3, "0")}_${title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40)}`;
}

class RunLogger {
  constructor(runDir) {
    this.runDir = runDir;
    this.eventsPath = path.join(runDir, EVENTS_FILE);
  }

  async event(level, type, data = {}) {
    const payload = {
      ts: nowIso(),
      level,
      type,
      ...data
    };
    await fs.appendFile(this.eventsPath, `${JSON.stringify(payload)}\n`, "utf8");

    const prefix = level === "error" ? "✖" : level === "warn" ? "!" : "·";
    const stage = data.stage ? `:${data.stage}` : "";
    const chapter = data.chapterTitle ? ` ${data.chapterTitle}` : "";
    const attempt = data.attempt ? ` 尝试${data.attempt}` : "";
    const detail = data.message ? ` - ${data.message}` : "";
    console.log(`${prefix} [${type}${stage}]${chapter}${attempt}${detail}`);
  }

  async saveJsonParseError({ stage, chapterIndex, chapterTitle, attempt, retry, content, error }) {
    const dir = path.join(this.runDir, "json_parse_errors");
    await ensureDir(dir);
    const filename = [
      String(chapterIndex ?? "x").padStart(3, "0"),
      safeLogPart(chapterTitle),
      safeLogPart(stage),
      attempt ? `attempt_${attempt}` : "no_attempt",
      `retry_${retry}`,
      `${Date.now()}.txt`
    ].join("__");
    const filepath = path.join(dir, filename);
    const payload = [
      `stage: ${stage ?? ""}`,
      `chapterIndex: ${chapterIndex ?? ""}`,
      `chapterTitle: ${chapterTitle ?? ""}`,
      `attempt: ${attempt ?? ""}`,
      `retry: ${retry ?? ""}`,
      `error: ${error.message}`,
      "",
      "----- RAW RESPONSE -----",
      content
    ].join("\n");
    await atomicWrite(filepath, payload);
    return filepath;
  }
}

async function callLlm(client, messages, {
  jsonMode = false,
  temperature = 0.4,
  logger,
  stage,
  chapterIndex,
  chapterTitle,
  attempt
} = {}) {
  let lastError = null;
  const promptChars = messages.reduce((sum, message) => sum + countChars(message.content), 0);

  for (let retry = 1; retry <= MAX_RETRIES; retry += 1) {
    const startedAt = Date.now();
    try {
      const request = createDeepSeekChatRequest({ messages, jsonMode, temperature });
      await logger?.event("info", "llm_start", {
        stage,
        chapterIndex,
        chapterTitle,
        attempt,
        retry,
        maxRetries: MAX_RETRIES,
        model: request.model,
        jsonMode,
        temperature,
        promptChars
      });

      const response = await client.chat.completions.create(request);
      const content = response.choices[0]?.message?.content ?? "";
      const durationMs = Date.now() - startedAt;
      await logger?.event("info", "llm_done", {
        stage,
        chapterIndex,
        chapterTitle,
        attempt,
        retry,
        durationMs,
        responseChars: content.length,
        finishReason: response.choices[0]?.finish_reason,
        usage: response.usage ?? null
      });

      if (!jsonMode) return content.trim();

      try {
        return JSON.parse(content);
      } catch (parseError) {
        const rawResponsePath = await logger?.saveJsonParseError({
          stage,
          chapterIndex,
          chapterTitle,
          attempt,
          retry,
          content,
          error: parseError
        });
        await logger?.event("warn", "json_parse_error", {
          stage,
          chapterIndex,
          chapterTitle,
          attempt,
          retry,
          rawResponsePath,
          message: `${parseError.message}; 已保存原始响应`
        });
        throw parseError;
      }
    } catch (error) {
      lastError = error;
      const durationMs = Date.now() - startedAt;
      await logger?.event(retry === MAX_RETRIES ? "error" : "warn", "llm_error", {
        stage,
        chapterIndex,
        chapterTitle,
        attempt,
        retry,
        durationMs,
        message: error.message
      });

      if (retry === MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** retry, 30) * 1000));
    }
  }

  throw new Error(`LLM 调用失败: ${lastError?.message ?? lastError}`);
}

async function analyzeMood(client, chapter, knowledgeBase, previousSummary, factsLedger, logger, meta) {
  const systemPrompt =
    "你是 Agent 0 基调识别。请分析性爱场景的类型和基调，把判断权建立在原文自身的文学理解上，不要套用固定套路。" +
    "输出必须是 JSON 对象，包含 genre、emotional_core、character_dynamic、mood、conflict、character_states、continuity_risks、rewrite_focus、tone_guardrails、non_erotic_compression 字段。" +
    "保持客观，可以识别性爱场景的类型和功能，但不要生成具体描写。";
  const userPrompt =
    "请用 JSON 分析下面章节的基调、性爱类型、角色状态和改写重点。\n" +
    "genre 可取 pure_love、ntr、dom_sub、incest、corruption、seduction、mixed、none 等；不要为了刺激强行改判。\n" +
    "emotional_core 写出这段场景真正的核心爽点；character_dynamic 写出角色权力关系。\n" +
    "tone_guardrails 必须说明哪些元素严禁加入，例如 pure_love 禁止强行加入背叛/丈夫/绿帽语义。\n" +
    "non_erotic_compression 必须列出本章哪些背景、环境、路人对白或设定可压缩，以及哪些硬伏笔必须保留。\n\n" +
    `知识库摘要：${JSON.stringify(knowledgeBase).slice(0, 6000)}\n\n` +
    `前文摘要：${previousSummary}\n\n章节标题：${chapter.title}\n\n原文：\n${chapter.content}\n\n` +
    `连续性参考（仅用于识别 continuity_risks，不改变上述分析任务）：${JSON.stringify(factsLedger).slice(0, 6000)}`;

  return callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.2,
    logger,
    stage: "mood",
    ...meta
  });
}

async function agentTensionDirector(client, chapter, mood, projectConfig, customRules, previousFeedback, logger, meta) {
  const systemPrompt =
    "你是 Agent A 张力导演。请生成详细的色情分镜增强指令。输出必须是 JSON 对象，" +
    "包含 scene_beats、style_notes、must_keep、must_avoid、revision_notes 字段。";
  const userPrompt =
    "请用 JSON 给主笔生成详细的色情分镜指令，必须包括：\n" +
    "1）哪些动作需要慢镜头（如龟头分开阴唇、精液射入等）\n" +
    "2）用词切换红线（何时从雅称切换到\"骚屄\"\"鸡巴\"）\n" +
    "3）必须穿插的背德/反差心理描写点\n" +
    "4）要求补全动作链条，禁止概括跳跃\n" +
    "5）根据基调分析决定是否使用反差感、背德感、禁欲符号色情化、身份倒错、罪恶快感增量；需要时自然触发，不需要时保持静默\n" +
    "6）精简所有无关色情剧情核心的过渡、环境、背景和路人对白；除非服务于色情张力、人物关系、禁忌提醒物或后续硬伏笔，否则压缩到1-3句\n" +
    "7）严禁引入与 Agent 0 判断出的 genre、emotional_core、character_dynamic 冲突的元素\n\n" +
    `配置：${compactConfig(projectConfig, customRules)}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n` +
    `上一轮质检反馈：${previousFeedback || "无"}\n\n` +
    `章节：${chapter.title}\n${chapter.content}`;

  return callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.3,
    logger,
    stage: "director",
    ...meta
  });
}

async function agentWriter(client, chapter, mood, directorNotes, knowledgeBase, projectConfig, customRules, previousSummary, previousTail, factsLedger, logger, meta) {
  const systemPrompt =
    "你是专业成人色情小说主笔人。严格遵循配置中的用词规则和比例要求。" +
    "你必须写出连续、直白、无比喻的性爱场面，色情描写占全文 40% 以上。" +
    "所有活动围绕色情剧情核心展开，所有剧情过渡精简优化，环境描写除非必不可少，不然仅服务于色情剧情。" +
    "写出放荡、羞耻、沉沦的心理反应。" +
    "必须忠实 Agent 0 的基调诊断：纯爱只强化甜蜜占有和亲密张力，背德只强化罪恶与沉迷撕裂，支配臣服只强化权力关系，不得跨类型硬套刺激元素。";
  const userPrompt =
    "请根据以下材料输出改写后的中文正文，不要输出解释。\n\n" +
    `配置：${compactConfig(projectConfig, customRules)}\n\n` +
    `知识库摘要：${JSON.stringify(knowledgeBase).slice(0, 6000)}\n\n` +
    `前文摘要：${previousSummary}\n\n前章结尾：${previousTail}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n` +
    `导演指令：${JSON.stringify(directorNotes)}\n\n` +
    `原文章节：${chapter.title}\n${chapter.content}\n\n` +
    `连续性护栏（仅用于避免前后文矛盾，不改变上述写作目标）：不得提前、删除或反转重大剧情事实；参考事实账本：${JSON.stringify(factsLedger).slice(0, 6000)}`;

  return callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: false,
    temperature: 0.55,
    logger,
    stage: "writer",
    ...meta
  });
}

function localForbiddenScan(text, customRules) {
  const keys = ["forbidden_metaphor_words", "forbidden_elegant_words"];
  const terms = keys.flatMap((key) => (Array.isArray(customRules[key]) ? customRules[key] : []));
  return [...new Set(terms.filter((term) => term && text.includes(term)))].sort();
}

function estimateSexRatio(text) {
  const markers = ["肏", "鸡巴", "小穴", "骚屄", "淫水", "阴唇", "龟头", "精液", "阴道", "阴蒂", "肉棒", "骚逼", "干", "插", "操", "抽插", "淫", "浪", "奶子", "乳头"];
  const sentences = text.split(/[。！？!?]/).filter((item) => item.trim());
  if (sentences.length === 0) return 0;
  const hits = sentences.filter((sentence) => markers.some((marker) => sentence.includes(marker))).length;
  return Number((hits / sentences.length).toFixed(3));
}

async function agentQa(client, rewritten, chapter, mood, projectConfig, customRules, logger, meta) {
  const forbiddenHits = localForbiddenScan(rewritten, customRules);
  const ratio = estimateSexRatio(rewritten);
  const systemPrompt =
    "你是 Agent C 质检打磨师。请检查禁用比喻词命中、动作连续性、用词合规、" +
    "色情占比、非色情剧情精简度、基调忠实度和语言质量。" +
    "输出必须是 JSON 对象，包含 passed、issues、revision_advice、summary、ending_tail 字段。";
  const userPrompt =
    "请用 JSON 质检。检查以下内容，不符合则 passed 设为 false：\n" +
    "1）禁用隐喻词命中（forbidden_metaphor_words 和 forbidden_elegant_words）\n" +
    "2）用词合规：是否在正确节点切换词汇（前戏适当雅称，交合用粗俗词）\n" +
    "3）动作连续性：是否从挑逗直接跳到抽插，缺少中间步骤\n" +
    "4）色情占比：通过 LLM 判断色情描写占比是否达到 35% 以上\n" +
    "5）非色情剧情是否冗余：背景、环境、路人对白、设定说明若不服务色情张力、人物关系、禁忌提醒物或后续硬伏笔，必须要求删减\n" +
    "6）基调是否被扭曲：不得把 pure_love 强行改成 ntr，也不得把背德戏洗成纯爱\n\n" +
    `配置：${compactConfig(projectConfig, customRules)}\n\n` +
    `本地禁用词命中：${JSON.stringify(forbiddenHits)}\n` +
    `性描写句占比估算：${ratio}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n原文：${chapter.content.slice(0, 6000)}\n\n改写稿：${rewritten}`;

  const result = await callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.2,
    logger,
    stage: "style_qa",
    ...meta
  });

  result.issues = normalizeIssueList(result.issues);
  if (forbiddenHits.length > 0) {
    result.passed = false;
    result.issues.push({ type: "forbidden_terms", terms: forbiddenHits });
  }
  if (ratio < 0.35) {
    result.passed = false;
    result.issues.push({ type: "sex_ratio_too_low", ratio, threshold: 0.35 });
  }
  return result;
}

async function agentContinuityQa(client, rewritten, chapter, mood, previousSummary, factsLedger, logger, meta) {
  const systemPrompt =
    "你是 Agent D 连续性审校。你的唯一职责是找剧情事实、人物关系、时间线、承诺、制度规则与前文账本的冲突。" +
    "不要评价文风。输出必须是 JSON 对象，包含 passed、severity、issues、revision_advice、facts_delta、risk_summary 字段。";
  const userPrompt =
    "请严格检查改写稿是否擅自新增、提前、删除或反转重大事实。尤其关注：第一次/已发生/未发生、关系身份、承诺契约、礼法制度、前后称谓与时间顺序。\n\n" +
    `前文摘要：${previousSummary || "无"}\n\n` +
    `剧情事实账本：${JSON.stringify(factsLedger).slice(0, 12000)}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n` +
    `原文章节：${chapter.title}\n${chapter.content.slice(0, 12000)}\n\n` +
    `改写稿：${rewritten}`;

  const result = await callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.1,
    logger,
    stage: "continuity_qa",
    ...meta
  });
  result.issues = normalizeIssueList(result.issues);
  return result;
}

async function updateFactsLedger(client, previousFacts, chapterTitle, original, rewritten, continuityQa, logger, meta) {
  const systemPrompt =
    "你是剧情事实账本维护员。请只记录稳定事实，不写正文。" +
    "输出必须是 JSON 对象，包含 facts、open_threads、relationship_states、timeline_notes、last_updated_chapter 字段。";
  const userPrompt =
    "请根据本章原文、改写稿和连续性质检结果，更新剧情事实账本。只保留对后文连续性有约束力的事实。\n\n" +
    `旧账本：${JSON.stringify(previousFacts).slice(0, 12000)}\n\n` +
    `章节：${chapterTitle}\n\n原文：${original.slice(0, 10000)}\n\n改写稿：${rewritten.slice(0, 10000)}\n\n连续性质检：${JSON.stringify(continuityQa)}`;

  return callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.1,
    logger,
    stage: "facts_update",
    ...meta
  });
}

async function summarizeProgress(client, previousSummary, chapterTitle, rewritten, logger, meta) {
  const systemPrompt =
    "你是连续性编辑。请把前文摘要和本章改写稿合并成简洁续写摘要。输出必须是 JSON 对象，包含 summary 字段。";
  const userPrompt =
    `请用 JSON 输出不超过 800 字的摘要，保留人物关系、未解决线索和下一章衔接点。\n\n旧摘要：${previousSummary}\n\n章节：${chapterTitle}\n\n改写稿：${rewritten}`;

  const data = await callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.2,
    logger,
    stage: "summary",
    ...meta
  });
  return String(data.summary ?? "").trim();
}

async function createRun(txtPath, knowledgeBasePath, text, projectConfig, customRules) {
  const novelTitle = safeTitle(txtPath);
  const runId = `${timestampForFilename()}_${novelTitle}_${shortHash(text)}`;
  const runDir = path.resolve(OUTPUT_ROOT, runId);
  const chaptersDir = path.join(runDir, "chapters");
  await ensureDir(chaptersDir);
  await atomicWrite(path.join(runDir, EVENTS_FILE), "");

  return {
    runId,
    runDir,
    chaptersDir,
    manifest: {
      runId,
      status: "running",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: {
        txtPath: path.resolve(txtPath),
        knowledgeBasePath: path.resolve(knowledgeBasePath),
        textHash: sha256(text)
      },
      config: {
        projectConfigHash: sha256(JSON.stringify(projectConfig)),
        customRulesHash: sha256(JSON.stringify(customRules))
      },
      chapters: []
    }
  };
}

async function loadRun(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const manifest = await loadJson(path.join(absoluteRunDir, MANIFEST_FILE));
  return {
    runId: manifest.runId,
    runDir: absoluteRunDir,
    chaptersDir: path.join(absoluteRunDir, "chapters"),
    manifest
  };
}

function initManifestChapters(manifest, chapters) {
  if (manifest.chapters.length > 0) return;
  manifest.chapters = chapters.map((chapter, index) => ({
    index,
    title: chapter.title,
    status: "pending",
    attempts: 0,
    sourceChars: chapter.content.length,
    sourceStart: chapter.sourceStart,
    sourceEnd: chapter.sourceEnd
  }));
}

async function saveManifest(run, extra = {}) {
  run.manifest.updatedAt = nowIso();
  Object.assign(run.manifest, extra);
  await writeJson(path.join(run.runDir, MANIFEST_FILE), run.manifest);
}

async function loadState(run) {
  const summaryPath = path.join(run.runDir, SUMMARY_FILE);
  const factsPath = path.join(run.runDir, FACTS_FILE);
  const summaryState = (await pathExists(summaryPath)) ? await loadJson(summaryPath) : { previousSummary: "", previousTail: "" };
  const factsLedger = (await pathExists(factsPath)) ? await loadJson(factsPath) : {
    facts: [],
    open_threads: [],
    relationship_states: [],
    timeline_notes: [],
    last_updated_chapter: null
  };
  return { summaryState, factsLedger };
}

async function rebuildAcceptedOutput(run) {
  const accepted = [];
  for (const chapter of run.manifest.chapters) {
    if (chapter.status !== "accepted" || !chapter.acceptedPath) continue;
    accepted.push(await fs.readFile(path.join(run.runDir, chapter.acceptedPath), "utf8"));
  }
  return accepted.join("\n\n");
}

async function processChapter(client, run, chapter, chapterIndex, total, projectConfig, customRules, knowledgeBase, state, maxAttempts, contextTailChars, allowForcedAcceptOnContinuityFailure, logger) {
  const chapterState = run.manifest.chapters[chapterIndex];
  const dir = path.join(run.chaptersDir, chapterDirName(chapterIndex, chapter.title));
  await ensureDir(dir);

  chapterState.status = "running";
  chapterState.startedAt = chapterState.startedAt || nowIso();
  await saveManifest(run);
  await logger.event("info", "chapter_start", {
    chapterIndex,
    chapterTitle: chapter.title,
    message: `${chapterIndex + 1}/${total} 原文字数 ${chapter.content.length}`
  });

  const meta = { chapterIndex, chapterTitle: chapter.title };
  const mood = await analyzeMood(client, chapter, knowledgeBase, state.summaryState.previousSummary, state.factsLedger, logger, meta);
  await writeJson(path.join(dir, "mood.json"), mood);

  let feedback = "";
  let accepted = "";
  let acceptedQa = null;
  let lastDraft = "";
  let lastStyleQa = null;
  let lastContinuityQa = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptMeta = { ...meta, attempt };
    await logger.event("info", "attempt_start", {
      ...attemptMeta,
      message: `${attempt}/${maxAttempts}`
    });

    const directorNotes = await agentTensionDirector(client, chapter, mood, projectConfig, customRules, feedback, logger, attemptMeta);
    await writeJson(path.join(dir, `attempt_${attempt}_director.json`), directorNotes);

    lastDraft = await agentWriter(
      client,
      chapter,
      mood,
      directorNotes,
      knowledgeBase,
      projectConfig,
      customRules,
      state.summaryState.previousSummary,
      state.summaryState.previousTail,
      state.factsLedger,
      logger,
      attemptMeta
    );
    await atomicWrite(path.join(dir, `attempt_${attempt}.txt`), lastDraft);

    lastStyleQa = await agentQa(client, lastDraft, chapter, mood, projectConfig, customRules, logger, attemptMeta);
    await writeJson(path.join(dir, `attempt_${attempt}_style_qa.json`), lastStyleQa);

    lastContinuityQa = await agentContinuityQa(client, lastDraft, chapter, mood, state.summaryState.previousSummary, state.factsLedger, logger, attemptMeta);
    await writeJson(path.join(dir, `attempt_${attempt}_continuity_qa.json`), lastContinuityQa);

    const passed = Boolean(lastStyleQa.passed) && Boolean(lastContinuityQa.passed);
    const styleIssueCount = normalizeIssueList(lastStyleQa.issues).length;
    const continuityIssueCount = normalizeIssueList(lastContinuityQa.issues).length;
    await logger.event(passed ? "info" : "warn", "attempt_result", {
      ...attemptMeta,
      passed,
      stylePassed: Boolean(lastStyleQa.passed),
      continuityPassed: Boolean(lastContinuityQa.passed),
      styleIssueCount,
      continuityIssueCount,
      draftChars: lastDraft.length,
      message: `style=${Boolean(lastStyleQa.passed)}(${styleIssueCount}), continuity=${Boolean(lastContinuityQa.passed)}(${continuityIssueCount}), draftChars=${lastDraft.length}`
    });

    chapterState.attempts = attempt;
    chapterState.lastStylePassed = Boolean(lastStyleQa.passed);
    chapterState.lastContinuityPassed = Boolean(lastContinuityQa.passed);
    await saveManifest(run);

    if (passed) {
      accepted = lastDraft;
      acceptedQa = { style: lastStyleQa, continuity: lastContinuityQa };
      break;
    }

    feedback = JSON.stringify({
      style_qa: lastStyleQa.revision_advice ?? lastStyleQa,
      continuity_qa: lastContinuityQa.revision_advice ?? lastContinuityQa
    });
  }

  if (!accepted) {
    const continuityPassed = Boolean(lastContinuityQa?.passed);
    if (!continuityPassed && !allowForcedAcceptOnContinuityFailure) {
      const failureQa = { style: lastStyleQa, continuity: lastContinuityQa, forced_accept_blocked: true };
      const failedQaPath = path.join(dir, "failed_qa.json");
      await writeJson(failedQaPath, failureQa);

      chapterState.status = "failed";
      chapterState.finishedAt = nowIso();
      chapterState.failedReason = "continuity_qa_failed";
      chapterState.qaPath = path.relative(run.runDir, failedQaPath).replaceAll("\\", "/");
      chapterState.risks = {
        style: normalizeIssueList(lastStyleQa?.issues),
        continuity: normalizeIssueList(lastContinuityQa?.issues)
      };
      await saveManifest(run, { status: "failed" });

      await logger.event("error", "chapter_failed", {
        chapterIndex,
        chapterTitle: chapter.title,
        stylePassed: Boolean(lastStyleQa?.passed),
        continuityPassed,
        message: "连续性质检未通过，已停止流水线；请查看 failed_qa.json 和各 attempt_*_continuity_qa.json"
      });

      throw new Error(`章节「${chapter.title}」连续性质检未通过，已停止以避免污染后文。`);
    }

    accepted = lastDraft;
    acceptedQa = { style: lastStyleQa, continuity: lastContinuityQa, forced_accept: true };
    await logger.event("warn", "forced_accept", {
      chapterIndex,
      chapterTitle: chapter.title,
      stylePassed: Boolean(lastStyleQa?.passed),
      continuityPassed,
      message: "达到最大重试次数，使用最后一版并保留风格质检风险"
    });
  }

  const acceptedPath = path.join(dir, "accepted.txt");
  const qaPath = path.join(dir, "accepted_qa.json");
  await atomicWrite(acceptedPath, accepted);
  await writeJson(qaPath, acceptedQa);

  const factsLedger = await updateFactsLedger(client, state.factsLedger, chapter.title, chapter.content, accepted, acceptedQa.continuity, logger, meta);
  const previousSummary = await summarizeProgress(client, state.summaryState.previousSummary, chapter.title, accepted, logger, meta);
  const previousTail = accepted.slice(-contextTailChars);

  state.factsLedger = factsLedger;
  state.summaryState = { previousSummary, previousTail, updatedAt: nowIso(), chapterTitle: chapter.title };
  await writeJson(path.join(run.runDir, FACTS_FILE), state.factsLedger);
  await writeJson(path.join(run.runDir, SUMMARY_FILE), state.summaryState);

  chapterState.status = "accepted";
  chapterState.finishedAt = nowIso();
  chapterState.acceptedPath = path.relative(run.runDir, acceptedPath).replaceAll("\\", "/");
  chapterState.qaPath = path.relative(run.runDir, qaPath).replaceAll("\\", "/");
  chapterState.acceptedChars = accepted.length;
  chapterState.forcedAccept = Boolean(acceptedQa.forced_accept);
  chapterState.risks = {
    style: normalizeIssueList(acceptedQa.style?.issues),
    continuity: normalizeIssueList(acceptedQa.continuity?.issues)
  };
  await saveManifest(run);

  const checkpoint = await rebuildAcceptedOutput(run);
  await atomicWrite(path.join(run.runDir, "rewrite_checkpoint.txt"), checkpoint);
  await logger.event("info", "chapter_done", {
    chapterIndex,
    chapterTitle: chapter.title,
    message: `已写入 checkpoint，累计 ${run.manifest.chapters.filter((item) => item.status === "accepted").length}/${total}`
  });
}

async function processNovel(txtPath, knowledgeBasePath, resumeRunDir = "") {
  const client = getClient();
  const projectConfig = await loadJson("project_config.json");
  const customRules = await loadJson("custom_rules.json");
  const knowledgeBase = await loadJson(knowledgeBasePath);
  const text = await readTxt(txtPath);

  const style = customRules.global_style ?? {};
  const fallbackChunkChars = Number(style.fallback_chunk_chars ?? 8000);
  const maxAttempts = Number(style.max_rewrite_attempts ?? 3);
  const contextTailChars = Number(style.context_tail_chars ?? 1200);
  const allowForcedAcceptOnContinuityFailure = Boolean(style.allow_forced_accept_on_continuity_failure ?? false);
  const chapters = splitChapters(text, fallbackChunkChars);

  const run = resumeRunDir
    ? await loadRun(resumeRunDir)
    : await createRun(txtPath, knowledgeBasePath, text, projectConfig, customRules);
  if (resumeRunDir && run.manifest.source?.textHash && run.manifest.source.textHash !== sha256(text)) {
    throw new Error("断点续跑失败：当前输入 TXT 与运行目录中的原文 hash 不一致。请确认输入的是同一本小说。");
  }
  if (resumeRunDir && run.manifest.totalChapters && run.manifest.totalChapters !== chapters.length) {
    throw new Error("断点续跑失败：当前章节切分数量与运行目录记录不一致。请确认规则和原文未变化。");
  }
  const logger = new RunLogger(run.runDir);

  initManifestChapters(run.manifest, chapters);
  run.manifest.totalChapters = chapters.length;
  run.manifest.options = {
    fallbackChunkChars,
    maxAttempts,
    contextTailChars,
    allowForcedAcceptOnContinuityFailure
  };
  await saveManifest(run);

  await logger.event("info", resumeRunDir ? "run_resume" : "run_start", {
    runId: run.runId,
    message: `运行目录 ${run.runDir}`
  });
  await logger.event("info", "chapter_split", {
    totalChapters: chapters.length,
    message: `共 ${chapters.length} 个章节/分块`
  });

  const state = await loadState(run);
  for (let index = 0; index < chapters.length; index += 1) {
    const chapterState = run.manifest.chapters[index];
    if (chapterState?.status === "accepted") {
      await logger.event("info", "chapter_skip", {
        chapterIndex: index,
        chapterTitle: chapters[index].title,
        message: "断点续跑跳过已完成章节"
      });
      continue;
    }

    await processChapter(
      client,
      run,
      chapters[index],
      index,
      chapters.length,
      projectConfig,
      customRules,
      knowledgeBase,
      state,
      maxAttempts,
      contextTailChars,
      allowForcedAcceptOnContinuityFailure,
      logger
    );
  }

  const finalText = await rebuildAcceptedOutput(run);
  const outputPath = path.join(run.runDir, `${safeTitle(txtPath)}_精修版.txt`);
  await atomicWrite(outputPath, finalText);
  run.manifest.status = "completed";
  run.manifest.completedAt = nowIso();
  run.manifest.outputPath = path.relative(run.runDir, outputPath).replaceAll("\\", "/");
  await saveManifest(run);
  await logger.event("info", "run_done", { runId: run.runId, message: `改写完成 ${outputPath}` });
  return outputPath;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const txtPath = (await rl.question("请输入小说 TXT 路径: ")).trim().replace(/^"|"$/g, "");
  const knowledgeBasePath = (await rl.question("请输入知识库 JSON 路径: ")).trim().replace(/^"|"$/g, "");
  const resumeRunDir = (await rl.question("如需断点续跑，请输入已有运行目录；直接回车则新建运行: ")).trim().replace(/^"|"$/g, "");
  rl.close();

  const outputPath = await processNovel(txtPath, knowledgeBasePath, resumeRunDir);
  console.log(`改写完成: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
