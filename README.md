# 自动化小说改写项目

这是一个基于 DeepSeek API 的 Node.js 长篇中文小说改写流水线，支持知识库构建、章节级改写、多 Agent 质检、详细日志、时间戳版本目录和断点续跑。

## 文件说明

- `custom_rules.json`：用户可调整的改写规则、禁用词、角色备注和高级指令。
- `project_config.json`：项目核心标准和风格约束。
- `build_knowledge_base.js`：分析全文并生成知识库。
- `rewrite_pipeline.js`：主改写流水线。
- `deepseek_config.js`：读取 DeepSeek 环境变量并构造请求。
- `package.json`：Node.js 依赖和 npm 脚本。

## 配置 API Key

推荐新建 `.env.local`，不要把真实密钥写进 README 或提交到 Git：

```env
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_THINKING_TYPE=enabled
DEEPSEEK_REASONING_EFFORT=high
```

如果曾经把真实 Key 写进仓库文件，建议立刻到平台后台轮换密钥。

## 安装与运行

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

脚本会依次询问：

- 小说 TXT 路径
- 知识库 JSON 路径
- 断点续跑目录，直接回车则新建一次运行

## 输出结构

每次新运行都会生成独立目录：

```text
outputs/<时间戳>_<小说名>_<原文hash>/
```

主要文件：

- `manifest.json`：运行清单，记录每章状态、尝试次数、采用稿、风险信息。
- `events.jsonl`：详细结构化日志，每行一个事件。
- `facts_ledger.json`：剧情事实账本，用于约束后续章节连续性。
- `summary_state.json`：前文摘要和前章结尾状态。
- `rewrite_checkpoint.txt`：当前已完成章节合并稿。
- `<小说名>_精修版.txt`：最终输出。
- `chapters/`：每章独立目录，保存每次尝试、导演指令、风格质检、连续性质检和采用稿。

## 断点续跑

如果程序中断，重新运行：

```bash
npm run rewrite
```

前两个输入仍填原小说和知识库，第三个输入填写已有运行目录，例如：

```text
outputs/20260430_043800_小说名_ab12cd34ef56
```

脚本会读取 `manifest.json`，跳过已完成章节，从第一个未完成章节继续。

## 质检流程

主流程按章节顺序执行：

1. Agent 0：分析当前章节基调、角色状态、允许发生的状态变化。
2. Agent A：生成改写指令，明确必须保留和禁止新增的事实。
3. Agent B：生成改写稿。
4. Agent C：做风格、禁用词、连续叙事和目标占比检查。
5. Agent D：专门做剧情连续性质检，检查时间线、关系身份、承诺、制度规则和“已发生/未发生”冲突。
6. 事实账本维护：把稳定事实写入 `facts_ledger.json`，供后续章节使用。

这样可以降低“前面已经发生，后面又当作没发生”这类连续性错误。
