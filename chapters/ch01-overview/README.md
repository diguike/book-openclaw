---
title: 第 1 章 — OpenClaw 全景：从 Clawdbot 到 350K Stars
feishu_url: "https://www.feishu.cn/wiki/ACdgwTlhLit0vskQZe9cQ3VNndb"
last_synced: "2026-05-03"
---

# 第 1 章 — OpenClaw 全景：从 Clawdbot 到 350K Stars

读完这章，你会了解 OpenClaw 的来龙去脉、核心定位、技术选型理由，以及它在 Agent 生态中的位置。这些背景知识是后续所有源码分析的基础。

## 1.1 项目背景

OpenClaw 的前身是 2025 年 11 月 Peter Steinberger（PSPDFKit 创始人）用不到一个小时搭建的一个聊天应用——把消息平台和 Claude API 连起来。项目经历了 Warelay → Clawdbot → Moltbot → OpenClaw 四次改名（最后一次是因为 Anthropic 的商标投诉），2026 年 2 月转交给独立的 OpenClaw 基金会运营。截至 2026 年 4 月，GitHub Stars 超过 35 万。

增长速度背后是一个清晰的需求：工程师想要一个跑在自己机器上的 AI 助手，能通过已有的消息渠道（WhatsApp、Telegram、Slack）交互，而不是每次都打开一个新的网页。ChatGPT 和 Claude 的交互方式是"你来找我"，OpenClaw 要做的是"我去找你"。

## 1.2 OpenClaw 到底是什么

一句话定义：**OpenClaw 是一个运行在你自己设备上的个人 AI 助手，通过你已经在用的消息渠道与你交互。**

拆开来看，这句话包含三个关键设计决策。

**本地优先（Local-First）**。Gateway 守护进程跑在你的机器上，数据默认留在本地。这不是一个 SaaS 服务，你不需要把消息发到别人的服务器。对于注重隐私的用户，这是选择 OpenClaw 而非 SaaS 方案的首要原因。

**多渠道接入**。OpenClaw 支持 25 个以上的消息平台：WhatsApp、Telegram、Slack、Discord、微信、QQ、飞书、iMessage、Signal、Matrix、IRC 等等。你不需要为"在 WhatsApp 上用 AI"和"在 Telegram 上用 AI"部署两套系统。一个 Gateway 实例统一处理所有渠道的消息。

**模型无关**。OpenClaw 不绑定特定的 LLM 供应商。它支持 Claude、GPT、Gemini、Mistral、Ollama（本地模型）等主流模型，通过 Provider 抽象层统一接入。你可以在不同的任务中使用不同的模型，也可以配置故障转移策略。

这三个决策共同构成了 OpenClaw 的核心定位：**它是一个 AI 助手的运行时（runtime），而不是一个 AI 模型**。Gateway 是控制平面，负责消息路由、工具调度、Session 管理；模型只是其中一个可替换的组件。

## 1.3 OpenClaw 在 Agent 生态中的位置

理解了 OpenClaw 是什么之后，有必要把它放到更大的图景里看看。

**与 Claude Code / Cursor / Windsurf 的区别**：这些是代码编辑场景的 AI 工具，深度集成在 IDE 中。OpenClaw 不是 IDE 插件，它是一个通用的 Agent 运行时，代码编写只是它能做的事情之一。

**与 LangChain / CrewAI 的区别**：这些是 Agent 开发框架，提供的是构建 Agent 的 SDK 和抽象层。OpenClaw 是一个完整的产品——它自带 Gateway、消息接入、工具系统、部署方案。你不需要在 OpenClaw 之上再写一个应用，它本身就是那个应用。

**与 AutoGPT / MetaGPT 的区别**：这些项目聚焦在"自主 Agent"——让 AI 自己制定计划并执行。OpenClaw 的定位是"个人助手"——它强调的是人机协作，而不是完全自主。Agent 在你的消息流里回答你，执行你交代的任务，而不是独立去完成一个开放式目标。

