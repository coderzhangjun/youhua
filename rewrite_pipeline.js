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

function normalizeSeverity(value) {
  return String(value ?? "").trim().toLowerCase();
}

function continuitySeverity(qa) {
  const rootSeverity = normalizeSeverity(qa?.severity);
  const issueSeverities = normalizeIssueList(qa?.issues)
    .map((issue) => normalizeSeverity(issue?.severity ?? issue?.level ?? issue?.risk))
    .filter(Boolean);
  return [rootSeverity, ...issueSeverities].filter(Boolean);
}

function isBlockingContinuityQa(qa, blockingSeverities) {
  if (Boolean(qa?.passed)) return false;
  const blockingSet = new Set(blockingSeverities.map((item) => normalizeSeverity(item)));
  const severities = continuitySeverity(qa);
  if (severities.length === 0) return true;
  return severities.some((severity) => blockingSet.has(severity));
}

function shouldEnforceSexRatio(mood) {
  const genre = normalizeSeverity(mood?.genre);
  const sceneContentType = normalizeSeverity(mood?.scene_content_type);
  const guardrails = JSON.stringify(mood?.tone_guardrails ?? "");
  if (sceneContentType) return sceneContentType === "explicit_sex";
  if (genre === "none") return false;
  if (genre === "pure_love" && (guardrails.includes("禁止加入任何性爱描写") || guardrails.includes("禁止性描写"))) return false;
  if (guardrails.includes("禁止加入任何性爱描写") || guardrails.includes("禁止性描写")) return false;
  return false;
}

function requiredItemCount(sourceObligations) {
  return normalizeIssueList(sourceObligations?.required_items).length;
}

function maxOutputRatioForChapter(mood, customRules, sourceObligations) {
  const style = customRules.global_style ?? {};
  const sceneContentType = normalizeSeverity(mood?.scene_content_type);
  if (sceneContentType === "explicit_sex") return null;
  if (sceneContentType === "plot_setup" || sceneContentType === "action_or_worldbuilding") {
    if (requiredItemCount(sourceObligations) >= Number(style.dense_obligation_min_count ?? 8)) {
      return Number(style.dense_plot_setup_max_output_ratio ?? 0.55);
    }
    return Number(style.plot_setup_max_output_ratio ?? 0.45);
  }
  return Number(style.non_erotic_max_output_ratio ?? 0.5);
}

function normalizeCoverageAudit(audit) {
  const missingRequiredItems = normalizeIssueList(audit?.missing_required_items);
  const normalized = {
    ...(audit ?? {}),
    missing_required_items: missingRequiredItems
  };
  if (missingRequiredItems.length > 0) {
    normalized.passed = false;
    normalized.severity = normalized.severity ?? "major";
    normalized.root_cause = normalized.root_cause ?? "覆盖率审计发现 required_items 缺失。";
    normalized.next_revision_orders = normalizeIssueList(normalized.next_revision_orders);
  }
  return normalized;
}

function auditSeverity(audit) {
  const rootSeverity = normalizeSeverity(audit?.severity);
  const issueSeverities = normalizeIssueList(audit?.missing_required_items)
    .map((issue) => normalizeSeverity(issue?.severity ?? issue?.level ?? issue?.risk))
    .filter(Boolean);
  return [rootSeverity, ...issueSeverities].filter(Boolean);
}

function isBlockingCoverageAudit(audit, blockingSeverities) {
  if (!audit || Boolean(audit?.passed)) return false;
  const blockingSet = new Set(blockingSeverities.map((item) => normalizeSeverity(item)));
  const severities = auditSeverity(audit);
  if (severities.length === 0) return true;
  return severities.some((severity) => blockingSet.has(severity));
}

function normalizeDecision(value) {
  return String(value ?? "").trim().toLowerCase();
}

function shouldStopForRepairPlan(plan) {
  const decision = normalizeDecision(plan?.decision);
  return decision === "stop_for_system_bug" || decision === "stop_unrecoverable";
}

function shouldAcceptWithRisk(plan) {
  return normalizeDecision(plan?.decision) === "accept_with_risk";
}

function issueHasType(issue, type) {
  return typeof issue === "object" && issue !== null && issue.type === type;
}

function hasStyleQaIssue(styleQa, type) {
  return normalizeIssueList(styleQa?.issues).some((issue) => issueHasType(issue, type));
}

function isLocalStyleFixCandidate(styleQa, continuityQa, coverageAudit) {
  if (Boolean(styleQa?.passed)) return false;
  if (!Boolean(continuityQa?.passed) || !Boolean(coverageAudit?.passed)) return false;
  const issues = normalizeIssueList(styleQa?.issues);
  return !issues.some((issue) => issueHasType(issue, "sex_ratio_too_low"));
}

function shouldBlockForcedAcceptForStyle(styleQa) {
  if (Boolean(styleQa?.passed)) return false;
  return hasStyleQaIssue(styleQa, "forbidden_terms") || hasStyleQaIssue(styleQa, "non_erotic_too_long");
}

