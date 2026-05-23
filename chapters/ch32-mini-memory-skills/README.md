---
title: 第 32 章 — 实现 Memory 与 Skills 加载
feishu_url: "https://www.feishu.cn/wiki/HizRwbaVBi1i6Xk8lhZca0EDnJc"
last_synced: "2026-05-03"
---

# 第 32 章 — 实现 Memory 与 Skills 加载

> 读完这章，你会实现 Mini OpenClaw 的知识层：文件驱动的 Memory 系统和 Skills 元数据索引。Agent 从此能跨会话记住信息，并按需加载专业技能。

前两章实现了 Gateway + Agent Runtime，系统能接收消息、调用模型、执行工具了。但有个问题：Agent 每次启动都是全新的，不记得之前发生过什么，也不知道有哪些专业技能可用。

这一章补上这两块：Memory 让 Agent 有记忆，Skills 让 Agent 有专长。

## 32.1 Bootstrap Files 加载

在实现 Memory 之前，先回顾一下 bootstrap files。第 13 章讲过，OpenClaw 在 Agent 启动时加载一组引导文件，注入 system prompt。核心文件包括：

| 文件 | 用途 |
|------|------|
| `SOUL.md` | Agent 的身份和人设 |
| `TOOLS.md` | 工具使用偏好和限制 |
| `MEMORY.md` | 长期记忆 |

OpenClaw 用 `CONTEXT_FILE_ORDER`（`src/agents/system-prompt.ts:45`）定义了加载顺序，确保身份信息排在最前面。Mini OpenClaw 在 `buildSystemPrompt()` 中按同样的顺序加载：

```typescript
// 从 .openclaw/ 目录读取 bootstrap files
const soulPath = path.join(config.workspaceDir, '.openclaw', 'SOUL.md');
const soulContent = tryReadFile(soulPath);
if (soulContent) {
  sections.push('## Identity & Personality', '', soulContent.trim(), '');
}
```

`tryReadFile()` 是一个安全的读取函数——文件不存在时返回 `null`，不抛异常。这意味着 bootstrap files 是可选的：不创建 SOUL.md，Agent 用默认身份；创建了，就用自定义人设。

一个实际的 SOUL.md 可能长这样：

```markdown
你是一个专注于 TypeScript 开发的编程助手。

## 偏好
- 使用 ESM 模块，不用 CommonJS
- 优先使用标准库，减少外部依赖
- 变量和函数名用英文，注释用中文

## 限制
- 不要修改 node_modules 目录
- 不要在没有确认的情况下删除文件
```

## 32.2 Memory 系统

OpenClaw 的 Memory 系统（`src/memory/`）包含向量数据库、嵌入模型、混合搜索（关键词 + 语义）等完整能力。它的 `root-memory-files.ts` 定义了 `MEMORY.md` 的查找和解析逻辑。

Mini OpenClaw 的 Memory 简化为纯文件驱动，两个组件：

1. **MEMORY.md**：长期记忆，存储跨会话需要记住的信息
2. **Daily Log**：每日工作日志，自动追加

```typescript
// src/memory/manager.ts

export class MemoryManager {
  private memoryDir: string;
  private workspaceDir: string;

  constructor(memoryDir: string, workspaceDir: string) {
    this.memoryDir = memoryDir;
    this.workspaceDir = workspaceDir;
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.mkdirSync(path.join(memoryDir, 'daily-logs'), { recursive: true });
  }
  // ...
}
```

### MEMORY.md 的读取策略

OpenClaw 的 `resolveCanonicalRootMemoryFile()`（`src/memory/root-memory-files.ts:33`）在工作目录中查找 `MEMORY.md`，区分大小写。Mini OpenClaw 实现了类似的查找逻辑，优先查工作目录，其次查数据目录：