从技术架构的角度看，OpenClaw 最接近的参照物是一个消息中间件——它的核心是消息路由和协议转换，LLM 是它调用的一个"服务"，而不是它的全部。这个视角对理解后续的源码分析很重要。

## 1.4 架构鸟瞰

OpenClaw 的整体架构是一个三层结构：

```
┌─────────────────────────────────────────────────────┐
│                  Messaging Surfaces                  │
│  WhatsApp  Telegram  Slack  Discord  WebChat  ...   │
└──────────────────────┬──────────────────────────────┘
                       │ 消息标准化
┌──────────────────────▼──────────────────────────────┐
│                  Gateway Daemon                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Sessions │ │ Channels │ │  Router  │            │
│  └──────────┘ └──────────┘ └──────────┘            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │  Agent   │ │  Tools   │ │  Cron    │            │
│  └──────────┘ └──────────┘ └──────────┘            │
└──────────────────────┬──────────────────────────────┘
                       │ API 调用
┌──────────────────────▼──────────────────────────────┐
│                  LLM Providers                       │
│  Claude    GPT    Gemini    Ollama    Bedrock  ...   │
└─────────────────────────────────────────────────────┘
```

**最上层是消息表面（Messaging Surfaces）**。每个消息平台都有一个 Channel Bridge，负责把平台特有的消息格式转换成 OpenClaw 内部的统一格式。不同平台使用不同的 SDK 和协议，但这些差异对上层完全透明——Gateway 只看到标准化后的消息。

**中间层是 Gateway 守护进程**。这是 OpenClaw 的核心，一个单进程的 Node.js 服务，默认监听在 `127.0.0.1:18789`。它管理消息路由、Session、Agent 运行和工具调度。Gateway 通过 WebSocket 协议与客户端通信，使用 JSON 格式的 text frame，基本结构为 `{type: "req" | "res" | "event", ...}`。

**最底层是 LLM Provider**。通过 Provider 抽象层，Gateway 可以和各种模型供应商交互。每个 Provider 适配器处理鉴权、请求格式化、流式响应解析、Token 计数等差异。

这个分层的核心原则是**解耦**：Gateway 不依赖于任何特定的消息平台或模型。你可以单独替换任何一层，而不影响其他层的运行。Extension 系统就是围绕这个原则设计的，后续第 26 章会详细展开。

## 1.5 技术选型：为什么是 TypeScript

OpenClaw 的 VISION.md 中明确回答了这个问题：

> OpenClaw is primarily an orchestration system: prompts, tools, protocols, and integrations. TypeScript was chosen to keep OpenClaw hackable by default. It is widely known, fast to iterate in, and easy to read, modify, and extend.

这个选择是务实的。Agent 系统的核心工作不是数值计算，而是编排——拼接 prompt、调用工具、管理协议、对接各种外部服务。TypeScript 在这些场景中的表达能力和生态支持都很强。Node.js 的异步 I/O 模型天然适合处理大量并发的消息和 API 调用。npm/pnpm 生态提供了现成的 SDK，几乎所有主流消息平台和模型供应商都有官方或社区维护的 TypeScript/JavaScript 库。

从实际数据来看，OpenClaw 的代码库包含约 13,800 个 TypeScript 文件，其中核心代码（`src/`）约 4,500 个非测试文件，扩展（`extensions/`）约 3,800 个非测试文件。项目使用 pnpm workspace 管理 monorepo 结构，Node 24 作为推荐运行时。

工具链方面，OpenClaw 选择了 oxfmt 做格式化（而非 Prettier），Vitest 做测试，tsdown 做构建，tsgo 做类型检查。这些工具都比传统选项更快，在这个规模的代码库中，构建和检查速度是实实在在的生产力问题。

## 1.6 项目规模：一些数字

在深入源码之前，先对这个项目的规模建立一个直觉：

