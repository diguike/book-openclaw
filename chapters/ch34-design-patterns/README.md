---
title: 第 34 章 — OpenClaw 的 10 个核心设计模式
feishu_url: "https://www.feishu.cn/wiki/O8A5wyYbEimttlkcUJpcKQUhnsd"
last_synced: "2026-05-03"
---

# 第 34 章 — OpenClaw 的 10 个核心设计模式

读完这章，你将得到 10 个可以直接迁移到自己项目中的 Agent 系统设计模式。每个模式都从 OpenClaw 的真实源码中提炼而来，包含问题场景、实现方案、权衡分析和迁移指南。

前面 33 章拆解了 OpenClaw 的每一个子系统。这一章把散落在各处的设计决策收拢起来，抽象成独立于 OpenClaw 的通用模式。你不需要用 OpenClaw，也能把这些模式带到任何 Agent 项目里。

---

## 34.1 文件驱动配置（Workspace as Source of Truth）

### 问题

Agent 的行为需要可定制——人格、指令、约束、工具偏好。传统做法是写进数据库或通过 API 配置面板管理。但 Agent 系统的配置本质上是"给 LLM 看的文本"，数据库在这里引入了不必要的间接层：版本管理不直观，协作编辑困难，用户还需要学习一套管理界面。

### 方案

OpenClaw 用 Markdown 文件定义 Agent 的一切行为。`SOUL.md` 定义人格和语气，`AGENTS.md` 定义工作规范，`HEARTBEAT.md` 定义主动行为策略，`BOOTSTRAP.md` 定义首次运行流程。这些文件统一放在 workspace 目录下，系统启动时读取并注入 system prompt。

核心实现在 `src/agents/system-prompt.ts`。`CONTEXT_FILE_ORDER` 定义了文件的加载优先级：

```typescript
const CONTEXT_FILE_ORDER = new Map<string, number>([
  ["agents.md", 10],
  ["soul.md", 20],
  ["identity.md", 30],
  ["user.md", 40],
  ["tools.md", 50],
  ["bootstrap.md", 60],
  ["memory.md", 70],
]);
```

文件按优先级排序后，通过 `buildProjectContextSection()` 拼装进 system prompt。如果存在 `SOUL.md`，系统会额外注入一条指令："embody its persona and tone"——这不是建议，而是强制要求。

`buildBootPrompt()` 在 `src/gateway/boot.ts` 中处理首次启动：读取 `BOOT.md` 的内容，构造一条专用 prompt 让 Agent 执行初始化流程。整个过程没有任何数据库参与。

### 权衡

文件驱动配置的主要代价是缺乏结构化校验。Markdown 文件是自由文本，写错了不会报语法错误，只会让 LLM 的行为偏离预期。OpenClaw 通过 frontmatter 解析（`src/agents/skills/frontmatter.ts`）给部分文件加上了结构化元数据，但核心行为指令仍然依赖自然语言。

另一个代价是多人协作时的冲突管理。文件放在 workspace 里意味着要用 Git 管理，这对非技术用户不太友好。

### 迁移指南

在你自己的 Agent 项目里：

1. 在项目根目录建立一个 `agent/` 目录，放入 `persona.md`（人格）、`rules.md`（行为规范）、`tools.md`（工具使用指南）
2. 启动时读取这些文件，按固定顺序拼装到 system prompt 中
3. 给需要结构化数据的文件加 YAML frontmatter，运行时用 `gray-matter` 之类的库解析
4. 用 Git 管理这些文件的版本，diff 就是 Agent 行为的变更记录

详见第 13 章。

---

## 34.2 按需加载能力（Skills as Demand-Loaded Instructions）

### 问题

Agent 需要处理各种专业任务——操作 Git、写 SQL、调用特定 API。为每种能力写一套完整的指令文本，全部塞进 system prompt，会迅速耗尽 context window。50 个 skill 的完整指令可能占用 10 万 token，而一次对话通常只需要其中 1-2 个。

### 方案

OpenClaw 把 skill 拆分成两层：元数据索引和完整指令。元数据索引始终注入 system prompt，包含 skill 的名称、描述和文件路径；完整指令只在 LLM 判断需要时才通过 read 工具加载。

`src/agents/skills/skill-contract.ts` 中的 `formatSkillsForPrompt()` 负责生成元数据索引：

```typescript
export function formatSkillsForPrompt(skills: Skill[]): string {
  const lines = [
    "The following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    // ...
    "<available_skills>",
  ];
  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}
```

system prompt 中的 Skills 段落（`buildSkillsSection()`）给出了明确的加载策略：扫描所有 skill 的描述，选择最匹配的一个，用 read 工具加载它的 `SKILL.md`，然后按指令执行。"never read more than one skill up front"——这是硬约束，防止 LLM 贪心加载。

`src/agents/skills/workspace.ts` 中的 `compactSkillPaths()` 还做了一个细节优化：把 home 目录前缀替换成 `~`，每个路径节省 5-6 个 token。52 个内置 skill 加起来就是几百 token 的节省。

