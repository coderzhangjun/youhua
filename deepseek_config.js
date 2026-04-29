import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_THINKING_TYPE = "enabled";
const DEFAULT_REASONING_EFFORT = "high";
const LOCAL_ENV_FILES = [".env.local", ".env"];

let localEnvLoaded = false;

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) return null;

  const key = trimmed.slice(0, separatorIndex).trim();
  const rawValue = trimmed.slice(separatorIndex + 1).trim();
  const value = rawValue.replace(/^['"]|['"]$/g, "");
  return key ? [key, value] : null;
}

function loadLocalEnv() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;

  for (const filename of LOCAL_ENV_FILES) {
    const filepath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filepath)) continue;

    const content = fs.readFileSync(filepath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const entry = parseEnvLine(line);
      if (!entry) continue;

      const [key, value] = entry;
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export function getDeepSeekApiKey() {
  loadLocalEnv();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "填入你的 DeepSeek API Key") {
    throw new Error("请先在 .env.local 中填写 DEEPSEEK_API_KEY。");
  }
  return apiKey;
}

export function getDeepSeekBaseUrl() {
  loadLocalEnv();
  return process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
}

export function createDeepSeekChatRequest({ messages, jsonMode = false, temperature = 0.4 }) {
  loadLocalEnv();

  const request = {
    model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    messages,
    temperature,
    thinking: { type: process.env.DEEPSEEK_THINKING_TYPE || DEFAULT_THINKING_TYPE },
    reasoning_effort: process.env.DEEPSEEK_REASONING_EFFORT || DEFAULT_REASONING_EFFORT
  };

  if (jsonMode) request.response_format = { type: "json_object" };
  return request;
}