function buildRevisionFeedback({ styleQa, continuityQa, coverageAudit, repairPlan, mood, chapter }) {
  const continuityBlocking = isBlockingContinuityQa(continuityQa, ["critical", "high", "blocker"]);
  const coverageBlocking = isBlockingCoverageAudit(coverageAudit, ["critical", "high", "blocker"]);
  const blocking = continuityBlocking || coverageBlocking;
  return JSON.stringify({
    instruction: "上一轮未通过。请先修复下列问题，再继续保持原核心写作目标。",
    priority: blocking
      ? "最高优先级：先修复高危连续性/覆盖率问题，禁止继续扩写会污染后文的错误事实或删除硬伏笔。"
      : "优先修复质检问题，同时保持基调和剧情事实稳定。",
    original_boundary: {
      chapter_title: chapter.title,
      rule: "只允许改写本章原文已经发生或明确允许发生的事件；不得提前后文事件，不得改写人物身份、关系状态、制度规则。"
    },
    mood_guardrails: mood?.tone_guardrails ?? null,
    style_qa: {
      passed: Boolean(styleQa?.passed),
      issues: normalizeIssueList(styleQa?.issues),
      revision_advice: styleQa?.revision_advice ?? null
    },
    continuity_qa: {
      passed: Boolean(continuityQa?.passed),
      severity: continuitySeverity(continuityQa),
      blocking,
      issues: normalizeIssueList(continuityQa?.issues),
      facts_delta: normalizeIssueList(continuityQa?.facts_delta),
      risk_summary: continuityQa?.risk_summary ?? null,
      revision_advice: continuityQa?.revision_advice ?? null
    },
    coverage_audit: {
      passed: Boolean(coverageAudit?.passed),
      severity: auditSeverity(coverageAudit),
      blocking: coverageBlocking,
      coverage_ratio: coverageAudit?.coverage_ratio ?? null,
      missing_required_items: normalizeIssueList(coverageAudit?.missing_required_items),
      unapproved_additions: normalizeIssueList(coverageAudit?.unapproved_additions),
      root_cause: coverageAudit?.root_cause ?? null,
      next_revision_orders: normalizeIssueList(coverageAudit?.next_revision_orders)
    },
    repair_plan: {
      decision: repairPlan?.decision ?? null,
      root_cause_type: normalizeIssueList(repairPlan?.root_cause_type),
      blocking: Boolean(repairPlan?.blocking),
      evidence: normalizeIssueList(repairPlan?.evidence),
      repair_orders: normalizeIssueList(repairPlan?.repair_orders),
      context_requests: normalizeIssueList(repairPlan?.context_requests),
      acceptance_rationale: repairPlan?.acceptance_rationale ?? null,
      system_bug_report: repairPlan?.system_bug_report ?? null
    }
  });
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
    "输出必须是 JSON 对象，包含 genre、scene_content_type、emotional_core、character_dynamic、mood、conflict、character_states、continuity_risks、rewrite_focus、tone_guardrails、non_erotic_compression 字段。" +
    "保持客观，可以识别性爱场景的类型和功能，但不要生成具体描写。";
  const userPrompt =
    "请用 JSON 分析下面章节的基调、性爱类型、角色状态和改写重点。\n" +
    "genre 可取 pure_love、ntr、dom_sub、incest、corruption、seduction、mixed、none 等；不要为了刺激强行改判。\n" +
    "scene_content_type 必须取 explicit_sex、erotic_tension、pure_love_no_sex、plot_setup、action_or_worldbuilding 之一。只有 explicit_sex 才强制色情描写占比；其他类型必须压缩非核心剧情但不得硬加性内容。\n" +
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

async function extractSourceObligations(client, chapter, mood, knowledgeBase, previousSummary, logger, meta) {
  const systemPrompt =
    "你是原文事实统筹。请提取本章改写必须覆盖的硬事实、硬伏笔和可压缩内容。" +
    "不要创作正文，不要输出思维链。输出必须是 JSON 对象，包含 required_items、compressible_items、forbidden_changes、coverage_notes 字段。";
  const userPrompt =
    "请从原文章节中提取覆盖清单。\n" +
    "required_items: 后文会依赖、不能删除、不能改名、不能提前/延后的事实或事件。每项包含 id、description、reason、severity，severity 使用 medium、major、high、critical。\n" +
    "compressible_items: 可以精简但不可与 required_items 冲突的背景或过渡。\n" +
    "forbidden_changes: 明确禁止主笔改动的关系、身份、时间线、章节标题、制度规则、伏笔。\n" +
    "coverage_notes: 给主笔的简短覆盖提醒。\n\n" +
    `知识库摘要：${JSON.stringify(knowledgeBase).slice(0, 6000)}\n\n` +
    `前文摘要：${previousSummary}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n` +
    `章节标题：${chapter.title}\n\n原文：\n${chapter.content}`;

  return callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.1,
    logger,
    stage: "source_obligations",
    ...meta
  });
}

async function auditRewriteCoverage(client, chapter, rewritten, mood, sourceObligations, directorNotes, logger, meta) {
  const systemPrompt =
    "你是改写覆盖率审计员。请审计改写稿是否覆盖原文硬事实清单，并输出可审计摘要，不要输出隐藏思维链。" +
    "输出必须是 JSON 对象，包含 passed、severity、coverage_ratio、covered_required_items、missing_required_items、compressed_items、unapproved_additions、root_cause、next_revision_orders 字段。";
  const userPrompt =
    "请根据原文硬事实清单审计改写稿。\n" +
    "规则：required_items 中 high/critical 项不得删除、改名、错置或只以模糊暗示代替；可压缩但必须保留事实功能。\n" +
    "如果缺失 high/critical 项，passed=false，severity 至少 high。\n" +
    "root_cause 写可审计的失败原因摘要，例如“主笔只覆盖赏月场景，删除身世伏笔”。不要写模型内心推理过程。\n" +
    "next_revision_orders 必须是下一轮可直接执行的硬命令。\n\n" +
    `基调分析：${JSON.stringify(mood)}\n\n` +
    `原文硬事实清单：${JSON.stringify(sourceObligations)}\n\n` +
    `导演指令：${JSON.stringify(directorNotes)}\n\n` +
    `章节标题：${chapter.title}\n\n原文：\n${chapter.content.slice(0, 12000)}\n\n改写稿：\n${rewritten}`;

  const result = await callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.1,
    logger,
    stage: "coverage_audit",
    ...meta
  });
  return normalizeCoverageAudit(result);
}

