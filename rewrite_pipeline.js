import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import OpenAI from "openai";
import {
  createDeepSeekChatRequest,
  getDeepSeekApiKey,
  getDeepSeekBaseUrl
} from "./deepseek_config.js";

const MAX_RETRIES = 5;

function getClient() {
  return new OpenAI({ apiKey: getDeepSeekApiKey(), baseURL: getDeepSeekBaseUrl() });
}

async function loadJson(filepath) {
  return JSON.parse(await fs.readFile(filepath, "utf8"));
}

async function readTxt(filepath) {
  try {
    return await fs.readFile(path.resolve(filepath), "utf8");
  } catch (error) {
    throw new Error(`读取失败，请确认文件为 UTF-8 编码: ${filepath}\n${error.message}`);
  }
}

async function writeTxt(filepath, content) {
  await fs.writeFile(filepath, content, "utf8");
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callLlm(client, messages, { jsonMode = false, temperature = 0.4 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const request = createDeepSeekChatRequest({ messages, jsonMode, temperature });
      const response = await client.chat.completions.create(request);
      const content = response.choices[0]?.message?.content ?? "";
      return jsonMode ? JSON.parse(content) : content.trim();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) break;
      await sleep(Math.min(2 ** attempt, 30) * 1000);
    }
  }
  throw new Error(`LLM 调用失败: ${lastError?.message ?? lastError}`);
}

function splitChapters(text, fallbackChunkChars) {
  const pattern = /^(第[零一二三四五六七八九十百千万\d]+[章节卷回部].*)$/gm;
  const matches = [...text.matchAll(pattern)];

  if (matches.length > 0) {
    const chapters = [];
    const preface = text.slice(0, matches[0].index).trim();
    if (preface) chapters.push({ title: "序章", content: preface });

    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index].index;
      const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
      chapters.push({
        title: matches[index][1].trim(),
        content: text.slice(start, end).trim()
      });
    }
    return chapters;
  }

  const parts = text.split(/(\n\s*\n)/);
  const chunks = [];
  let current = "";
  for (const part of parts) {
    if (current.length + part.length <= fallbackChunkChars) {
      current += part;
      continue;
    }
    if (current.trim()) chunks.push({ title: `分块${chunks.length + 1}`, content: current.trim() });
    current = part;
  }
  if (current.trim()) chunks.push({ title: `分块${chunks.length + 1}`, content: current.trim() });
  return chunks;
}

function compactConfig(projectConfig, customRules) {
  return JSON.stringify({ project_config: projectConfig, custom_rules: customRules }, null, 2);
}

async function analyzeMood(client, chapter, knowledgeBase, previousSummary) {
  const systemPrompt =
    "你是 Agent 0 基调识别。请分析性爱场景的类型和基调。" +
    "输出必须是 JSON 对象，包含 genre、emotional_core、mood、conflict、character_states、continuity_risks、rewrite_focus 字段。" +
    "保持客观，可以识别性爱场景的类型和功能，但不要生成具体描写。";
  const userPrompt =
    "请用 JSON 分析下面章节的基调、性爱类型、角色状态和改写重点。\n\n" +
    `知识库摘要：${JSON.stringify(knowledgeBase).slice(0, 6000)}\n\n` +
    `前文摘要：${previousSummary}\n\n章节标题：${chapter.title}\n\n原文：\n${chapter.content}`;

  return callLlm(
    client,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { jsonMode: true, temperature: 0.2 }
  );
}

async function agentTensionDirector(client, chapter, mood, projectConfig, customRules, previousFeedback) {
  const systemPrompt =
    "你是 Agent A 张力导演。请生成详细的色情分镜增强指令。" +
    "输出必须是 JSON 对象，包含 scene_beats、style_notes、must_keep、must_avoid、revision_notes 字段。";
  const userPrompt =
    "请用 JSON 给主笔生成详细的色情分镜指令，必须包括：\n" +
    "1）哪些动作需要慢镜头（如龟头分开阴唇、精液射入等）\n" +
    "2）用词切换红线（何时从雅称切换到\"骚屄\"\"鸡巴\"）\n" +
    "3）必须穿插的背德/反差心理描写点\n" +
    "4）要求补全动作链条，禁止概括跳跃\n\n" +
    `配置：${compactConfig(projectConfig, customRules)}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n` +
    `上一轮质检反馈：${previousFeedback || "无"}\n\n章节：${chapter.title}\n${chapter.content}`;

  return callLlm(
    client,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { jsonMode: true, temperature: 0.3 }
  );
}