### 权衡

按需加载意味着每次使用 skill 都需要一次额外的工具调用（read 文件），增加了延迟和 token 消耗。如果 LLM 判断错误（选错 skill 或该用 skill 时没用），用户体验会下降。

此外，skill 的描述必须足够精确，让 LLM 仅凭描述就能判断是否匹配。这对 skill 作者提出了写作要求。

### 迁移指南

1. 把每个能力写成独立的指令文件，放在 `skills/` 目录下
2. 每个文件开头用 YAML frontmatter 写上 `name` 和 `description`
3. 启动时只把名称和描述列表注入 system prompt，格式可以用 XML 或 JSON
4. 在 system prompt 中写明加载规则："匹配到再读，一次只读一个"
5. 提供 read 工具让 LLM 自己加载完整指令

详见第 14 章。

---

## 34.3 单写者架构（Single-Writer per Session）

### 问题

一个 Agent 可能同时处理多个来源的消息：用户在 Telegram 发了一条，Slack 也来了一条，cron 任务触发了一个 heartbeat。如果这些消息并发修改同一个 session 的状态（transcript 文件、session store），就会产生竞态条件——丢失消息、transcript 错乱、状态不一致。

### 方案

OpenClaw 对每个 session 实施单写者模型：同一时刻只有一个进程可以写入特定 session 的状态文件。实现在 `src/agents/session-write-lock.ts`。

锁机制基于文件系统的 exclusive create（`open("wx")`）：创建锁文件时写入进程 PID 和启动时间，其他进程尝试创建同一文件会失败。系统还有一个 watchdog 定时器（默认 60 秒间隔）检测过期锁：如果锁持有时间超过 5 分钟，或者持有进程已经不存在（通过 `/proc/pid/stat` 验证），锁会被清理。

```typescript
const DEFAULT_STALE_MS = 30 * 60 * 1000;      // 30 分钟判定为过期
const DEFAULT_MAX_HOLD_MS = 5 * 60 * 1000;     // 最长持有 5 分钟
const DEFAULT_WATCHDOG_INTERVAL_MS = 60_000;    // 每分钟检查一次
```

session store 的更新（`src/config/sessions/store.ts`）在写入前必须先获取锁（`acquireSessionWriteLock`）。第 6 章详细分析了这个模型如何与 Lane-aware 命令队列配合——消息先排队，按顺序交给写者处理，而不是并发竞争。

### 权衡

单写者模型牺牲了并发吞吐。如果一个 session 正在处理长时间的 LLM 调用（可能几十秒），后续消息必须排队等待。OpenClaw 通过 sub-agent（详见模式 34.9）缓解这个问题：长任务可以 spawn 到新 session 执行，不阻塞主 session。

锁文件方案也有局限：它只在同一台机器上有效。分布式部署需要换用 Redis 锁或数据库行锁。

### 迁移指南

1. 给每个 session 分配一个唯一 ID，用文件锁或内存锁保护其状态
2. 消息到达时先进队列，由 session 的写者按序处理
3. 锁必须有超时和自动清理机制，防止进程崩溃导致死锁
4. 长时间任务考虑拆分到独立 session 执行

详见第 6 章。

---

## 34.4 Context Window 作为可管理资源

### 问题

LLM 的 context window 是有限的。一次对话可能包含几十轮交互、大量工具输出、长代码块。如果不主动管理，context 会溢出，要么被截断（丢失关键信息），要么触发 API 错误。

### 方案

OpenClaw 把 context window 当作类似内存的可管理资源，实施了完整的生命周期管理。核心实现在 `src/agents/pi-embedded-runner/compact.ts`。

**Compaction（压缩）** 是核心机制：当 transcript 接近 context 上限时，OpenClaw 调用 LLM 自身来总结之前的对话，把长 transcript 压缩成摘要。`compactWithSafetyTimeout()` 确保压缩本身不会无限运行。压缩前后通过 hook 系统（`runBeforeCompactionHooks` / `runAfterCompactionHooks`）通知其他模块。

**Transcript 轮换**（`shouldRotateCompactionTranscript` / `rotateTranscriptAfterCompaction`）在压缩后将旧 transcript 归档，开始新的 transcript 文件，防止单个文件无限增长。

**Tool result 截断**（`src/agents/session-tool-result-guard.ts`）在工具输出写入 transcript 之前就限制其长度，是 context 管理的第一道防线。

**预算控制**（`resolveContextWindowInfo` 在 `src/agents/context-window-guard.ts`）在每次 LLM 调用前检查剩余 context 空间，决定是否需要触发压缩。

这四层机制形成了一个完整的 context 管理流水线：截断 -> 预算检查 -> 压缩 -> 轮换。

### 权衡

Compaction 本身消耗 token（需要 LLM 调用来做总结），且会丢失细节——压缩后的摘要不可能包含原始对话的所有信息。OpenClaw 通过 `hasMeaningfulConversationContent()` 判断哪些内容值得保留，但判断标准不可能完美。