async function agentRepairPlanner(client, chapter, mood, sourceObligations, styleQa, continuityQa, coverageAudit, previousFeedback, logger, meta) {
  const systemPrompt =
    "你是 Agent E 根因分析与修复调度员。你不写正文，只判断失败源头并决定下一步。" +
    "不要输出隐藏思维链，只输出可审计摘要。输出必须是 JSON 对象，包含 decision、root_cause_type、blocking、evidence、repair_orders、context_requests、system_bug_report、acceptance_rationale 字段。";
  const userPrompt =
    "请根据本轮质检结果判断失败根因和下一步动作。\n\n" +
    "decision 只能取以下值之一：\n" +
    "- retry_rewrite：模型改写跑偏、覆盖缺失、风格问题或连续性问题仍可通过下一轮重写修复。\n" +
    "- refresh_context_then_retry：上下文不足或读错原文，需要下一轮更强调原文硬事实、前文摘要、事实账本后重写。\n" +
    "- accept_with_risk：仅剩低/中风险或可接受的风格瑕疵，不会污染后文，可带风险采用。\n" +
    "- stop_for_system_bug：发现代码/规则逻辑错误，例如互相矛盾的硬规则、本地校验错误、错误采用失败稿，继续跑会浪费 API。\n" +
    "- stop_unrecoverable：多轮后仍无法满足高危连续性或覆盖率要求，继续重试价值很低。\n\n" +
    "root_cause_type 可包含 prompt_drift、coverage_loss、continuity_conflict、style_rule_conflict、source_misread、system_bug、context_insufficient。\n" +
    "repair_orders 必须是下一轮可直接执行的硬命令。若是 system_bug，system_bug_report 必须说明应修改哪类代码逻辑。\n\n" +
    `章节标题：${chapter.title}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n` +
    `原文硬事实清单：${JSON.stringify(sourceObligations)}\n\n` +
    `上一轮反馈：${previousFeedback || "无"}\n\n` +
    `风格质检：${JSON.stringify(styleQa)}\n\n` +
    `连续性质检：${JSON.stringify(continuityQa)}\n\n` +
    `覆盖率审计：${JSON.stringify(coverageAudit)}`;

  return callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.1,
    logger,
    stage: "repair_planner",
    ...meta
  });
}

async function agentTensionDirector(client, chapter, mood, sourceObligations, projectConfig, customRules, previousFeedback, logger, meta) {
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
    `原文硬事实清单：${JSON.stringify(sourceObligations)}\n\n` +
    `上一轮质检反馈：${previousFeedback || "无"}\n\n` +
    "必须把原文硬事实清单中的 required_items 合并进 must_keep。压缩可以发生，但不得删除 high/critical 硬伏笔。\n" +
    "如果上一轮反馈包含 blocking=true 或高危连续性/覆盖率问题，必须把修复该问题作为本轮分镜第一优先级，明确告诉主笔如何避免重复错误。\n\n" +
    `章节：${chapter.title}\n${chapter.content}`;

  return callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: true,
    temperature: 0.3,
    logger,
    stage: "director",
    ...meta
  });
}

