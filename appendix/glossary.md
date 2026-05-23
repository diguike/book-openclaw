---
title: "附录 C — 术语表"
feishu_url: "https://www.feishu.cn/wiki/JLcqwH7Jai0jNtk9yXlcv8agnob"
last_synced: "2026-05-03"
---

# 附录 C — 术语表

按字母顺序排列。括号内为缩写或英文原文。

---

**A2UI (Agent-to-UI)**
Agent 驱动的动态用户界面技术。Agent 在运行时生成前端组件（HTML/React），由 Canvas Host 渲染并展示给用户。与传统 UI 的区别在于界面内容由 LLM 实时决策，而非静态编码。参见第 20 章。

**ACP (Agent Communication Protocol)**
Agent 间通信协议。定义 Sub-Agent 之间的消息格式、任务分发和结果回传的标准接口，基于子进程 stdio 通信实现。参见第 19 章。

**Agent**
一个具有独立身份、配置和对话上下文的 AI 实体。在 OpenClaw 中，每个 Agent 拥有独立的目录（包含 SOUL.md、配置文件等），可以接入多个 Channel，执行工具调用，维护独立的 Memory。一个 Gateway 实例可以同时运行多个 Agent。

**Agent Runtime**
Agent 的推理执行引擎。负责组装 System Prompt、调用 LLM、处理工具执行结果、管理上下文窗口。对应源码中的 `src/agents/pi-embedded-runner/` 目录。

**Binding**
消息上下文到 Agent Session 的映射关系。Thread Binding 将某个渠道的线程/对话绑定到特定的 Agent 和 Session，保证对话上下文的连续性。

**Bootstrap Files**
Agent 的人格定义文件集合，包括 `SOUL.md`、`AGENTS.md`、`TOOLS.md` 等。这些文件在 Agent 启动时被加载，其内容注入到 System Prompt 中，决定 Agent 的身份、行为和工作流程。参见第 13 章。

**Canvas**
Agent 的可视化输出画布。通过 Canvas Host 渲染 A2UI 生成的界面，嵌入在 Web 控制台或客户端应用中。支持实时更新和交互操作。参见第 20 章。

**Channel**
消息渠道/平台。OpenClaw 通过 Channel 抽象统一接入不同的通信平台（Telegram、Discord、Slack、iMessage 等）。每个 Channel 实现消息收发、格式转换、状态指示等功能。参见第 17 章。

**ClawHub**
OpenClaw 的官方插件和 Skill 发布平台。类似 npm registry，提供 Skill 发现、安装、版本管理、安全审核和发布者认证等功能。

**Compaction**
上下文压缩操作。当对话历史超过 Context Window 预算时，Agent Runtime 会调用 LLM 对旧消息生成摘要，用摘要替换原始消息，释放 token 空间。压缩过程会保留关键标识符（文件路径、变量名等）。参见第 12 章。

**Context Window**
LLM 单次推理可处理的 token 上限。OpenClaw 通过 Compaction 和 Pruning 两种策略管理上下文窗口，确保对话在 token 限制内持续进行。参见第 12 章。

**Control UI**
OpenClaw 内置的 Web 管理控制台。通过 Gateway 的 HTTP 端口提供，用于查看 Agent 状态、会话历史、渠道连接、日志等信息。

**Cron**
定时任务调度系统。允许 Agent 按 cron 表达式周期性执行任务，如定时检查邮件、发送日报等。与 Heartbeat 配合实现 Agent 的主动行为。参见第 16 章。

**Extension**
OpenClaw 的内部插件实现。在代码层面对应 `extensions/` 目录下的独立包，每个 Extension 实现特定的 Channel、Provider 或功能。对外文档中统一称为 "Plugin"。参见第 26 章。

**Gateway**
OpenClaw 的核心运行时服务。单进程守护进程，负责管理所有 Agent、Session、Channel 连接、插件和工具调度。对外暴露 WebSocket 和 HTTP 接口。参见第 4 章。

**Heartbeat**
Agent 的心跳机制。在没有外部消息时，Gateway 按配置的间隔向 Agent 发送心跳信号，触发 Agent 主动检查待办事项并执行操作。与 Cron 的区别在于 Heartbeat 是空闲触发，Cron 是固定时间触发。参见第 16 章。

**Hook**
生命周期钩子。允许在特定事件发生时（如聊天前后、工具执行前后）执行自定义脚本或逻辑。通过 `openclaw.json` 的 `hooks` 字段配置。

**JSON5**
JSON 的超集格式，支持注释和尾逗号。OpenClaw 的配置文件 `openclaw.json` 使用 JSON5 格式，提高可读性和编辑体验。