另一个问题是 compaction 的时机：太早浪费 token，太晚可能来不及。这需要根据模型的 context 大小和实际使用模式调参。

### 迁移指南

1. 设定 context 预算阈值（如总 token 的 80%），超过时触发压缩
2. 工具输出在写入 transcript 前先截断（如限制 10K 字符）
3. 压缩可以用一次 LLM 调用实现："请总结以下对话的关键信息和结论"
4. 压缩后保存完整 transcript 到磁盘，作为历史记录
5. 记录压缩时间点和原因，便于调试

详见第 12 章。

---

## 34.5 从无状态到有状态（Statefulness from Statelessness）

### 问题

LLM 本身是无状态的：每次 API 调用都是独立的，模型不记得上一次对话的内容。但用户期望 Agent 有"记忆"——记住之前的对话、学到的偏好、正在进行的任务。如何在无状态的基础设施上构建有状态的体验？

### 方案

OpenClaw 的答案是：用文件系统构建状态层。每个 session 的对话历史保存在 transcript 文件中（JSON 格式），每次 LLM 调用前把历史加载回来作为 context 的一部分。这是最基础的状态——对话记忆。

但 OpenClaw 的状态层远不止 transcript。Session store（`src/config/sessions/store.ts`）维护每个 session 的元数据：当前模型、delivery context、最后活跃时间。Agent 配置目录（`~/.openclaw/agents/<agentId>/`）保存跨 session 的持久状态：auth profiles、skill 偏好、memory 索引。

`src/agents/auth-profiles.ts` 展示了一个典型的状态管理模式：auth profiles 记录每个 provider 的认证状态、冷却时间、使用统计。`markAuthProfileFailure()` 在某个 profile 失败时更新状态，`clearExpiredCooldowns()` 自动清理过期的冷却标记。这些状态全部存储在 JSON 文件中，没有数据库参与。

状态的分层结构是：
- **Ephemeral**：单次 LLM 调用的 context（内存中）
- **Session**：transcript + session store（文件系统，session 生命周期）
- **Agent**：auth profiles、config、memory（文件系统，跨 session 持久化）
- **Workspace**：SOUL.md、skills、项目文件（文件系统，用户管理）

### 权衡

文件系统作为状态存储的主要缺点是性能和并发控制。JSON 文件的读写不是原子的（OpenClaw 用 `writeTextAtomic` 缓解），且不支持部分更新。随着状态增大，全量读写的开销会增加。

不过对于个人 Agent 场景，文件系统的简单性优势明显：无需运维数据库，状态可以用文本编辑器查看和修改，备份就是复制目录。

### 迁移指南

1. 把状态分成至少三层：request 级（内存）、session 级（文件）、全局级（文件）
2. Session transcript 用 JSONL 格式（每行一条消息），追加写入，读取时按行解析
3. 全局状态（如 auth）用 JSON 文件，写入时先写临时文件再 rename（原子替换）
4. 定期清理过期的 session 文件，防止磁盘占满

详见第 5 章和第 15 章。

---

## 34.6 纵深防御安全模型

### 问题

Agent 能执行命令、读写文件、发送消息。一旦被恶意 prompt 注入攻击（通过用户输入或被 Agent 读取的网页内容），后果可能很严重。单层安全防护不够——任何单一防线都可能被绕过。

### 方案

OpenClaw 实施了多层安全机制，每一层独立运作，即使某一层被突破，后续层仍然能阻止攻击。

**第一层：Owner 身份验证**。system prompt 中注入 authorized sender 的哈希标识（`buildOwnerIdentityLine()`），Agent 只响应已授权的发送者。注意这里用了 HMAC-SHA256 而不是明文——防止 prompt 注入时伪造身份。

**第二层：Channel 安全审计**。`src/security/audit-channel.ts` 中的 `collectChannelSecurityFindings()` 在启动时检查每个 channel 的安全配置——DM 策略是否太宽松、group policy 是否开放等。发现 `dms: open` 这类高危配置直接标记为 `critical`。

**第三层：命令执行审批**。Bash 工具的每次执行都经过审批流程（`src/agents/bash-tools.exec-approval-request.ts`），危险命令需要用户确认。审批 ID 是一次性的，防止重放。

**第四层：Sandbox 隔离**。命令可以在 Docker 容器中执行，限制文件系统访问和网络权限。

**第五层：Tool result 过滤**。工具输出在返回给 LLM 之前经过审查和截断，防止恶意内容通过工具结果注入 context。

**第六层：Advisory prompt 指令**。system prompt 中的安全指令（不要执行未授权的操作、不要泄露凭据等）。这是"软"防御——LLM 通常会遵守，但不能保证。

**第七层：运行时策略引擎**。`src/agents/agent-runtime-policy.ts` 定义运行时策略，限制 Agent 的行为边界。