async function agentWriter(client, chapter, mood, directorNotes, sourceObligations, knowledgeBase, projectConfig, customRules, previousSummary, previousTail, factsLedger, logger, meta) {
  const systemPrompt =
    "你是专业成人色情小说主笔人。严格遵循配置中的用词规则和比例要求。" +
    "只有 Agent 0 判定为 explicit_sex 的章节，才必须写出连续、直白、无比喻的性爱场面并让色情描写占全文 40% 以上。" +
    "非 explicit_sex 章节必须极度浓缩，只保留硬伏笔、人物关系变化、禁忌提醒物和后续成人剧情所需信息，不得为了占比硬加性内容。" +
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
    `原文硬事实清单（必须逐项覆盖，允许精简但不得删除 high/critical 项）：${JSON.stringify(sourceObligations)}\n\n` +
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

function findForbiddenMetaphorHits(text, terms) {
  const hits = new Set();
  for (const term of terms) {
    if (!term) continue;
    if (term.length > 1) {
      if (text.includes(term)) hits.add(term);
      continue;
    }

    if (term === "像") {
      const pattern = /像[^，。！？；\n]{1,24}(一样|一般|似的|那样|般)/g;
      if (pattern.test(text)) hits.add(term);
      continue;
    }

    if (term === "如") {
      const pattern = /(如同|犹如|宛如|恰如|一如|如[^，。！？；\n]{1,12}(般|水|墨|玉|雪|火|潮|丝|梦))/g;
      if (pattern.test(text)) hits.add(term);
      continue;
    }

    if (term === "似") {
      const pattern = /(好似|恰似|酷似|似[^，。！？；\n]{1,12}(般|水|火|玉|雪|梦))/g;
      if (pattern.test(text)) hits.add(term);
      continue;
    }

    if (text.includes(term)) hits.add(term);
  }
  return [...hits].sort();
}

function localForbiddenScan(text, customRules) {
  const metaphorTerms = Array.isArray(customRules.forbidden_metaphor_words) ? customRules.forbidden_metaphor_words : [];
  const elegantTerms = Array.isArray(customRules.forbidden_elegant_words) ? customRules.forbidden_elegant_words : [];
  const metaphorHits = findForbiddenMetaphorHits(text, metaphorTerms);
  const elegantHits = elegantTerms.filter((term) => term && text.includes(term));
  return [...new Set([...metaphorHits, ...elegantHits])].sort();
}

function estimateSexRatio(text) {
  const markers = ["肏", "鸡巴", "小穴", "骚屄", "淫水", "阴唇", "龟头", "精液", "阴道", "阴蒂", "肉棒", "骚逼", "干", "插", "操", "抽插", "淫", "浪", "奶子", "乳头"];
  const sentences = text.split(/[。！？!?]/).filter((item) => item.trim());
  if (sentences.length === 0) return 0;
  const hits = sentences.filter((sentence) => markers.some((marker) => sentence.includes(marker))).length;
  return Number((hits / sentences.length).toFixed(3));
}

async function agentQa(client, rewritten, chapter, mood, sourceObligations, projectConfig, customRules, logger, meta) {
  const forbiddenHits = localForbiddenScan(rewritten, customRules);
  const ratio = estimateSexRatio(rewritten);
  const enforceSexRatio = shouldEnforceSexRatio(mood);
  const maxOutputRatio = maxOutputRatioForChapter(mood, customRules, sourceObligations);
  const outputRatio = chapter.content.length > 0 ? Number((rewritten.length / chapter.content.length).toFixed(3)) : 0;
  const systemPrompt =
    "你是 Agent C 质检打磨师。请检查禁用比喻词命中、动作连续性、用词合规、" +
    "色情占比、非色情剧情精简度、基调忠实度和语言质量。" +
    "输出必须是 JSON 对象，包含 passed、issues、revision_advice、summary、ending_tail 字段。";
  const userPrompt =
    "请用 JSON 质检。检查以下内容，不符合则 passed 设为 false：\n" +
    "1）禁用隐喻词命中（forbidden_metaphor_words 和 forbidden_elegant_words）\n" +
    "2）用词合规：是否在正确节点切换词汇（前戏适当雅称，交合用粗俗词）\n" +
    "3）动作连续性：是否从挑逗直接跳到抽插，缺少中间步骤\n" +
    "4）色情占比：仅当 Agent 0 判定本章存在性爱/色情场景且未禁止性描写时，判断色情描写占比是否达到 35% 以上；若 genre=none 或 tone_guardrails 禁止性描写，则不得因色情占比不足判失败\n" +
    "5）非色情剧情是否冗余：背景、环境、路人对白、设定说明若不服务色情张力、人物关系、禁忌提醒物或后续硬伏笔，必须要求删减\n" +
    "6）基调是否被扭曲：不得把 pure_love 强行改成 ntr，也不得把背德戏洗成纯爱\n" +
    "7）长度策略：非 explicit_sex 章节必须明显浓缩，只保留硬伏笔和直接服务成人剧情核心的内容\n\n" +
    `配置：${compactConfig(projectConfig, customRules)}\n\n` +
    `本地禁用词命中：${JSON.stringify(forbiddenHits)}\n` +
    `性描写句占比估算：${ratio}\n` +
    `本章是否强制检查色情占比：${enforceSexRatio}\n` +
    `输出/原文字数比例：${outputRatio}\n` +
    `本章最大建议比例：${maxOutputRatio ?? "explicit_sex 不限制"}\n` +
    `本章硬事实数量：${requiredItemCount(sourceObligations)}\n\n` +
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
  if (enforceSexRatio && ratio < 0.35) {
    result.passed = false;
    result.issues.push({ type: "sex_ratio_too_low", ratio, threshold: 0.35 });
  }
  if (maxOutputRatio !== null && outputRatio > maxOutputRatio) {
    result.passed = false;
    result.issues.push({
      type: "non_erotic_too_long",
      outputRatio,
      threshold: maxOutputRatio,
      advice: "非 explicit_sex 章节仍过长，请继续压缩背景、环境、路人对白和设定说明，只保留硬伏笔与成人剧情核心所需信息。"
    });
  }
  return result;
}

async function agentStyleFixer(client, rewritten, chapter, mood, sourceObligations, styleQa, customRules, logger, meta) {
  const systemPrompt =
    "你是 Agent F 局部风格修补师。你只做局部文字修补和压缩，不重写剧情。" +
    "必须保留原文硬事实清单，不得新增事件、删除硬伏笔、改变人物关系或时间线。只输出修补后的完整正文，不输出解释。";
  const userPrompt =
    "请修补下面改写稿中的风格问题。\n" +
    "任务范围：\n" +
    "1）删除或替换禁用比喻结构和禁用雅称。\n" +
    "2）压缩不直接服务成人剧情核心、人物关系、禁忌提醒物或后续硬伏笔的非核心文字。\n" +
    "3）保持章节标题、人物关系、事件顺序、硬事实清单不变。\n" +
    "4）不得为了修风格而新增成人场景；只有原稿已有成人场景时，才可在同一场景内补足连贯性。\n\n" +
    `配置：${compactConfig({}, customRules)}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n` +
    `原文硬事实清单：${JSON.stringify(sourceObligations)}\n\n` +
    `风格质检问题：${JSON.stringify(styleQa)}\n\n` +
    `章节标题：${chapter.title}\n\n` +
    `待修补正文：\n${rewritten}`;

  return callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: false,
    temperature: 0.2,
    logger,
    stage: "style_fix",
    ...meta
  });
}

