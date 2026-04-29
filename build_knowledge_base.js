import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import OpenAI from "openai";

const BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-chat";
const CHUNK_CHARS = 18000;
const MAX_RETRIES = 5;

function getClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("请先设置环境变量 DEEPSEEK_API_KEY。");
  }
  return new OpenAI({ apiKey, baseURL: BASE_URL });
}

async function readTxt(filepath) {
  const absolutePath = path.resolve(filepath);
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`读取失败，请确认文件为 UTF-8 编码: ${absolutePath}\n${error.message}`);
  }
}

function safeTitle(filepath) {
  const title = path.basename(filepath, path.extname(filepath));
  return title.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "novel";
}

function chunkText(text, chunkChars = CHUNK_CHARS) {
  const parts = text.split(/(\n\s*\n)/);
  const chunks = [];
  let current = "";

  for (const part of parts) {
    if (current.length + part.length <= chunkChars) {
      current += part;
      continue;
    }
    if (current.trim()) chunks.push(current.trim());
    current = part;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callLlm(client, messages, { jsonMode = false, temperature = 0.2 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const request = {
        model: MODEL,
        messages,
        temperature
      };
      if (jsonMode) request.response_format = { type: "json_object" };
      const response = await client.chat.completions.create(request);
      const content = response.choices[0]?.message?.content ?? "";
      return jsonMode ? JSON.parse(content) : content;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) break;
      await sleep(Math.min(2 ** attempt, 30) * 1000);
    }
  }
  throw new Error(`LLM 调用失败: ${lastError?.message ?? lastError}`);
}

async function analyzeChunk(client, chunk, index, total) {
  const systemPrompt =
    "你是中文长篇小说的文学分析师。请只做结构化分析，不生成露骨色情内容。" +
    "输出必须是 JSON 对象，包含 characters、plot_points、relationship_changes、tone、open_threads、chapter_candidates 字段。";
  const userPrompt =
    `这是全文分块 ${index}/${total}。请用 JSON 分析这一块的角色、事件、关系变化、情绪基调、悬念和可能章节节点。保持客观，避免补写剧情。\n\n${chunk}`;

  return callLlm(
    client,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { jsonMode: true }
  );
}

async function mergeAnalyses(client, title, analyses) {
  const systemPrompt =
    "你是长篇小说制片统筹。请把分块分析合并为可供改写系统使用的知识库。" +
    "输出必须是 JSON 对象，包含 title、characters、chapter_blueprint、relationship_map、global_tone、continuity_notes、safety_notes 字段。";
  const userPrompt =
    "请合并下面的分块分析为一个完整 JSON 知识库。要求去重角色、统一称谓、保留主线，不要生成露骨色情内容。\n\n" +
    JSON.stringify({ title, chunk_analyses: analyses });

  return callLlm(
    client,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { jsonMode: true }
  );
}

async function analyzeGlobalNovel(fullText, novelTitle) {
  const client = getClient();
  const chunks = chunkText(fullText);
  const analyses = [];

  for (let index = 0; index < chunks.length; index += 1) {
    console.log(`分析分块 ${index + 1}/${chunks.length}...`);
    analyses.push(await analyzeChunk(client, chunks[index], index + 1, chunks.length));
  }

  return mergeAnalyses(client, novelTitle, analyses);
}

async function saveKnowledgeBase(novelTitle, data) {
  const outputPath = `knowledge_base_${novelTitle}.json`;
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");
  return outputPath;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const filepath = (await rl.question("请输入小说 TXT 路径: ")).trim().replace(/^"|"$/g, "");
  rl.close();

  const novelTitle = safeTitle(filepath);
  const fullText = await readTxt(filepath);
  const data = await analyzeGlobalNovel(fullText, novelTitle);
  const outputPath = await saveKnowledgeBase(novelTitle, data);
  console.log(`知识库已生成: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