关键设计思想是区分 advisory（建议性，通过 prompt）和enforcement（强制性，通过代码）。Advisory 防线可以被绕过，但 enforcement 防线（文件锁、容器隔离、命令白名单）不依赖 LLM 的"自觉"。

### 权衡

多层安全的代价是复杂度和延迟。每一层检查都需要时间，且增加了出错的调试难度——用户的合法操作可能被某一层误拦截。OpenClaw 通过 `openclaw doctor` 命令（`src/commands/doctor-session-locks.ts`）帮助用户诊断安全相关的问题。

另一个权衡是"安全 vs 能力"。太严格的安全策略会让 Agent 变得不好用。OpenClaw 的做法是"强默认，显式放宽"——默认安全，用户可以通过配置主动降低特定场景的安全级别。

### 迁移指南

1. 至少实施三层：身份验证（谁在用）、命令审批（做什么）、沙箱隔离（在哪做）
2. 明确区分 advisory 防线（prompt 指令）和 enforcement 防线（代码逻辑），不要把安全完全交给 prompt
3. 危险操作（文件删除、网络请求、shell 命令）默认需要确认，提供配置项让信任用户跳过
4. 记录所有安全事件的审计日志，包括被拦截的操作

详见第 23 章和第 24 章。

---

## 34.7 Provider 抽象与故障转移

### 问题

Agent 系统通常依赖外部 LLM API（OpenAI、Anthropic、Google 等）。这些 API 会遇到限速（429）、过载（503）、认证过期（401）、计费问题（402）等各种故障。如果只对接一个 provider，任何故障都意味着 Agent 完全不可用。

### 方案

OpenClaw 通过 plugin 架构实现了 provider 抽象。Core 拥有通用的调用循环，provider plugin 拥有认证、模型目录和运行时 hook。`src/plugins/providers.ts` 负责 provider 的发现和注册，通过 manifest registry 管理每个 provider 的元数据。

故障转移的核心是 `FailoverError`（`src/agents/failover-error.ts`）。每种故障原因都有明确的分类：

```typescript
export function resolveFailoverStatus(reason: FailoverReason): number | undefined {
  switch (reason) {
    case "billing":       return 402;
    case "rate_limit":    return 429;
    case "overloaded":    return 503;
    case "auth":          return 401;
    case "auth_permanent": return 403;
    case "timeout":       return 408;
    case "model_not_found": return 404;
    // ...
  }
}
```

Auth profile 系统（`src/agents/auth-profiles.ts`）维护多个认证凭据的状态。当某个 profile 失败时，`markAuthProfileFailure()` 将其标记为冷却状态，`calculateAuthProfileCooldownMs()` 计算冷却时间。系统自动切换到下一个可用的 profile，而不是直接报错。

`resolveAuthProfileOrder()` 决定 profile 的尝试顺序，`clearExpiredCooldowns()` 在冷却期过后自动恢复。整个机制让 Agent 在单个 provider 故障时能自动降级到备选方案。

### 权衡

多 provider 支持的代价是每个 provider 的行为差异需要逐一处理。不同模型对工具调用的格式要求不同，streaming 的实现细节不同，错误码的含义也不完全一致。OpenClaw 的 `extensions/` 目录里有 31 个插件，每个都有自己的适配逻辑。

故障转移也可能产生意外行为：用户可能没意识到 Agent 已经从 Claude 切换到了 GPT，输出风格和能力突然变化。

### 迁移指南

1. 定义统一的 provider 接口：`chat(messages, tools, config) -> AsyncStream<chunk>`
2. 每个 provider 实现这个接口，处理自己的认证和格式转换
3. 维护一个 profile 池，记录每个 profile 的状态（正常/冷却/禁用）
4. 遇到可重试的错误（429/503）时自动切换到下一个 profile，记录失败原因
5. 设置冷却时间（如 429 冷却 60 秒，401 冷却 10 分钟），过期后自动恢复

详见第 11 章。

---

## 34.8 消息标准化与 Bridge Pattern

### 问题

Agent 需要接入多个消息渠道——Telegram、Slack、Discord、WhatsApp、Web。每个渠道的消息格式、能力集、交互模式都不同。如果为每个渠道写一套独立的处理逻辑，代码量会爆炸，且新增渠道的成本极高。

### 方案

OpenClaw 用 Channel Plugin 架构实现了消息标准化。每个渠道注册为一个 plugin，实现统一的接口（`src/channels/plugins/types.core.ts`）。核心定义了 `ChannelPlugin` 类型，每个 plugin 需要提供：消息接收适配器、发送适配器、能力声明、工具贡献。

`ChannelMessageToolSchemaContribution` 让每个渠道可以向统一的 `message` 工具贡献自己特有的字段：

```typescript
export type ChannelMessageToolSchemaContribution = {
  properties: Record<string, TSchema>;
  actions?: readonly ChannelMessageActionName[] | null;
  visibility?: "current-channel" | "all-configured";
};
```

`visibility` 字段控制渠道特有的字段在什么时候可见：`"current-channel"` 表示只在该渠道激活时暴露，`"all-configured"` 表示只要配置了就暴露（用于 cron 跨渠道发送等场景）。

