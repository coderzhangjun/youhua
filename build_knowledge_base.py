import json
import os
import re
import time
from pathlib import Path
from typing import Any

from openai import OpenAI


BASE_URL = "https://api.deepseek.com"
MODEL = "deepseek-chat"
CHUNK_CHARS = 18000
MAX_RETRIES = 5


def get_client() -> OpenAI:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("请先设置环境变量 DEEPSEEK_API_KEY。")
    return OpenAI(api_key=api_key, base_url=BASE_URL)


def read_txt(filepath: str) -> str:
    path = Path(filepath).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {path}")

    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("unknown", b"", 0, 1, "无法识别文本编码，请转换为 UTF-8。")


def safe_title(filepath: str) -> str:
    title = Path(filepath).stem
    return re.sub(r'[\\/:*?"<>|\s]+', "_", title).strip("_") or "novel"


def chunk_text(text: str, chunk_chars: int = CHUNK_CHARS) -> list[str]:
    paragraphs = re.split(r"(\n\s*\n)", text)
    chunks: list[str] = []
    current = ""

    for part in paragraphs:
        if len(current) + len(part) <= chunk_chars:
            current += part
            continue
        if current.strip():
            chunks.append(current.strip())
        current = part

    if current.strip():
        chunks.append(current.strip())
    return chunks


def call_llm(client: OpenAI, messages: list[dict[str, str]], json_mode: bool = False) -> Any:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            kwargs: dict[str, Any] = {
                "model": MODEL,
                "messages": messages,
                "temperature": 0.2,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            response = client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content or ""
            return json.loads(content) if json_mode else content
        except Exception as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(f"LLM 调用失败: {last_error}")


def analyze_chunk(client: OpenAI, chunk: str, index: int, total: int) -> dict[str, Any]:
    system_prompt = (
        "你是中文长篇小说的文学分析师。请只做结构化分析。"
        "可以识别性爱场景的类型和功能，但不要生成具体描写。"
        "输出必须是 JSON 对象，包含 characters、plot_points、relationship_changes、"
        "tone、open_threads、chapter_candidates 字段。"
    )
    user_prompt = (
        f"这是全文分块 {index}/{total}。请用 JSON 分析这一块的角色、事件、关系变化、"
        "情绪基调、悬念和可能章节节点。保持客观，避免补写剧情。\n\n"
        f"{chunk}"
    )
    return call_llm(
        client,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        json_mode=True,
    )


def merge_analyses(client: OpenAI, title: str, analyses: list[dict[str, Any]]) -> dict[str, Any]:
    system_prompt = (
        "你是长篇小说制片统筹。请把分块分析合并为可供改写系统使用的知识库。"
        "输出必须是 JSON 对象，包含 title、characters、chapter_blueprint、"
        "relationship_map、global_tone、continuity_notes 字段。"
    )
    user_prompt = (
        "请合并下面的分块分析为一个完整 JSON 知识库。要求去重角色、统一称谓、保留主线。\n\n"
        + json.dumps({"title": title, "chunk_analyses": analyses}, ensure_ascii=False)
    )
    return call_llm(
        client,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        json_mode=True,
    )


def analyze_global_novel(full_text: str, novel_title: str) -> dict[str, Any]:
    client = get_client()
    chunks = chunk_text(full_text)
    analyses: list[dict[str, Any]] = []

    for index, chunk in enumerate(chunks, start=1):
        print(f"分析分块 {index}/{len(chunks)}...")
        analyses.append(analyze_chunk(client, chunk, index, len(chunks)))

    return merge_analyses(client, novel_title, analyses)


def save_knowledge_base(novel_title: str, data: dict[str, Any]) -> Path:
    output_path = Path(f"knowledge_base_{novel_title}.json")
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


def main() -> None:
    filepath = input("请输入小说 TXT 路径: ").strip().strip('"')
    novel_title = safe_title(filepath)
    full_text = read_txt(filepath)
    data = analyze_global_novel(full_text, novel_title)
    output_path = save_knowledge_base(novel_title, data)
    print(f"知识库已生成: {output_path}")


if __name__ == "__main__":
    main()
