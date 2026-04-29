import json
import os
import re
import time
from pathlib import Path
from typing import Any

from openai import OpenAI


BASE_URL = "https://api.deepseek.com"
MODEL = "deepseek-chat"
MAX_RETRIES = 5


def get_client() -> OpenAI:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("请先设置环境变量 DEEPSEEK_API_KEY。")
    return OpenAI(api_key=api_key, base_url=BASE_URL)


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


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


def write_txt(filepath: Path, content: str) -> None:
    filepath.write_text(content, encoding="utf-8")


def call_llm(
    client: OpenAI,
    messages: list[dict[str, str]],
    json_mode: bool = False,
    temperature: float = 0.4,
) -> Any:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            kwargs: dict[str, Any] = {
                "model": MODEL,
                "messages": messages,
                "temperature": temperature,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            response = client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content or ""
            return json.loads(content) if json_mode else content.strip()
        except Exception as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(f"LLM 调用失败: {last_error}")


def split_chapters(text: str, fallback_chunk_chars: int) -> list[dict[str, str]]:
    chapter_pattern = re.compile(
        r"(?m)^(第[零一二三四五六七八九十百千万\d]+[章节卷回部].*)$"
    )
    matches = list(chapter_pattern.finditer(text))

    if matches:
        chapters: list[dict[str, str]] = []
        preface = text[: matches[0].start()].strip()
        if preface:
            chapters.append({"title": "序章", "content": preface})

        for index, match in enumerate(matches):
            start = match.start()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            block = text[start:end].strip()
            title = match.group(1).strip()
            chapters.append({"title": title, "content": block})
        return chapters

    paragraphs = re.split(r"(\n\s*\n)", text)
    chunks: list[dict[str, str]] = []
    current = ""
    for part in paragraphs:
        if len(current) + len(part) <= fallback_chunk_chars:
            current += part
            continue
        if current.strip():
            chunks.append({"title": f"分块{len(chunks) + 1}", "content": current.strip()})
        current = part
    if current.strip():
        chunks.append({"title": f"分块{len(chunks) + 1}", "content": current.strip()})
    return chunks


def compact_config(project_config: dict[str, Any], custom_rules: dict[str, Any]) -> str:
    payload = {
        "project_config": project_config,
        "custom_rules": custom_rules,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def analyze_mood(
    client: OpenAI,
    chapter: dict[str, str],
    knowledge_base: dict[str, Any],
    previous_summary: str,
) -> dict[str, Any]:
    system_prompt = (
        "你是 Agent 0 基调识别。请分析性爱场景的类型和基调。"
        "输出必须是 JSON 对象，包含 genre、emotional_core、mood、conflict、"
        "character_states、continuity_risks、rewrite_focus 字段。"
        "保持客观，可以识别性爱场景的类型和功能，但不要生成具体描写。"
    )
    user_prompt = (
        "请用 JSON 分析下面章节的基调、性爱类型、角色状态和改写重点。\n\n"
        f"知识库摘要：{json.dumps(knowledge_base, ensure_ascii=False)[:6000]}\n\n"
        f"前文摘要：{previous_summary}\n\n"
        f"章节标题：{chapter['title']}\n\n"
        f"原文：\n{chapter['content']}"
    )
    return call_llm(
        client,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        json_mode=True,
        temperature=0.2,
    )


def agent_tension_director(
    client: OpenAI,
    chapter: dict[str, str],
    mood: dict[str, Any],
    project_config: dict[str, Any],
    custom_rules: dict[str, Any],
    previous_feedback: str,
) -> dict[str, Any]:
    system_prompt = (
        "你是 Agent A 张力导演。请生成详细的色情分镜增强指令。输出必须是 JSON 对象，"
        "包含 scene_beats、style_notes、must_keep、must_avoid、revision_notes 字段。"
    )
    user_prompt = (
        "请用 JSON 给主笔生成详细的色情分镜指令，必须包括：\n"
        "1）哪些动作需要慢镜头（如龟头分开阴唇、精液射入等）\n"
        "2）用词切换红线（何时从雅称切换到\"骚屄\"\"鸡巴\"）\n"
        "3）必须穿插的背德/反差心理描写点\n"
        "4）要求补全动作链条，禁止概括跳跃\n\n"
        f"配置：{compact_config(project_config, custom_rules)}\n\n"
        f"基调分析：{json.dumps(mood, ensure_ascii=False)}\n\n"
        f"上一轮质检反馈：{previous_feedback or '无'}\n\n"
        f"章节：{chapter['title']}\n{chapter['content']}"
    )
    return call_llm(
        client,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        json_mode=True,
        temperature=0.3,
    )


def agent_writer(
    client: OpenAI,
    chapter: dict[str, str],
    mood: dict[str, Any],
    director_notes: dict[str, Any],
    knowledge_base: dict[str, Any],
    project_config: dict[str, Any],
    custom_rules: dict[str, Any],
    previous_summary: str,
    previous_tail: str,
) -> str:
    system_prompt = (
        "你是专业成人色情小说主笔人。严格遵循配置中的用词规则和比例要求。"
        "你必须写出连续、直白、无比喻的性爱场面，色情描写占全文 40% 以上。"
        "剧情过渡精简，环境仅用于烘托色情氛围。"
        "写出放荡、羞耻、沉沦的心理反应。"
    )
    user_prompt = (
        "请根据以下材料输出改写后的中文正文，不要输出解释。\n\n"
        f"配置：{compact_config(project_config, custom_rules)}\n\n"
        f"知识库摘要：{json.dumps(knowledge_base, ensure_ascii=False)[:6000]}\n\n"
        f"前文摘要：{previous_summary}\n\n"
        f"前章结尾：{previous_tail}\n\n"
        f"基调分析：{json.dumps(mood, ensure_ascii=False)}\n\n"
        f"导演指令：{json.dumps(director_notes, ensure_ascii=False)}\n\n"
        f"原文章节：{chapter['title']}\n{chapter['content']}"
    )
    return call_llm(
        client,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        json_mode=False,
        temperature=0.55,
    )


def local_forbidden_scan(text: str, custom_rules: dict[str, Any]) -> list[str]:
    terms: list[str] = []
    for key in ("forbidden_metaphor_words", "forbidden_elegant_words"):
        values = custom_rules.get(key, [])
        if isinstance(values, list):
            terms.extend(str(value) for value in values)
    return sorted({term for term in terms if term and term in text})


def estimate_sex_ratio(text: str) -> float:
    sex_markers = (
        "肏", "鸡巴", "小穴", "骚屄", "淫水", "阴唇", "龟头",
        "精液", "阴道", "阴蒂", "肉棒", "骚逼", "干", "插",
        "操", "抽插", "淫", "浪", "奶子", "乳头",
    )
    sentences = [item for item in re.split(r"[。！？!?]", text) if item.strip()]
    if not sentences:
        return 0.0
    hits = sum(1 for sentence in sentences if any(marker in sentence for marker in sex_markers))
    return round(hits / len(sentences), 3)


def agent_qa(
    client: OpenAI,
    rewritten: str,
    chapter: dict[str, str],
    mood: dict[str, Any],
    project_config: dict[str, Any],
    custom_rules: dict[str, Any],
) -> dict[str, Any]:
    forbidden_hits = local_forbidden_scan(rewritten, custom_rules)
    ratio = estimate_sex_ratio(rewritten)

    system_prompt = (
        "你是 Agent C 质检打磨师。请检查禁用比喻词命中、动作连续性、用词合规、"
        "色情占比和语言质量。输出必须是 JSON 对象，包含 passed、issues、"
        "revision_advice、summary、ending_tail 字段。"
    )
    user_prompt = (
        "请用 JSON 质检。检查以下内容，不符合则 passed 设为 false：\n"
        "1）禁用隐喻词命中（forbidden_metaphor_words 和 forbidden_elegant_words）\n"
        "2）用词合规：是否在正确节点切换词汇（前戏适当雅称，交合用粗俗词）\n"
        "3）动作连续性：是否从挑逗直接跳到抽插，缺少中间步骤\n"
        "4）色情占比：通过 LLM 判断色情描写占比是否达到 35% 以上\n\n"
        f"配置：{compact_config(project_config, custom_rules)}\n\n"
        f"本地禁用词命中：{forbidden_hits}\n"
        f"性描写句占比估算：{ratio}\n\n"
        f"基调分析：{json.dumps(mood, ensure_ascii=False)}\n\n"
        f"原文：{chapter['content'][:6000]}\n\n"
        f"改写稿：{rewritten}"
    )
    result = call_llm(
        client,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        json_mode=True,
        temperature=0.2,
    )

    if forbidden_hits:
        result["passed"] = False
        result.setdefault("issues", [])
        result["issues"].append({"type": "forbidden_terms", "terms": forbidden_hits})
    if ratio < 0.35:
        result["passed"] = False
        result.setdefault("issues", [])
        result["issues"].append({"type": "sex_ratio_too_low", "ratio": ratio, "threshold": 0.35})
    return result


def summarize_progress(client: OpenAI, previous_summary: str, chapter_title: str, rewritten: str) -> str:
    system_prompt = (
        "你是连续性编辑。请把前文摘要和本章改写稿合并成简洁续写摘要。"
        "输出必须是 JSON 对象，包含 summary 字段。"
    )
    user_prompt = (
        "请用 JSON 输出不超过 800 字的摘要，保留人物关系、未解决线索和下一章衔接点。\n\n"
        f"旧摘要：{previous_summary}\n\n章节：{chapter_title}\n\n改写稿：{rewritten}"
    )
    data = call_llm(
        client,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        json_mode=True,
        temperature=0.2,
    )
    return str(data.get("summary", "")).strip()


def process_novel(txt_path: str, knowledge_base_path: str) -> Path:
    client = get_client()
    project_config = load_json("project_config.json")
    custom_rules = load_json("custom_rules.json")
    knowledge_base = load_json(knowledge_base_path)

    text = read_txt(txt_path)
    style = custom_rules.get("global_style", {})
    fallback_chunk_chars = int(style.get("fallback_chunk_chars", 8000))
    max_attempts = int(style.get("max_rewrite_attempts", 3))
    context_tail_chars = int(style.get("context_tail_chars", 1200))

    chapters = split_chapters(text, fallback_chunk_chars)
    rewritten_chapters: list[str] = []
    previous_summary = ""
    previous_tail = ""

    for index, chapter in enumerate(chapters, start=1):
        print(f"处理 {index}/{len(chapters)}: {chapter['title']}")
        mood = analyze_mood(client, chapter, knowledge_base, previous_summary)
        feedback = ""
        accepted = ""
        qa_result: dict[str, Any] = {}

        for attempt in range(1, max_attempts + 1):
            print(f"  改写尝试 {attempt}/{max_attempts}")
            director_notes = agent_tension_director(
                client,
                chapter,
                mood,
                project_config,
                custom_rules,
                feedback,
            )
            draft = agent_writer(
                client,
                chapter,
                mood,
                director_notes,
                knowledge_base,
                project_config,
                custom_rules,
                previous_summary,
                previous_tail,
            )
            qa_result = agent_qa(
                client,
                draft,
                chapter,
                mood,
                project_config,
                custom_rules,
            )
            if bool(qa_result.get("passed")):
                accepted = draft
                break
            feedback = json.dumps(qa_result.get("revision_advice", qa_result), ensure_ascii=False)

        if not accepted:
            print("  达到最大重试次数，使用最后一版并附带质检风险。")
            accepted = draft

        rewritten_chapters.append(accepted)
        previous_summary = summarize_progress(client, previous_summary, chapter["title"], accepted)
        previous_tail = accepted[-context_tail_chars:]

        checkpoint = Path(Path(txt_path).stem + "_rewrite_checkpoint.txt")
        write_txt(checkpoint, "\n\n".join(rewritten_chapters))

    output_path = Path(Path(txt_path).stem + "_精修版.txt")
    write_txt(output_path, "\n\n".join(rewritten_chapters))
    return output_path


def main() -> None:
    txt_path = input("请输入小说 TXT 路径: ").strip().strip('"')
    knowledge_base_path = input("请输入知识库 JSON 路径: ").strip().strip('"')
    output_path = process_novel(txt_path, knowledge_base_path)
    print(f"改写完成: {output_path}")


if __name__ == "__main__":
    main()