system prompt 的 Messaging 段落（`buildMessagingSection()`）根据当前渠道的能力动态调整内容——有 inline buttons 的渠道告诉 LLM 怎么用按钮，没有的就说明这个功能不可用。

这是经典的 Bridge 模式：Agent runtime 和消息渠道是两个独立变化的维度，通过 plugin 接口解耦。新增渠道不需要修改 core 代码，只需要实现 plugin 接口。

### 权衡

统一抽象意味着只能取渠道能力的"最大公约数"。某些渠道特有的高级功能（如 Telegram 的 inline keyboard、Discord 的 embed）需要通过 schema contribution 扩展，增加了接口复杂度。

另一个问题是调试难度：消息经过了标准化层的转换，出问题时需要在渠道侧和核心侧都排查。

### 迁移指南

1. 定义核心消息类型：`{ text, media?, metadata?, actions? }`
2. 每个渠道实现两个适配器：`receive(rawMessage) -> CoreMessage` 和 `send(coreMessage) -> rawFormat`
3. 渠道注册时声明自己的能力（支持图片、支持按钮、支持回复等）
4. Agent runtime 根据当前渠道的能力集调整行为，不要硬编码渠道特定的逻辑

详见第 17 章。

---

## 34.9 异步编排（Sub-Agent Spawn Pattern）

### 问题

有些任务很耗时（运行测试套件、搜索大量文件、多步骤的代码重构），如果在主 session 中同步执行，用户必须等待完成才能继续对话。复杂任务可能需要拆分成多个并行子任务，但主 session 的单写者模型阻止了并发执行。

### 方案

OpenClaw 的 sub-agent 系统（`src/agents/subagent-spawn.ts`）允许主 Agent spawn 子 Agent 到独立的 session 中执行。每个子 Agent 有自己的 session、自己的 transcript、自己的 context window，与主 Agent 并行运行。

spawn 时可以控制 context 传递策略：

```typescript
export const SUBAGENT_SPAWN_CONTEXT_MODES = [
  // 子 Agent 独立运行，不继承父 context
  // 子 Agent 继承父 session 的 context fork
] as const;
```

`resolveSubagentCapabilities()` 决定子 Agent 能使用哪些工具，`resolveSubagentTargetPolicy()` 决定子 Agent 能访问哪些资源。关键约束是深度限制：

```typescript
const DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH = /* 限制嵌套层数 */;
const DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT = /* 限制每个 Agent 的子 Agent 数 */;
```

子 Agent 完成后，结果通过 `sessions_send` 工具回传给父 Agent。主 Agent 可以用 `subagents(action=list|steer|kill)` 管理正在运行的子 Agent。

system prompt 中的编排指令直接告诉 LLM 何时使用 sub-agent：

```
Sub-agent orchestration → use sessions_spawn(...) to start delegated work;
omit context for isolated children,
set context:"fork" only when the child needs the current transcript.
```

### 权衡

Sub-agent 消耗额外的 LLM 调用和 token。每个子 Agent 需要自己的 system prompt，且无法直接共享父 Agent 的 context（除非 fork，但 fork 会复制大量 token）。

协调多个子 Agent 的结果也是一个工程挑战。父 Agent 需要追踪每个子 Agent 的状态，处理超时和失败，合并结果。OpenClaw 通过 `subagent-registry.ts` 维护子 Agent 的注册表来管理这个复杂度。

### 迁移指南

1. 定义 spawn 接口：`spawn({ task, context?, tools?, timeout? }) -> sessionId`
2. 子任务在独立 session 中执行，有自己的 context 和状态
3. 设置深度限制（建议最多 2-3 层）和并发限制（建议最多 5-10 个子 Agent）
4. 完成后通过消息机制通知父 session，不要用共享内存
5. 实现超时和取消机制，防止子 Agent 无限运行

详见第 19 章。

---

## 34.10 Heartbeat/Cron 主动行为

### 问题

大部分 Agent 框架把 Agent 设计成被动的——用户发消息，Agent 回复。但很多场景需要 Agent 主动行为：定时检查服务状态、每天汇总消息、到了截止日期提醒用户。被动模型无法覆盖这些需求。

### 方案

OpenClaw 通过 Heartbeat 和 Cron 机制让 Agent 具备主动行为能力。

**Heartbeat** 是轮询机制：系统定期向 Agent 发送一个 heartbeat 消息，Agent 根据 `HEARTBEAT.md` 的指令决定是否需要执行操作。如果不需要，回复 `HEARTBEAT_OK`；如果需要，执行操作并报告结果。

`src/cron/heartbeat-policy.ts` 控制 heartbeat 的过滤策略。`shouldSkipHeartbeatOnlyDelivery()` 判断 heartbeat 的输出是否值得发送给用户——如果只是 `HEARTBEAT_OK`，就不发送，避免打扰用户：

