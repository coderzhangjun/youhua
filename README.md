# 自动化成人色情小说改写项目

这是一个基于 DeepSeek API 的长篇中文成人色情小说改写流水线。项目支持长文本分块、知识库构建、章节级改写、上下文摘要传递、重试机制和质检回路。

> 说明：本项目实现为成人色情小说优化工具，所有活动围绕色情核心展开。色情描写占比目标 40%，支持多角色原案（母亲、师尊、仙子、烂货/公交车），严格遵循用词规则和比喻禁用标准。背德与纯爱基调严格区分，不混用。

## 文件说明

- `custom_rules.json`：用户可随时修改的规则、禁用词、角色备注和高级指令。
- `project_config.json`：项目核心标准，包含写作目标、安全边界和风格约束。
- `build_knowledge_base.py`：阶段一脚本，分析全文并生成知识库。
- `rewrite_pipeline.py`：阶段二/三主循环，使用多 Agent 流程完成改写与质检。
- `requirements.txt`：Python 依赖。
- `package.json`：Node.js 备选实现依赖和脚本。
- `build_knowledge_base.js`：Node.js 知识库构建脚本。
- `rewrite_pipeline.js`：Node.js 改写流水线脚本。

## 配置 API Key

推荐使用环境变量：

Windows PowerShell:

```powershell
$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
```

macOS / Linux / Git Bash:

```bash
export DEEPSEEK_API_KEY="你的 DeepSeek API Key"
```

代码默认使用：

- `base_url`: `https://api.deepseek.com`
- `model`: `deepseek-chat`

## Python 使用方式

安装依赖：

```bash
pip install -r requirements.txt
```

生成知识库：

```bash
python build_knowledge_base.py
```

按提示输入小说 TXT 路径后，会生成：

```text
knowledge_base_<小说名>.json
```

执行改写：

```bash
python rewrite_pipeline.py
```

按提示输入小说 TXT 路径和知识库 JSON 路径。完成后会生成：

```text
<原名>_精修版.txt
```

处理中还会持续写入检查点：

```text
<原名>_rewrite_checkpoint.txt
```

## Node.js 备选方式

当前环境检测到 `python` 命令不可稳定返回版本信息，因此已同时提供 Node.js 等效实现。

安装依赖：

```bash
npm install
```

生成知识库：

```bash
npm run build-kb
```

执行改写：

```bash
npm run rewrite
```

## 工作流程

1. `build_knowledge_base` 会先按较大文本块分析全文，提取角色档案、章节蓝图、关系变化、全局基调和连续性注意事项。
2. `rewrite_pipeline` 会按“第 X 章”等章节标记切分原文；若没有明显章节标记，则按段落和固定长度进行语义分块。
3. 每章改写前，Agent 0 先识别基调、核心冲突和连续性风险。
4. Agent A 根据配置、知识库和质检反馈生成分镜增强指令。
5. Agent B 执行改写，保持主线、人物动机和前后文连贯。
6. Agent C 做禁用比喻词、动作连续性、用词合规、色情占比和语言质量检查；未通过则反馈给下一轮重写。
7. 每章通过后更新全局摘要和前章尾部上下文，保证长篇处理的连贯性。

## 调整规则

日常调整优先修改 `custom_rules.json`：

- `forbidden_metaphor_words`：不希望出现的比喻结构词（像、如、仿佛等）。
- `forbidden_elegant_words`：不希望出现的套话或雅称（花唇、蜜壶、玉门等）。
- `global_style.max_rewrite_attempts`：每章最大重写次数。
- `global_style.fallback_chunk_chars`：无章节标记时的分块长度。
- `global_style.context_tail_chars`：传给下一章的前文结尾长度。
- `character_specific_notes`：针对具体角色的备注。
- `advanced_directives`：全局张力原则（禁欲符号色情化、身份倒错慢镜、罪恶快感增量、忠实基调）和角色原案（母亲、师尊、仙子、烂货/公交车）。

`project_config.json` 建议少改，用于保存项目核心标准和风格约束。