async function agentWriter(
  client,
  chapter,
  mood,
  directorNotes,
  knowledgeBase,
  projectConfig,
  customRules,
  previousSummary,
  previousTail
) {
  const systemPrompt =
    "你是专业成人色情小说主笔人。严格遵循配置中的用词规则和比例要求。" +
    "你必须写出连续、直白、无比喻的性爱场面，色情描写占全文 40% 以上。" +
    "剧情过渡精简，环境仅用于烘托色情氛围。" +
    "写出放荡、羞耻、沉沦的心理反应。";
  const userPrompt =
    "请根据以下材料输出改写后的中文正文，不要输出解释。\n\n" +
    `配置：${compactConfig(projectConfig, customRules)}\n\n` +
    `知识库摘要：${JSON.stringify(knowledgeBase).slice(0, 6000)}\n\n` +
    `前文摘要：${previousSummary}\n\n前章结尾：${previousTail}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n导演指令：${JSON.stringify(directorNotes)}\n\n` +
    `原文章节：${chapter.title}\n${chapter.content}`;

  return callLlm(
    client,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { jsonMode: false, temperature: 0.55 }
  );
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

async function agentQa(client, rewritten, chapter, mood, projectConfig, customRules) {
  const forbiddenHits = localForbiddenScan(rewritten, customRules);
  const ratio = estimateSexRatio(rewritten);
  const systemPrompt =
    "你是 Agent C 质检打磨师。请检查禁用比喻词命中、动作连续性、用词合规、色情占比和语言质量。" +
    "输出必须是 JSON 对象，包含 passed、issues、revision_advice、summary、ending_tail 字段。";
  const userPrompt =
    "请用 JSON 质检。检查以下内容，不符合则 passed 设为 false：\n" +
    "1）禁用隐喻词命中（forbidden_metaphor_words 和 forbidden_elegant_words）\n" +
    "2）用词合规：是否在正确节点切换词汇（前戏适当雅称，交合用粗俗词）\n" +
    "3）动作连续性：是否从挑逗直接跳到抽插，缺少中间步骤\n" +
    "4）色情占比：通过 LLM 判断色情描写占比是否达到 35% 以上\n\n" +
    `配置：${compactConfig(projectConfig, customRules)}\n\n` +
    `本地禁用词命中：${JSON.stringify(forbiddenHits)}\n性描写句占比估算：${ratio}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n原文：${chapter.content.slice(0, 6000)}\n\n改写稿：${rewritten}`;

  const result = await callLlm(
    client,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { jsonMode: true, temperature: 0.2 }
  );

  if (forbiddenHits.length > 0) {
    result.passed = false;
    result.issues = Array.isArray(result.issues) ? result.issues : [];
    result.issues.push({ type: "forbidden_terms", terms: forbiddenHits });
  }
  if (ratio < 0.35) {
    result.passed = false;
    result.issues = Array.isArray(result.issues) ? result.issues : [];
    result.issues.push({ type: "sex_ratio_too_low", ratio, threshold: 0.35 });
  }
  return result;
}

async function summarizeProgress(client, previousSummary, chapterTitle, rewritten) {
  const systemPrompt =
    "你是连续性编辑。请把前文摘要和本章改写稿合并成简洁续写摘要。输出必须是 JSON 对象，包含 summary 字段。";
  const userPrompt =
    `请用 JSON 输出不超过 800 字的摘要，保留人物关系、未解决线索和下一章衔接点。\n\n旧摘要：${previousSummary}\n\n章节：${chapterTitle}\n\n改写稿：${rewritten}`;

  const data = await callLlm(
    client,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { jsonMode: true, temperature: 0.2 }
  );
  return String(data.summary ?? "").trim();
}

async function processNovel(txtPath, knowledgeBasePath) {
  const client = getClient();
  const projectConfig = await loadJson("project_config.json");
  const customRules = await loadJson("custom_rules.json");
  const knowledgeBase = await loadJson(knowledgeBasePath);
  const text = await readTxt(txtPath);

  const style = customRules.global_style ?? {};
  const fallbackChunkChars = Number(style.fallback_chunk_chars ?? 8000);
  const maxAttempts = Number(style.max_rewrite_attempts ?? 3);
  const contextTailChars = Number(style.context_tail_chars ?? 1200);

  const chapters = splitChapters(text, fallbackChunkChars);
  const rewrittenChapters = [];
  let previousSummary = "";
  let previousTail = "";

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    console.log(`处理 ${index + 1}/${chapters.length}: ${chapter.title}`);
    const mood = await analyzeMood(client, chapter, knowledgeBase, previousSummary);
    let feedback = "";
    let accepted = "";
    let draft = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      console.log(`  改写尝试 ${attempt}/${maxAttempts}`);
      const directorNotes = await agentTensionDirector(client, chapter, mood, projectConfig, customRules, feedback);
      draft = await agentWriter(
        client,
        chapter,
        mood,
        directorNotes,
        knowledgeBase,
        projectConfig,
        customRules,
        previousSummary,
        previousTail
      );
      const qaResult = await agentQa(client, draft, chapter, mood, projectConfig, customRules);
      if (Boolean(qaResult.passed)) {
        accepted = draft;
        break;
      }
      feedback = JSON.stringify(qaResult.revision_advice ?? qaResult);
    }

    if (!accepted) {
      console.log("  达到最大重试次数，使用最后一版并附带质检风险。");
      accepted = draft;
    }

    rewrittenChapters.push(accepted);
    previousSummary = await summarizeProgress(client, previousSummary, chapter.title, accepted);
    previousTail = accepted.slice(-contextTailChars);
    await writeTxt(`${path.basename(txtPath, path.extname(txtPath))}_rewrite_checkpoint.txt`, rewrittenChapters.join("\n\n"));
  }

  const outputPath = `${path.basename(txtPath, path.extname(txtPath))}_精修版.txt`;
  await writeTxt(outputPath, rewrittenChapters.join("\n\n"));
  return outputPath;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const txtPath = (await rl.question("请输入小说 TXT 路径: ")).trim().replace(/^"|"$/g, "");
  const knowledgeBasePath = (await rl.question("请输入知识库 JSON 路径: ")).trim().replace(/^"|"$/g, "");
  rl.close();

  const outputPath = await processNovel(txtPath, knowledgeBasePath);
  console.log(`改写完成: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