```typescript
export function shouldSkipHeartbeatOnlyDelivery(
  payloads: HeartbeatDeliveryPayload[],
  ackMaxChars: number,
): boolean {
  if (payloads.length === 0) return true;
  const hasAnyMedia = payloads.some(
    (payload) => resolveSendableOutboundReplyParts(payload).hasMedia,
  );
  if (hasAnyMedia) return false;
  return payloads.some((payload) => {
    const result = stripHeartbeatToken(payload.text, {
      mode: "heartbeat",
      maxAckChars: ackMaxChars,
    });
    return result.shouldSkip;
  });
}
```

**Cron** 是更结构化的定时任务系统。`src/cron/delivery.ts` 处理 cron 任务的输出投递：每个 cron job 可以配置目标渠道和用户，执行结果通过 `deliverOutboundPayloads()` 发送。Cron job 在隔离的 Agent 实例中运行（`src/cron/isolated-agent/`），有自己的 session 和安全边界。

system prompt 中的 Heartbeat 段落（`buildHeartbeatSection()`）给出了明确的行为规范：heartbeat poll 时如果无事可做就回复 `HEARTBEAT_OK`，有事要做就执行并报告。

### 权衡

主动行为意味着持续的资源消耗。每次 heartbeat 至少需要一次 LLM 调用来判断"要不要做什么"。如果 heartbeat 间隔太短，成本会很高；间隔太长，响应不及时。

Cron 任务的错误处理也比被动场景更复杂：用户不在线时出了错，Agent 需要自己决定是否重试、怎么通知用户。OpenClaw 通过 `resolveFailureDestination()` 和 `CronFailureDeliveryPlan` 处理这个问题。

### 迁移指南

1. 实现一个简单的 heartbeat 循环：每 N 分钟读取 `HEARTBEAT.md`，构造 prompt 询问 LLM 是否需要行动
2. 如果 LLM 回复"不需要"（匹配特定 token），跳过投递；否则执行操作并发送结果
3. Cron 任务在隔离的 session 中执行，配置目标渠道用于投递结果
4. 实现失败通知：cron 任务出错时通知 owner

详见第 16 章。

---

## 34.11 横向对比：OpenClaw vs LangGraph vs CrewAI

前面 10 个模式都是从 OpenClaw 源码中提炼的。但 OpenClaw 不是唯一的 Agent 框架，甚至不是最流行的。LangGraph（LangChain 生态的图编排框架）和 CrewAI（角色扮演多 Agent 编排框架）是当前最活跃的两个替代方案。这一节不做功能清单对比——那种表格到处都有。这里关注的是三个框架在架构层面的设计取舍：它们各自选择了什么，放弃了什么，以及这些选择适合什么场景。

### 核心抽象

三个框架对"Agent 系统应该长什么样"给出了截然不同的回答。

**OpenClaw：Gateway + Session + Channel。** OpenClaw 的核心抽象围绕"消息驱动的常驻服务"展开。Gateway 是一个 WebSocket 守护进程，持续监听来自多个 Channel（Telegram、Slack、Discord 等）的消息。每条消息进入一个 Session，Session 维护独立的对话状态和 transcript。这套抽象直接反映了 OpenClaw 的设计目标：一个 7x24 运行的个人 Agent，能同时接入多个消息渠道。

**LangGraph：StateGraph + Node + Edge。** LangGraph 把 Agent 工作流建模为有向图。`StateGraph` 定义状态的 schema（一个 TypedDict 或 Pydantic model），`Node` 是处理状态的函数，`Edge` 是节点之间的转移——可以是固定的，也可以是条件分支（`add_conditional_edges()`）。状态在节点之间流动，每个节点读取状态、执行逻辑、写回更新。这是显式的状态机模型，适合需要精确控制执行路径的场景。

**CrewAI：Crew + Agent + Task。** CrewAI 用"团队协作"的隐喻来组织多 Agent 系统。一个 `Crew` 包含多个 `Agent`（每个 Agent 有角色、背景故事、目标），`Task` 定义具体的工作项。执行模式有两种：`Process.sequential`（任务按定义顺序依次执行）和 `Process.hierarchical`（一个 manager agent 动态分配任务给其他 agent）。这套抽象降低了入门门槛——定义角色和任务比画状态图直观得多。

**取舍分析：** OpenClaw 的 Gateway/Session/Channel 模型为长期运行的消息服务量身打造，但如果你只需要跑一个批处理 pipeline，这套抽象就过重了。LangGraph 的状态机模型提供了最细粒度的流程控制，代价是每一条执行路径都需要你显式定义——图的复杂度和业务逻辑的复杂度同步增长。CrewAI 的角色隐喻让原型开发很快，但"角色"和"任务"的粒度比较粗，遇到需要精确控制 agent 之间交互顺序的场景，sequential 和 hierarchical 两种模式就不够用了。

### 状态管理

Agent 系统的状态管理直接决定了它能支撑多复杂的工作流、多长的对话、以及出问题时能不能恢复。