| 指标 | 数值 |
|------|------|
| TypeScript 文件总数 | ~13,800 |
| 全项目代码行数（含测试） | ~267 万行 |
| 非测试代码行数 | ~140 万行 |
| 其中核心代码（src/非测试） | ~80 万行 |
| 其中扩展代码（extensions/非测试） | ~53 万行 |
| 非测试源文件（src/） | ~4,500 个 |
| 扩展目录（extensions/） | 130+ 个 |
| 内置 Skill（skills/） | 52 个 |
| 支持的消息渠道 | 25+ |
| 支持的模型供应商 | 30+ |
| 维护者 | 15+ 人 |
| GitHub Stars | 350K+ |
| 开源协议 | MIT |

140 万行非测试代码——这个数字意味着你不可能"通读"它。这也是这本书存在的意义：帮你找到关键的代码路径，理解核心的设计决策，跳过那些不影响理解的细节。

## 1.7 核心概念速查

后续章节会频繁用到以下概念，这里先给出简要定义：

**Gateway**：OpenClaw 的核心守护进程。一个 Node.js 单进程服务，管理所有消息路由、Session 和工具执行。每台宿主机只运行一个 Gateway 实例。

**Agent**：一个具有独立配置和工作空间的 AI 助手实例。一个 Gateway 可以托管多个 Agent，每个 Agent 有自己的 SOUL.md、Skills 和状态。

**Session**：Agent 与特定来源之间的一次持续对话。Session 是有状态的，包含完整的对话历史（JSONL 格式），每个 Session 同一时刻只允许一个 Agent Run 写入。

**Channel**：一个消息平台的接入适配器。负责把平台特定的消息格式转换成 OpenClaw 内部格式。

**Skill**：一个包含 SKILL.md 的文件夹，用自然语言描述 Agent 在特定领域的操作方式。Skill 不会全量注入 prompt，而是以元数据形式列出，模型按需读取。

**Workspace**：Agent 的工作目录，包含 Bootstrap Files（SOUL.md、AGENTS.md 等）、Skills、Memory 文件。Workspace 是纯文件系统结构，可以用 Git 管理。

**Bootstrap Files**：Agent 每次启动时注入 System Prompt 的配置文件集合，包括 SOUL.md（人格）、AGENTS.md（路由规则）、TOOLS.md（工具说明）、USER.md（用户偏好）、IDENTITY.md（身份元数据）。注意 HEARTBEAT.md 虽然存在于 Workspace 中，但它不属于 Bootstrap Files，而是由 Heartbeat 机制单独读取。

**Provider**：一个 LLM 供应商的接入适配器。每个 Provider 处理特定供应商的鉴权、请求格式、流式响应解析。

**Extension**：一个独立的 pnpm 包，实现特定 Channel 或 Provider 的接入逻辑。OpenClaw 将所有平台相关的代码放在 `extensions/` 目录下，核心代码保持平台无关。

下一章，我们从项目的工程结构开始——在 140 万行代码里，怎么找到你想看的那一部分。

## 练习

**思考题**

1. OpenClaw 选择了"本地优先"的架构，Gateway 跑在用户自己的机器上。如果要把 OpenClaw 改造成 SaaS 多租户架构（一个 Gateway 服务多个用户），哪些核心设计需要重新考虑？Session 管理、安全模型、配置体系分别会受到什么影响？

2. OpenClaw 定位为"AI 助手的运行时"而非"AI 模型"。对比 LangChain、AutoGPT 等项目，它们各自把架构的核心抽象放在了哪一层？这些不同的抽象选择分别适合什么场景？

**动手题**

3. 克隆 OpenClaw 仓库，用 `cloc` 或 `tokei` 统计各目录的代码行数，验证本章给出的"140 万行代码"和"4,500 个非测试 TS 文件"等数字是否准确。观察 `extensions/` 和 `src/` 的代码量比例，思考这个比例说明了什么。