async function agentFinalRepair(client, rewritten, chapter, mood, sourceObligations, styleQa, continuityQa, coverageAudit, repairPlan, customRules, logger, meta) {
  const systemPrompt =
    "你是 Agent G 最终定向修复师。你只根据修复命令改稿，不重新构思剧情。" +
    "必须同时完成：修复风格违规、恢复缺失硬伏笔、压缩非核心内容、保持连续性。只输出修复后的完整正文，不输出解释。";
  const userPrompt =
    "请对下面改写稿做最终定向修复。\n" +
    "硬性要求：\n" +
    "1）逐条执行 Agent E repair_orders。\n" +
    "2）如果缺失 required_items，必须补回，但用最短句子补回，不展开无关细节。\n" +
    "3）删除禁用比喻结构和禁用雅称。\n" +
    "4）非 explicit_sex 章节继续压缩，优先删背景、理论、招式拆解、路人反应和环境描写。\n" +
    "5）不得新增事件，不得改变人物关系、年龄、身份、章节标题和时间顺序。\n\n" +
    `配置：${compactConfig({}, customRules)}\n\n` +
    `基调分析：${JSON.stringify(mood)}\n\n` +
    `原文硬事实清单：${JSON.stringify(sourceObligations)}\n\n` +
    `风格质检：${JSON.stringify(styleQa)}\n\n` +
    `连续性质检：${JSON.stringify(continuityQa)}\n\n` +
    `覆盖率审计：${JSON.stringify(coverageAudit)}\n\n` +
    `Agent E 修复计划：${JSON.stringify(repairPlan)}\n\n` +
    `章节标题：${chapter.title}\n\n` +
    `待最终修复正文：\n${rewritten}`;

  return callLlm(client, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], {
    jsonMode: false,
    temperature: 0.2,
    logger,
    stage: "final_repair",
    ...meta
  });
}