**OpenClaw：文件系统 JSONL。** OpenClaw 把所有状态存在文件系统里。Transcript 用 JSON 文件记录完整对话历史，Session store 用 JSON 文件记录 session 元数据，Auth profiles 用 JSON 文件记录认证状态。写入时先写临时文件再 rename（原子替换），并发控制靠文件锁（`open("wx")`）。状态分四层：Ephemeral（内存）-> Session（文件，session 生命周期）-> Agent（文件，跨 session）-> Workspace（用户管理的 Markdown 文件）。

**LangGraph：内存 State + Checkpointer。** LangGraph 的状态是一个 Python 字典（或 TypedDict），在图的节点之间传递。默认情况下状态只存在于内存中，但 LangGraph 提供了 Checkpointer 机制来持久化状态快照。官方实现包括 `InMemorySaver`（实验用）、`SqliteSaver`（本地开发）和 `PostgresSaver`（生产环境，LangSmith 内部也在用）。每次状态转移都可以保存 checkpoint，支持时间旅行调试和中断后恢复。Checkpointer 按 thread 组织，每个 thread 维护一条独立的 checkpoint 链。

**CrewAI：共享内存 + Task 输出链。** CrewAI 的状态管理分两层。第一层是 Task 输出链：sequential 模式下，前一个 Task 的输出自动注入为下一个 Task 的 context。这是隐式的状态传递——你不需要手动管理，但也意味着你对传递什么内容缺乏精细控制。第二层是共享内存系统（`memory=True` 启用）：每个 Task 完成后，CrewAI 自动从输出中提取关键事实并存入共享内存；下一个 Agent 开始工作前，自动从内存中检索相关上下文。共享内存支持短期、长期、实体和上下文四种类型。

**取舍分析：** OpenClaw 选择文件系统的理由很实际——个人 Agent 场景不需要数据库，文件可以用文本编辑器查看和 Git 管理。但文件系统不支持部分更新，状态增大后全量读写的开销会上升，且文件锁只在单机有效。LangGraph 的 Checkpointer 设计更灵活，存储后端可插拔，且 checkpoint 链天然支持回滚和重放。代价是你需要为生产环境运维一个 PostgreSQL 实例，且所有需要持久化的状态都必须可序列化（`JsonPlusSerializer` 处理了大部分类型，但自定义对象仍需注意）。CrewAI 的自动化内存最省心，开发者几乎不需要写状态管理代码。但"自动提取关键事实"依赖 LLM 的判断，提取质量不可控；且共享内存的检索精度直接影响 agent 的工作质量——检索到无关信息反而会干扰决策。

### 扩展模型

一个框架能做多少事，很大程度上取决于它的扩展机制。

**OpenClaw：Skills + Extensions + Plugins。** OpenClaw 的扩展分三层。Skills 是 Markdown 文件形式的指令集，按需加载到 system prompt 中（34.2 节已详细分析），52 个内置 skill 覆盖了 Git、SQL、代码审查等常见任务。Extensions 是功能插件，位于 `extensions/` 目录，目前有 31 个，主要是 channel 和 provider 的实现（Telegram、Slack、OpenAI、Anthropic 等）。Plugins 通过 `src/plugin-sdk/` 提供的 SDK 开发，可以注册新的 provider、channel、工具和 hook。三层扩展各有侧重：skill 扩展 Agent 的"知识"，extension 扩展系统的"接入能力"，plugin 扩展系统的"运行时行为"。

**LangGraph：自定义 Node。** LangGraph 的扩展方式是直接的——写一个新的 Node 函数，把它加到图里。Node 可以调用任何 Python 库，没有 SDK 或接口约束。工具调用通过 LangChain 的 `Tool` 抽象集成，LangChain 生态提供了大量现成的工具（搜索、数据库、API 调用等）。要扩展工作流，就是往图里加节点和边。要复用逻辑，就是把子图封装成函数。

**CrewAI：Tools + LangChain 集成。** CrewAI 的 Agent 通过 `tools` 参数挂载工具。框架内置了一批工具（文件读写、搜索等），同时兼容 LangChain 的工具生态。2026 年版本还加入了 MCP（Model Context Protocol）和 A2A（Agent-to-Agent）支持，可以连接外部 Agent 服务。自定义工具只需继承 `BaseTool` 并实现 `_run()` 方法。

**取舍分析：** OpenClaw 的三层扩展模型最完整，但学习曲线也最陡。一个新贡献者需要理解 skill、extension、plugin 三者的区别和各自的生命周期。LangGraph 的"万物皆 Node"最灵活，没有框架层面的约束意味着你可以做任何事——但也意味着没有统一的扩展规范，不同团队写出的 Node 风格可能差异很大。CrewAI 的工具模型最简单，继承 `BaseTool` 就够了，加上 LangChain 生态的工具库，上手成本最低。但 CrewAI 的扩展基本限于"给 Agent 加工具"，无法像 OpenClaw 那样扩展渠道接入或 provider 接入。

### 快速对比