**JSONL (JSON Lines)**
每行一个独立 JSON 对象的文本格式。OpenClaw 用 `.jsonl` 文件存储 Session transcript——每个 Session 对应一个文件，第一行是 Session header，后续每行是一条消息记录。这种格式的优势是追加写入高效（append-only）、支持流式读取、损坏时只影响单行。参见第 6 章。

**Lane**
命令队列的并发控制通道。每个 Session 拥有独立的 Lane，保证同一 Session 的消息按序处理（单写者语义）。不同 Session 的 Lane 可以并行执行。参见第 6 章。

**LLM (Large Language Model)**
大语言模型。OpenClaw 通过 Provider 抽象接入不同厂商的 LLM（Anthropic Claude、OpenAI GPT、Google Gemini 等），作为 Agent 的"大脑"执行推理。

**MCP (Model Context Protocol)**
模型上下文协议。由 Anthropic 提出的标准化协议，用于 LLM 应用与外部数据源/工具的集成。OpenClaw 同时支持 MCP 服务端（暴露 Agent 的工具能力）和 MCP 客户端（消费外部 MCP 服务器提供的工具）。

**Memory**
Agent 的持久化记忆系统。存储跨 Session 的知识和上下文，支持向量检索和关键词搜索的混合查询。采用插件架构，当前支持 LanceDB 和 Wiki 两种存储后端。参见第 15 章。

**NO_REPLY**
Agent 推理循环中的特殊标记。当 LLM 判断当前消息不需要回复时（如消息不是发给自己的），返回 NO_REPLY 标记，Agent Runtime 会跳过回复发送。参见第 7 章。

**Plugin**
OpenClaw 的扩展单元。通过 Plugin SDK 开发，以 npm 包形式分发。分为 Code Plugin（运行时扩展，需要代码执行）和 Bundle Plugin（声明式，仅打包 Skill/MCP 配置）。Plugin 是面向用户的称呼，对应代码层面的 Extension。参见第 26 章。

**Plugin SDK**
插件开发工具包。位于 `src/plugin-sdk/`，通过 `openclaw/plugin-sdk` 路径导入。提供 Channel、Provider、Memory 等子系统的公共 API，插件只能通过 SDK 与核心交互，不能直接访问内部模块。参见第 26 章。

**Provider**
LLM 服务提供商的抽象层。每个 Provider（如 `anthropic`、`openai`、`google`）负责实现请求格式转换、流式解析、认证管理和错误处理。核心只维护通用推理循环，Provider 专属逻辑全部下放到对应的 Extension 中。参见第 11 章。

**Pruning**
上下文裁剪操作。与 Compaction 不同，Pruning 直接丢弃低优先级的消息（如过旧的工具执行结果），不生成摘要。Pruning 是即时操作，不消耗 LLM 调用。参见第 12 章。

**Session**
一次完整的对话上下文。Session 包含消息历史、Compaction 检查点和临时状态。OpenClaw 对每个 Session 保证单写者语义——同一时刻只有一个 Lane 在处理该 Session 的消息。参见第 6 章。

**Skill**
Agent 可加载的能力模块。由 Markdown 文件和可选的工具定义组成，包含系统指令、任务描述和工具配置。Skill 通过 frontmatter 元数据声明名称、描述和依赖。按需加载到 System Prompt，不使用时不占用 token 预算。参见第 14 章。

**SOUL.md**
Agent 的核心身份定义文件。文件内容在 Agent 启动时注入到 System Prompt 的固定位置，定义 Agent 的性格、角色、行为边界等基础人格信息。参见第 13 章。

**Sub-Agent**
由主 Agent 派生的子 Agent。Sub-Agent 拥有独立的推理循环和上下文，通过 ACP 协议与父 Agent 通信。适用于需要并行处理或专业分工的场景（如一个 Agent 负责搜索，另一个负责汇总）。参见第 19 章。

**System Prompt**
发送给 LLM 的系统级指令。OpenClaw 的 System Prompt 由多个段动态拼装：身份信息 + SOUL.md + Skills + 工具描述 + 平台上下文 + Memory 检索结果。拼装顺序经过精心设计，确保 Anthropic prompt cache 的命中率。参见第 8 章。

**Tool Policy**
工具使用策略。定义 Agent 对每个工具的访问权限，分为三级：`allow`（允许，无需确认）、`ask`（需要人工审批）、`deny`（禁止使用）。策略支持通配符匹配和多层叠加。参见第 9 章。

**Workspace**
Agent 的工作目录。包含 Agent 的配置文件、Skill 文件和项目上下文。Workspace 级的 Skill 和 Agent 配置优先于全局配置，实现项目级的 Agent 定制。参见第 18 章。