async function agentContinuityQa(client, rewritten, chapter, mood, previousSummary, factsLedger, logger, meta) {
  const systemPrompt =
    "你是 Agent D 连续性审校。你的唯一职责是找剧情事实、人物关系、时间线、承诺、制度规则与前文账本的冲突。" +
    "不要评价文风。输出必须是 JSON 对象，包含 passed、severity、issues、revision_advice、facts_delta、risk_summary 字段。" +
    "severity 只能使用 low、medium、major、high、critical、blocker。只有高危关系/时间线/重大事件矛盾才用 high、critical 或 blocker；普通名词、地点、称谓错误通常用 major 或 medium。";
  const userPrompt =
    "请严格检查改写稿是否擅自新增、提前、删除或反转重大事实。尤其关注：第一次/已发生/未发生、关系身份、承诺契约、礼法制度、前后称谓与时间顺序。\n\n" +
    "分级标准：\n" +
    "- blocker/critical/high：会污染后续主线的重大矛盾，例如把未发生的性关系写成已发生、把关系身份改错、提前后文关键事件、破坏核心制度规则。\n" +
    "- major：明确事实错误但可按 revision_advice 自动修复，例如地点名、院落名、物品名、人物称谓写错。\n" +
    "- medium/low：局部表达不严谨或轻微遗漏。\n\n" +
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

async function processChapter(client, run, chapter, chapterIndex, total, projectConfig, customRules, knowledgeBase, state, maxAttempts, contextTailChars, allowForcedAcceptOnContinuityFailure, styleFixAttempts, finalRepairAttempts, logger) {
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
  const sourceObligations = await extractSourceObligations(client, chapter, mood, knowledgeBase, state.summaryState.previousSummary, logger, meta);
  await writeJson(path.join(dir, "source_obligations.json"), sourceObligations);

  let feedback = "";
  let accepted = "";
  let acceptedQa = null;
  let lastDraft = "";
  let lastStyleQa = null;
  let lastContinuityQa = null;
  let lastCoverageAudit = null;
  let lastRepairPlan = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptMeta = { ...meta, attempt };
    await logger.event("info", "attempt_start", {
      ...attemptMeta,
      message: `${attempt}/${maxAttempts}`
    });

    const directorNotes = await agentTensionDirector(client, chapter, mood, sourceObligations, projectConfig, customRules, feedback, logger, attemptMeta);
    await writeJson(path.join(dir, `attempt_${attempt}_director.json`), directorNotes);

    lastDraft = await agentWriter(
      client,
      chapter,
      mood,
      directorNotes,
      sourceObligations,
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

    lastStyleQa = await agentQa(client, lastDraft, chapter, mood, sourceObligations, projectConfig, customRules, logger, attemptMeta);
    await writeJson(path.join(dir, `attempt_${attempt}_style_qa.json`), lastStyleQa);

    lastContinuityQa = await agentContinuityQa(client, lastDraft, chapter, mood, state.summaryState.previousSummary, state.factsLedger, logger, attemptMeta);
    await writeJson(path.join(dir, `attempt_${attempt}_continuity_qa.json`), lastContinuityQa);

    lastCoverageAudit = await auditRewriteCoverage(client, chapter, lastDraft, mood, sourceObligations, directorNotes, logger, attemptMeta);
    await writeJson(path.join(dir, `attempt_${attempt}_rewrite_audit.json`), lastCoverageAudit);
    await writeJson(path.join(dir, `attempt_${attempt}_source_coverage.json`), {
      passed: Boolean(lastCoverageAudit.passed),
      severity: lastCoverageAudit.severity ?? null,
      coverage_ratio: lastCoverageAudit.coverage_ratio ?? null,
      covered_required_items: normalizeIssueList(lastCoverageAudit.covered_required_items),
      missing_required_items: normalizeIssueList(lastCoverageAudit.missing_required_items),
      unapproved_additions: normalizeIssueList(lastCoverageAudit.unapproved_additions)
    });
    if (!lastCoverageAudit.passed) {
      await writeJson(path.join(dir, `attempt_${attempt}_failure_root_cause.json`), {
        root_cause: lastCoverageAudit.root_cause ?? null,
        next_revision_orders: normalizeIssueList(lastCoverageAudit.next_revision_orders),
        missing_required_items: normalizeIssueList(lastCoverageAudit.missing_required_items),
        continuity_issues: normalizeIssueList(lastContinuityQa.issues),
        style_issues: normalizeIssueList(lastStyleQa.issues)
      });
    }

    if (isLocalStyleFixCandidate(lastStyleQa, lastContinuityQa, lastCoverageAudit)) {
      for (let fixAttempt = 1; fixAttempt <= styleFixAttempts; fixAttempt += 1) {
        const fixMeta = { ...attemptMeta, attempt: `${attempt}.${fixAttempt}` };
        await logger.event("info", "style_fix_start", {
          ...fixMeta,
          message: `局部风格修补 ${fixAttempt}/${styleFixAttempts}`
        });

        const fixedDraft = await agentStyleFixer(
          client,
          lastDraft,
          chapter,
          mood,
          sourceObligations,
          lastStyleQa,
          customRules,
          logger,
          fixMeta
        );
        await atomicWrite(path.join(dir, `attempt_${attempt}_style_fix_${fixAttempt}.txt`), fixedDraft);

        const fixedStyleQa = await agentQa(client, fixedDraft, chapter, mood, sourceObligations, projectConfig, customRules, logger, fixMeta);
        await writeJson(path.join(dir, `attempt_${attempt}_style_fix_${fixAttempt}_style_qa.json`), fixedStyleQa);

        const fixedContinuityQa = await agentContinuityQa(client, fixedDraft, chapter, mood, state.summaryState.previousSummary, state.factsLedger, logger, fixMeta);
        await writeJson(path.join(dir, `attempt_${attempt}_style_fix_${fixAttempt}_continuity_qa.json`), fixedContinuityQa);

        const fixedCoverageAudit = await auditRewriteCoverage(client, chapter, fixedDraft, mood, sourceObligations, directorNotes, logger, fixMeta);
        await writeJson(path.join(dir, `attempt_${attempt}_style_fix_${fixAttempt}_rewrite_audit.json`), fixedCoverageAudit);

        const fixedPassed = Boolean(fixedStyleQa.passed) && Boolean(fixedContinuityQa.passed) && Boolean(fixedCoverageAudit.passed);
        await logger.event(fixedPassed ? "info" : "warn", "style_fix_result", {
          ...fixMeta,
          passed: fixedPassed,
          stylePassed: Boolean(fixedStyleQa.passed),
          continuityPassed: Boolean(fixedContinuityQa.passed),
          coveragePassed: Boolean(fixedCoverageAudit.passed),
          message: `style=${Boolean(fixedStyleQa.passed)}, continuity=${Boolean(fixedContinuityQa.passed)}, coverage=${Boolean(fixedCoverageAudit.passed)}`
        });

        lastDraft = fixedDraft;
        lastStyleQa = fixedStyleQa;
        lastContinuityQa = fixedContinuityQa;
        lastCoverageAudit = fixedCoverageAudit;

        if (fixedPassed || !isLocalStyleFixCandidate(lastStyleQa, lastContinuityQa, lastCoverageAudit)) break;
      }
    }

    const passed = Boolean(lastStyleQa.passed) && Boolean(lastContinuityQa.passed) && Boolean(lastCoverageAudit.passed);
    if (!passed) {
      lastRepairPlan = await agentRepairPlanner(
        client,
        chapter,
        mood,
        sourceObligations,
        lastStyleQa,
        lastContinuityQa,
        lastCoverageAudit,
        feedback,
        logger,
        attemptMeta
      );
      await writeJson(path.join(dir, `attempt_${attempt}_repair_plan.json`), lastRepairPlan);
    } else {
      lastRepairPlan = null;
    }

    const styleIssueCount = normalizeIssueList(lastStyleQa.issues).length;
    const continuityIssueCount = normalizeIssueList(lastContinuityQa.issues).length;
    const coverageMissingCount = normalizeIssueList(lastCoverageAudit.missing_required_items).length;
    const repairDecision = lastRepairPlan?.decision ?? null;
    await logger.event(passed ? "info" : "warn", "attempt_result", {
      ...attemptMeta,
      passed,
      stylePassed: Boolean(lastStyleQa.passed),
      continuityPassed: Boolean(lastContinuityQa.passed),
      coveragePassed: Boolean(lastCoverageAudit.passed),
      styleIssueCount,
      continuityIssueCount,
      coverageMissingCount,
      repairDecision,
      draftChars: lastDraft.length,
      message: `style=${Boolean(lastStyleQa.passed)}(${styleIssueCount}), continuity=${Boolean(lastContinuityQa.passed)}(${continuityIssueCount}), coverage=${Boolean(lastCoverageAudit.passed)}(${coverageMissingCount}), repair=${repairDecision || "none"}, draftChars=${lastDraft.length}`
    });

    chapterState.attempts = attempt;
    chapterState.lastStylePassed = Boolean(lastStyleQa.passed);
    chapterState.lastContinuityPassed = Boolean(lastContinuityQa.passed);
    await saveManifest(run);

    if (passed) {
      accepted = lastDraft;
      acceptedQa = { style: lastStyleQa, continuity: lastContinuityQa, coverage: lastCoverageAudit };
      break;
    }

    if (shouldStopForRepairPlan(lastRepairPlan)) {
      const failureQa = {
        style: lastStyleQa,
        continuity: lastContinuityQa,
        coverage: lastCoverageAudit,
        repair_plan: lastRepairPlan,
        forced_accept_blocked: true
      };
      const failedQaPath = path.join(dir, "failed_qa.json");
      await writeJson(failedQaPath, failureQa);

      chapterState.status = "failed";
      chapterState.finishedAt = nowIso();
      chapterState.failedReason = normalizeDecision(lastRepairPlan.decision);
      chapterState.qaPath = path.relative(run.runDir, failedQaPath).replaceAll("\\", "/");
      chapterState.risks = {
        style: normalizeIssueList(lastStyleQa?.issues),
        continuity: normalizeIssueList(lastContinuityQa?.issues),
        coverage: normalizeIssueList(lastCoverageAudit?.missing_required_items),
        repair: normalizeIssueList(lastRepairPlan?.evidence)
      };
      await saveManifest(run, { status: "failed" });

      await logger.event("error", "chapter_failed", {
        chapterIndex,
        chapterTitle: chapter.title,
        repairDecision: lastRepairPlan.decision,
        rootCauseType: normalizeIssueList(lastRepairPlan.root_cause_type),
        message: "Agent E 判定为系统问题或不可恢复问题，已停止流水线；请查看 failed_qa.json 和 attempt_*_repair_plan.json"
      });

      throw new Error(`章节「${chapter.title}」被 Agent E 判定为 ${lastRepairPlan.decision}，已停止。`);
    }

    const blockingSeverities = customRules.global_style?.blocking_continuity_severities ?? ["critical", "high", "blocker"];
    const retryableBlocking =
      isBlockingContinuityQa(lastContinuityQa, blockingSeverities) ||
      isBlockingCoverageAudit(lastCoverageAudit, blockingSeverities);
    if (shouldAcceptWithRisk(lastRepairPlan) && !retryableBlocking) {
      accepted = lastDraft;
      acceptedQa = {
        style: lastStyleQa,
        continuity: lastContinuityQa,
        coverage: lastCoverageAudit,
        repair_plan: lastRepairPlan,
        forced_accept: true
      };
      await logger.event("warn", "repair_accept_with_risk", {
        ...attemptMeta,
        repairDecision: lastRepairPlan.decision,
        message: "Agent E 判定剩余问题可带风险采用"
      });
      break;
    }

    feedback = buildRevisionFeedback({
      styleQa: lastStyleQa,
      continuityQa: lastContinuityQa,
      coverageAudit: lastCoverageAudit,
      repairPlan: lastRepairPlan,
      mood,
      chapter
    });
  }

  if (!accepted) {
    const canFinalRepair = ["retry_rewrite", "refresh_context_then_retry"].includes(normalizeDecision(lastRepairPlan?.decision));
    if (canFinalRepair && finalRepairAttempts > 0) {
      for (let repairAttempt = 1; repairAttempt <= finalRepairAttempts; repairAttempt += 1) {
        const repairMeta = { ...meta, attempt: `final.${repairAttempt}` };
        await logger.event("info", "final_repair_start", {
          ...repairMeta,
          message: `最终定向修复 ${repairAttempt}/${finalRepairAttempts}`
        });

        const repairedDraft = await agentFinalRepair(
          client,
          lastDraft,
          chapter,
          mood,
          sourceObligations,
          lastStyleQa,
          lastContinuityQa,
          lastCoverageAudit,
          lastRepairPlan,
          customRules,
          logger,
          repairMeta
        );
        await atomicWrite(path.join(dir, `final_repair_${repairAttempt}.txt`), repairedDraft);

        const repairedStyleQa = await agentQa(client, repairedDraft, chapter, mood, sourceObligations, projectConfig, customRules, logger, repairMeta);
        await writeJson(path.join(dir, `final_repair_${repairAttempt}_style_qa.json`), repairedStyleQa);

        const repairedContinuityQa = await agentContinuityQa(client, repairedDraft, chapter, mood, state.summaryState.previousSummary, state.factsLedger, logger, repairMeta);
        await writeJson(path.join(dir, `final_repair_${repairAttempt}_continuity_qa.json`), repairedContinuityQa);

        const repairedCoverageAudit = await auditRewriteCoverage(client, chapter, repairedDraft, mood, sourceObligations, { final_repair: true }, logger, repairMeta);
        await writeJson(path.join(dir, `final_repair_${repairAttempt}_rewrite_audit.json`), repairedCoverageAudit);

        lastDraft = repairedDraft;
        lastStyleQa = repairedStyleQa;
        lastContinuityQa = repairedContinuityQa;
        lastCoverageAudit = repairedCoverageAudit;

        const repairedPassed = Boolean(lastStyleQa.passed) && Boolean(lastContinuityQa.passed) && Boolean(lastCoverageAudit.passed);
        await logger.event(repairedPassed ? "info" : "warn", "final_repair_result", {
          ...repairMeta,
          passed: repairedPassed,
          stylePassed: Boolean(lastStyleQa.passed),
          continuityPassed: Boolean(lastContinuityQa.passed),
          coveragePassed: Boolean(lastCoverageAudit.passed),
          message: `style=${Boolean(lastStyleQa.passed)}, continuity=${Boolean(lastContinuityQa.passed)}, coverage=${Boolean(lastCoverageAudit.passed)}`
        });

        if (repairedPassed) {
          accepted = lastDraft;
          acceptedQa = {
            style: lastStyleQa,
            continuity: lastContinuityQa,
            coverage: lastCoverageAudit,
            repair_plan: lastRepairPlan,
            final_repair: true
          };
          break;
        }
      }
    }
  }

  if (!accepted) {
    const continuityPassed = Boolean(lastContinuityQa?.passed);
    const blockingSeverities = customRules.global_style?.blocking_continuity_severities ?? ["critical", "high", "blocker"];
    const blockingContinuity = isBlockingContinuityQa(
      lastContinuityQa,
      blockingSeverities
    );
    const blockingCoverage = isBlockingCoverageAudit(lastCoverageAudit, blockingSeverities);
    const blockingStyle = shouldBlockForcedAcceptForStyle(lastStyleQa);
    if (((blockingContinuity || blockingCoverage) && !allowForcedAcceptOnContinuityFailure) || blockingStyle) {
      const failureQa = {
        style: lastStyleQa,
        continuity: lastContinuityQa,
        coverage: lastCoverageAudit,
        repair_plan: lastRepairPlan,
        forced_accept_blocked: true
      };
      const failedQaPath = path.join(dir, "failed_qa.json");
      await writeJson(failedQaPath, failureQa);

      chapterState.status = "failed";
      chapterState.finishedAt = nowIso();
      chapterState.failedReason = blockingStyle ? "style_fix_failed" : blockingContinuity ? "continuity_qa_failed" : "coverage_audit_failed";
      chapterState.continuitySeverity = continuitySeverity(lastContinuityQa);
      chapterState.coverageSeverity = auditSeverity(lastCoverageAudit);
      chapterState.qaPath = path.relative(run.runDir, failedQaPath).replaceAll("\\", "/");
      chapterState.risks = {
        style: normalizeIssueList(lastStyleQa?.issues),
        continuity: normalizeIssueList(lastContinuityQa?.issues),
        coverage: normalizeIssueList(lastCoverageAudit?.missing_required_items),
        repair: normalizeIssueList(lastRepairPlan?.evidence)
      };
      await saveManifest(run, { status: "failed" });

      await logger.event("error", "chapter_failed", {
        chapterIndex,
        chapterTitle: chapter.title,
        stylePassed: Boolean(lastStyleQa?.passed),
        continuityPassed,
        coveragePassed: Boolean(lastCoverageAudit?.passed),
        continuitySeverity: continuitySeverity(lastContinuityQa),
        coverageSeverity: auditSeverity(lastCoverageAudit),
        repairDecision: lastRepairPlan?.decision ?? null,
        message: "连续性、原文覆盖率或局部风格修补仍存在阻断问题，已停止流水线；请查看 failed_qa.json、attempt_*_style_fix_*、attempt_*_rewrite_audit.json"
      });

      throw new Error(`章节「${chapter.title}」连续性、覆盖率或风格修补存在阻断问题，已停止以避免污染后文。`);
    }

    accepted = lastDraft;
    acceptedQa = { style: lastStyleQa, continuity: lastContinuityQa, coverage: lastCoverageAudit, repair_plan: lastRepairPlan, forced_accept: true };
    await logger.event("warn", "forced_accept", {
      chapterIndex,
      chapterTitle: chapter.title,
      stylePassed: Boolean(lastStyleQa?.passed),
      continuityPassed,
      coveragePassed: Boolean(lastCoverageAudit?.passed),
      continuitySeverity: continuitySeverity(lastContinuityQa),
      coverageSeverity: auditSeverity(lastCoverageAudit),
      repairDecision: lastRepairPlan?.decision ?? null,
      message: "达到最大重试次数，使用最后一版并保留非高危质检风险"
    });
  }

  const acceptedPath = path.join(dir, "accepted.txt");
  const qaPath = path.join(dir, "accepted_qa.json");
  await atomicWrite(acceptedPath, accepted);
  await writeJson(qaPath, acceptedQa);

  const factsLedger = await updateFactsLedger(client, state.factsLedger, chapter.title, chapter.content, accepted, {
    continuity: acceptedQa.continuity,
    coverage: acceptedQa.coverage
  }, logger, meta);
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
    continuity: normalizeIssueList(acceptedQa.continuity?.issues),
    coverage: normalizeIssueList(acceptedQa.coverage?.missing_required_items),
    repair: normalizeIssueList(acceptedQa.repair_plan?.evidence)
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
  const styleFixAttempts = Number(style.style_fix_attempts ?? 2);
  const finalRepairAttempts = Number(style.final_repair_attempts ?? 1);
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
    allowForcedAcceptOnContinuityFailure,
    styleFixAttempts,
    finalRepairAttempts
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
      styleFixAttempts,
      finalRepairAttempts,
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