| 维度 | OpenClaw | LangGraph | CrewAI |
|------|----------|-----------|--------|
| **核心模型** | 消息驱动的常驻服务 | 有向图状态机 | 角色扮演团队协作 |
| **核心抽象** | Gateway / Session / Channel | StateGraph / Node / Edge | Crew / Agent / Task |
| **状态存储** | 文件系统（JSON/JSONL） | 内存 + Checkpointer（可插拔） | 共享内存 + Task 输出链 |
| **状态粒度** | 四层分级（Ephemeral → Workspace） | 全局 State dict + checkpoint 链 | Task 级自动传递 |
| **并发模型** | 单写者 + 文件锁 | 图的并行分支 | Sequential / Hierarchical |
| **扩展机制** | Skills + Extensions + Plugins | 自定义 Node + LangChain Tools | BaseTool + LangChain 生态 |
| **多渠道接入** | 原生支持（Channel Plugin） | 不涉及 | 不涉及 |
| **部署形态** | 守护进程（Gateway Daemon） | 库 / API 服务 | 库 / CLI |
| **主要语言** | TypeScript | Python（TS 版已对齐） | Python |
| **适合场景** | 长期运行的个人/团队 Agent | 需要精确控制的复杂工作流 | 快速原型、角色分工明确的任务 |

### 什么场景选谁

**选 OpenClaw**，当你需要一个 7x24 运行的 Agent 服务，能同时接入 Telegram、Slack、Discord 等多个消息渠道，需要完整的安全模型（纵深防御）、主动行为（heartbeat/cron）和多 provider 故障转移。典型场景：个人 AI 助手、团队运维 bot、跨渠道客服 Agent。OpenClaw 的代价是部署和运维成本较高——你需要运行一个守护进程，管理文件系统状态，维护多个渠道的认证配置。

**选 LangGraph**，当你的工作流需要精确的状态控制和复杂的条件分支。LangGraph 的图模型让每一步的执行路径都显式可见，配合 Checkpointer 可以实现断点续跑、人工审批、时间旅行调试。典型场景：多步骤的数据处理 pipeline、需要人工介入的审批流程、对执行顺序有严格要求的业务逻辑。代价是图的定义和维护需要相当的工程投入，小任务用状态机是杀鸡用牛刀。

**选 CrewAI**，当你需要快速搭建一个多 Agent 协作的原型，任务之间的依赖关系相对简单（线性或树形）。CrewAI 的角色隐喻让非工程背景的人也能理解系统结构，sequential 和 hierarchical 两种模式覆盖了大部分常见的协作模式。典型场景：内容生产流水线（调研 -> 撰写 -> 审核）、数据分析 pipeline（采集 -> 清洗 -> 分析 -> 报告）。代价是遇到复杂的 agent 交互模式时，两种内置 process 可能不够用，需要绕过框架自己编排。

没有"最好的框架"——只有最匹配你问题规模和部署约束的框架。

---

## 结语

这 10 个模式覆盖了构建一个完整 Agent 系统需要解决的核心问题：配置管理、能力加载、并发控制、资源管理、状态构建、安全防御、服务接入、渠道适配、任务编排、主动行为。每个模式都不是 OpenClaw 发明的——它们是软件工程中早已存在的思想在 Agent 场景下的具体应用。文件驱动配置源自 Infrastructure as Code，单写者架构源自数据库理论，纵深防御源自信息安全。OpenClaw 的贡献在于把这些模式组合在一起，证明它们在 Agent 系统中是可行的。

这本书到此结束。去动手吧。

## 练习

**思考题**

1. 本章总结的 10 个设计模式中，"文件驱动配置"和"按需加载能力"都强调了文件系统作为核心存储的简单性。但随着 Agent 系统向多租户、分布式方向发展，文件系统的局限性会越来越明显。如果你要将这 10 个模式迁移到一个云原生的多租户 Agent 平台上，哪些模式可以直接复用，哪些需要根本性的重新设计？

2. OpenClaw、LangGraph、CrewAI 三者的核心抽象分别是 Gateway/Session/Channel、StateGraph/Node/Edge、Crew/Agent/Task。如果你要从零设计一个 Agent 框架，面向的场景是"企业内部的自动化工作流平台"（需要审批流、权限控制、审计日志），你会选择哪种抽象模型作为基础？或者你会设计一种不同的抽象？给出你的设计理由。

3. 本书从第 1 章到第 34 章，从全景概述到具体实现再到设计模式提炼，走了一条"自顶向下分析 → 自底向上实现 → 抽象总结"的路径。回顾全书，你认为 OpenClaw 的架构中最值得学习的一个设计决策是什么？最值得质疑的一个设计决策是什么？给出你的判断依据。

---

> 本章来自《OpenClaw 源码解析》开源版 · 作者「递归客」  
> 在线阅读完整书系：[inferloop.dev](https://inferloop.dev)  
> 源码仓库：[github.com/diguike/book-openclaw](https://github.com/diguike/book-openclaw)