```typescript
readRootMemory(): string | null {
  // 优先读取工作目录下的 MEMORY.md
  const workspacePath = path.join(this.workspaceDir, 'MEMORY.md');
  const memoryPath = path.join(this.memoryDir, 'MEMORY.md');

  for (const p of [workspacePath, memoryPath]) {
    try {
      return fs.readFileSync(p, 'utf-8').trim();
    } catch {
      continue;
    }
  }
  return null;
}
```

为什么优先读工作目录？因为工作目录通常是 git 仓库，MEMORY.md 放在那里可以被版本控制。用户能用 git 管理 Agent 的记忆——这是 OpenClaw 的一个设计亮点。

### Daily Log

Daily Log 是按日期组织的工作日志。每天一个文件（`2026-04-29.md`），记录 Agent 当天做了什么：

```typescript
appendDailyLog(entry: string): void {
  const dateStr = this.todayDateString();
  const logPath = this.dailyLogPath(dateStr);
  const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
  const line = `- [${timestamp}] ${entry}\n`;
  fs.appendFileSync(logPath, line, 'utf-8');
}
```

Daily Log 的内容会注入 system prompt，让 Agent 知道"今天已经做了什么"。这避免了重复工作——如果用户在新会话中问"帮我继续之前的任务"，Agent 可以从日志中找到上下文。

### Memory 注入 Prompt

`getContextForPrompt()` 将 MEMORY.md 和今日日志组合成 prompt 片段：

```typescript
getContextForPrompt(): string | null {
  const parts: string[] = [];

  const rootMemory = this.readRootMemory();
  if (rootMemory) {
    parts.push('### Long-term Memory (MEMORY.md)', '', rootMemory);
  }

  const todayLog = this.readDailyLog(this.todayDateString());
  if (todayLog) {
    parts.push("### Today's Log", '', todayLog);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}
```

OpenClaw 的 `buildMemoryPromptSection()`（`src/plugins/memory-state.ts`）做同样的事，但还会根据配置控制 memory citations 模式、处理 memory 更新通知等。

## 32.3 Skills 元数据索引

Skills 是 Agent 的专业技能包。不同于工具（tool，模型直接调用的函数），Skill 是一组指令——告诉模型在特定场景下怎么做。

OpenClaw 的 Skills 系统（`src/agents/skills/`）的核心思路是：

1. 扫描 skills 目录，找到所有 `SKILL.md` 文件
2. 解析 frontmatter，提取 name 和 description
3. 将索引注入 system prompt（只有摘要，不是全文）
4. 模型根据用户任务判断是否需要某个 skill
5. 需要时，模型用 `read_file` 工具加载完整的 SKILL.md

这个"索引 + 按需加载"的模式非常高效——不需要把所有 skill 内容都塞进 prompt，节省 token。Mini OpenClaw 完整保留了这个模式。

### Skill 文件格式

每个 skill 是一个目录，包含一个 `SKILL.md`：

```
.openclaw/skills/
├── git-workflow/
│   └── SKILL.md
├── code-review/
│   └── SKILL.md
└── testing/
    └── SKILL.md
```

`SKILL.md` 的格式：

```markdown
---
name: git-workflow
description: Git 工作流操作指南，包括分支管理、commit 规范、PR 流程
---

# Git 工作流

## 分支命名
- feature/xxx: 新功能
- fix/xxx: 修复
- refactor/xxx: 重构

## Commit 规范
使用 conventional commits 格式...
```

### Frontmatter 解析

OpenClaw 用 `src/agents/skills/frontmatter.ts` 解析 frontmatter。Mini OpenClaw 实现了一个简化版：

```typescript
function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  if (!content.startsWith('---')) return result;

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) return result;

  const frontmatterText = content.slice(3, endIndex).trim();
  for (const line of frontmatterText.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key && value) result[key] = value;
  }

  return result;
}
```

只处理简单的 `key: value` 对，不支持嵌套结构。对于 SKILL.md 来说够用了——name 和 description 就是两个字符串。

### Skills 索引注入 Prompt

`getSkillsIndexForPrompt()` 生成的格式与 OpenClaw 的 `formatSkillsForPrompt()`（`src/agents/skills/skill-contract.ts:44`）保持一致，使用 XML 标签：

```typescript
getSkillsIndexForPrompt(): string | null {
  if (this.skills.length === 0) return null;

  const lines = [
    'The following skills provide specialized instructions for specific tasks.',
    'Use the read_file tool to load a skill\'s file when the task matches its description.',
    '',
    '<available_skills>',
  ];

  for (const skill of this.skills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }

  lines.push('</available_skills>');
  return lines.join('\n');
}
```

为什么用 XML 标签？因为 Claude 对 XML 格式的结构化数据有很好的解析能力。`<available_skills>` 标签让模型清楚地知道这是 skill 列表，`<location>` 告诉它用 `read_file` 去哪里加载完整内容。

### 按需加载的实际效果

假设有 20 个 skill，每个 SKILL.md 有 500 字。如果全部注入 prompt，就是 10,000 字（约 4,000 tokens）。用索引 + 按需加载，prompt 中只有摘要（每个 skill 约 50 字），总共 1,000 字。模型判断需要某个 skill 后，用 `read_file` 加载那一个 500 字的文件。

这是一个 4:1 的 token 节省比，skill 越多节省越明显。

## 32.4 完整的 System Prompt 组装

把前面实现的 Memory 和 Skills 接入 `buildSystemPrompt()`，完整的 prompt 结构如下：

```
[身份声明]
You are an AI assistant powered by Mini OpenClaw.

[SOUL.md - 如果存在]
## Identity & Personality
（用户自定义的 Agent 人设）

[TOOLS.md - 如果存在]
## Tool Usage Guidelines
（工具使用偏好和限制）

[Memory]
## Memory
### Long-term Memory (MEMORY.md)
（长期记忆内容）
### Today's Log
（今日工作日志）

[Skills 索引]
<available_skills>
  <skill>
    <name>git-workflow</name>
    <description>Git 工作流操作指南</description>
    <location>/path/to/SKILL.md</location>
  </skill>
  ...
</available_skills>

[运行时信息]
## Runtime Information
- Current time: 2026-04-29T14:30:00.000Z
- Working directory: /home/ubuntu/projects
- Platform: linux

[可用工具]
## Available Tools
- bash: Execute a bash command
- read_file: Read file contents
- write_file: Write content to a file
```

## 32.5 本章代码清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/memory/manager.ts` | ~110 | Memory 管理（MEMORY.md + Daily Log） |
| `src/memory/skills.ts` | ~160 | Skills 加载器（frontmatter 解析 + 索引生成） |

这两个模块加上第 31 章的 system-prompt.ts 一起工作，构成了 Agent 的完整知识层。

下一章将实现 WebChat 客户端，完成端到端联调——从用户输入到 Agent 回复的完整链路。

## 练习

**思考题**

1. Mini OpenClaw 的 Skills 加载器解析 SKILL.md 的 YAML frontmatter 来生成索引。如果 Skills 数量从当前的几个增长到 500 个，每次 Agent 启动都要解析 500 个文件的 frontmatter。你会怎样优化这个启动性能？OpenClaw 的 Bootstrap Cache 两层缓存设计给了什么启发？

**动手题**

2. 为 Mini OpenClaw 编写一个新的 SKILL.md 文件（比如"数据库查询助手"），放到项目的 skills 目录下。启动 Mini OpenClaw，在对话中验证该 Skill 的描述是否出现在 Agent 的工具索引中，以及 Agent 是否能根据用户意图正确加载该 Skill 的完整内容。

3. 修改 Mini OpenClaw 的 `src/memory/manager.ts`，添加 Daily Log 功能：每次对话结束后，将对话摘要自动追加到一个按日期命名的日志文件中（如 `daily/2026-04-29.md`）。在下次对话开始时，将最近 3 天的 Daily Log 注入到 System Prompt 中作为短期记忆。
