---
title: 第 31 章 — 实现 Agent Runtime 与工具执行
feishu_url: "https://www.feishu.cn/wiki/W0PzwLhLmiyNNTkMkQYcrFfAnve"
last_synced: "2026-05-03"
---

# 第 31 章 — 实现 Agent Runtime 与工具执行

> 读完这章，你会实现 Mini OpenClaw 的核心大脑——Agent Runtime。包括 System Prompt 组装、Anthropic API 的流式调用、工具注册与执行，以及 prompt-model-tool 的循环控制。

上一章搭好了 Gateway 和 Session 的骨架。现在要填进去的是最关键的部分：Agent Runtime。它决定了系统如何理解用户意图、调用工具完成任务、组织回复。

## 31.1 System Prompt 组装

System Prompt 是 Agent 的"大脑初始化指令"。OpenClaw 的 system prompt 构建（`src/agents/system-prompt.ts`）是一个 800+ 行的大模块，处理了大量细节：

- context file 排序（`CONTEXT_FILE_ORDER`，按 agents.md → soul.md → identity.md → tools.md → memory.md 排列）
- prompt cache boundary（在特定位置插入 cache marker，提高 KV 缓存命中率）
- provider 差异化（不同模型厂商的 prompt 格式差异）
- 嵌入式沙箱信息
- 频道特定能力描述

Mini OpenClaw 保留了核心结构，但把 800 行简化到 80 行：

```typescript
// src/agent/system-prompt.ts

export function buildSystemPrompt(params: {
  config: MiniOpenClawConfig;
  tools: ToolDefinition[];
  memoryManager: MemoryManager;
  skillsLoader: SkillsLoader;
}): string {
  const sections: string[] = [];

  // 1. 身份
  sections.push(
    'You are an AI assistant powered by Mini OpenClaw.',
    'You can read files, execute commands, and help users with various tasks.',
    '',
  );

  // 2. SOUL.md（Agent 人设）
  const soulPath = path.join(config.workspaceDir, '.openclaw', 'SOUL.md');
  const soulContent = tryReadFile(soulPath);
  if (soulContent) {
    sections.push('## Identity & Personality', '', soulContent.trim(), '');
  }

  // 3. TOOLS.md（工具使用指南）
  const toolsDocPath = path.join(config.workspaceDir, '.openclaw', 'TOOLS.md');
  const toolsDoc = tryReadFile(toolsDocPath);
  if (toolsDoc) {
    sections.push('## Tool Usage Guidelines', '', toolsDoc.trim(), '');
  }

  // 4. Memory 上下文
  const memoryContext = memoryManager.getContextForPrompt();
  if (memoryContext) {
    sections.push('## Memory', '', memoryContext, '');
  }

  // 5. Skills 索引
  const skillsContext = skillsLoader.getSkillsIndexForPrompt();
  if (skillsContext) {
    sections.push(skillsContext, '');
  }

  // 6. 运行时信息
  sections.push(
    '## Runtime Information', '',
    `- Current time: ${new Date().toISOString()}`,
    `- Working directory: ${config.workspaceDir}`,
    `- Platform: ${process.platform}`,
    '',
  );

  // 7. 可用工具列表
  // ...

  return sections.join('\n');
}
```

组装顺序参考了 OpenClaw 的 `CONTEXT_FILE_ORDER`：身份在前，运行时信息在后。这个顺序有讲究——模型对 system prompt 头部的内容关注度更高，身份和人设要放在最前面。

**Bootstrap Files**：`SOUL.md` 和 `TOOLS.md` 是 OpenClaw 的 bootstrap files（参见第 13 章），用来定义 Agent 的个性和工具使用偏好。Mini OpenClaw 从 `.openclaw/` 目录加载这两个文件。如果不存在，就使用默认行为。

## 31.2 Agent Runtime 核心循环

这是整个系统最关键的部分。OpenClaw 的 Agent 循环由 `pi-coding-agent` 库驱动，核心在 `src/agents/pi-embedded-runner/run/attempt.ts`。Mini OpenClaw 直接使用 Anthropic SDK 实现同样的循环。

```typescript
// src/agent/runtime.ts

export class AgentRuntime {
  private client: Anthropic;
  private tools: Map<string, ToolDefinition> = new Map();
  // ...

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const { sessionId, userMessage, onChunk, onToolStart, onToolDone } = input;

    // 1. 加载历史消息，截取最近 N 条
    const history = this.sessionStore.loadMessages(sessionId);
    const recentHistory = history.slice(-this.config.maxContextMessages);

    // 2. 组装 system prompt
    const systemPrompt = buildSystemPrompt({ ... });

    // 3. 构建消息序列
    const messages = this.buildAnthropicMessages(recentHistory, userMessage);

    // 4. 构建工具定义
    const toolDefs = this.buildAnthropicTools();

    // 5. Agent 循环
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.callModel({ systemPrompt, messages, tools, onChunk });

      const toolUseBlocks = response.content.filter(
        (block) => block.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0) {
        // 没有工具调用，返回文本
        break;
      }

      // 执行工具，结果送回模型
      for (const toolUse of toolUseBlocks) {
        onToolStart(toolUse.name);
        const result = await tool.execute(toolUse.input);
        onToolDone(toolUse.name, result.output);
      }

      // 追加助手消息和工具结果，继续下一轮
      currentMessages = [...currentMessages, assistantMsg, toolResultMsg];
    }
  }
}
```

这个循环的本质是：**prompt → model → tool → result → model → ...**，直到模型决定不再调用工具，直接回复文本。

`MAX_TOOL_ROUNDS` 设为 10，防止模型陷入无限工具调用循环。OpenClaw 也有类似的保护机制（`src/agents/tool-loop-detection.ts`），不过 OpenClaw 的检测更智能——它会分析工具调用模式，检测是否在重复相同的调用。

### 流式调用

Mini OpenClaw 使用 Anthropic SDK 的 `messages.stream()` 方法实现流式调用：

```typescript
private async callModel(params: {
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  onChunk: (chunk: string) => void;
}): Promise<Anthropic.Message> {
  const stream = this.client.messages.stream({
    model: this.config.model,
    max_tokens: 4096,
    system: params.systemPrompt,
    messages: params.messages,
    tools: params.tools.length > 0 ? params.tools : undefined,
  });

  // 监听流式文本事件
  stream.on('text', (text) => {
    params.onChunk(text);
  });

  const response = await stream.finalMessage();
  return response;
}
```

`stream.on('text', ...)` 在模型生成每个文本 token 时触发，`onChunk` 回调会将这些 token 通过 WebSocket 实时推送给客户端。用户看到的效果是文字逐字出现。

OpenClaw 的流式处理（参见第 7 章）要复杂得多，需要处理 preview/block 模式、多渠道差异化 delivery、断线重连时的消息补发等。Mini OpenClaw 的实现虽然简单，但核心机制是一样的。

### 工具定义转换

Anthropic API 要求工具按特定的 JSON Schema 格式描述。Mini OpenClaw 的内部工具定义比 API 格式更简洁，需要一个转换层：

```typescript
private buildAnthropicTools(): Anthropic.Tool[] {
  return Array.from(this.tools.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([key, param]) => [
          key,
          { type: param.type, description: param.description },
        ]),
      ),
      required: Object.entries(tool.parameters)
        .filter(([, param]) => param.required !== false)
        .map(([key]) => key),
    },
  }));
}
```

OpenClaw 的工具定义适配器（`src/agents/pi-tool-definition-adapter.ts`）做了类似的事，但还要处理 before/after tool call hooks、工具审计日志、权限校验等。

## 31.3 实现 Bash 工具

bash 工具是 Agent 最强大的能力来源。OpenClaw 的 bash 工具实现（`src/agents/tools/bash/`）包含进程注册表、超时控制、输出截断、安全审计等完整机制。Mini OpenClaw 保留核心——在子进程中执行命令：

```typescript
// src/tools/bash.ts

export function createBashTool(workspaceDir: string): ToolDefinition {
  return {
    name: 'bash',
    description:
      'Execute a bash command in the workspace directory. ' +
      'Use this for running scripts, installing packages, checking file status, etc.',
    parameters: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
        required: true,
      },
    },
    execute: async (params): Promise<ToolResult> => {
      const command = params.command as string;
      return new Promise((resolve) => {
        exec(command, {
          cwd: workspaceDir,
          timeout: 30_000,    // 30 秒超时
          maxBuffer: 1024 * 1024,
          shell: '/bin/bash',
        }, (error, stdout, stderr) => {
          let output = stdout || '';
          if (stderr) output += `\nSTDERR: ${stderr}`;

          // 截断过长输出
          if (output.length > 10_000) {
            output = output.slice(0, 10_000) + '\n... (输出已截断)';
          }

          resolve({
            success: !error,
            output: output || '（命令执行成功，无输出）',
            error: error?.message,
          });
        });
      });
    },
  };
}
```

几个关键设计点：

1. **工作目录固定**：所有命令在 `workspaceDir` 下执行，Agent 不能随意切换目录
2. **超时保护**：30 秒超时，防止长时间运行的命令阻塞系统
3. **输出截断**：10,000 字符上限，防止大量输出撑爆上下文窗口
4. **stderr 合并**：将标准错误和标准输出合并返回，让模型能看到错误信息

OpenClaw 的 bash 工具还做了这些 Mini OpenClaw 没有的事：维护进程注册表（追踪所有子进程）、支持后台运行、输出流式推送、安全命令审计。这些是生产环境必需的，但理解核心 Agent 循环不需要它们。

## 31.4 实现文件读取工具

```typescript
// src/tools/read-file.ts

export function createReadFileTool(workspaceDir: string): ToolDefinition {
  return {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content with line numbers.',
    parameters: {
      file_path: {
        type: 'string',
        description: 'Path to the file to read',
        required: true,
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-based)',
        required: false,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read (default: 2000)',
        required: false,
      },
    },
    execute: async (params): Promise<ToolResult> => {
      const filePath = params.file_path as string;
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workspaceDir, filePath);

      // 路径检查、大小检查...

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const lines = content.split('\n');
      const selectedLines = lines.slice(startIdx, endIdx);

      // 添加行号（模仿 cat -n 格式）
      const numberedLines = selectedLines.map(
        (line, i) => `${String(startIdx + i + 1).padStart(6, ' ')}  ${line}`,
      );

      return { success: true, output: numberedLines.join('\n') };
    },
  };
}
```

行号输出格式（`cat -n` 风格）是有意为之的。当模型需要编辑文件的特定行时，行号提供了精确的定位依据。OpenClaw 的 read 工具也使用这种格式。

文件写入工具（`src/tools/write-file.ts`）的实现更简单，核心就是 `fs.writeFileSync()`，加上自动创建父目录。完整代码见项目源码。

## 31.5 工具注册

```typescript
// src/tools/index.ts

export function createBuiltinTools(workspaceDir: string): ToolDefinition[] {
  return [
    createBashTool(workspaceDir),
    createReadFileTool(workspaceDir),
    createWriteFileTool(workspaceDir),
  ];
}
```

OpenClaw 的工具目录（`src/agents/tool-catalog.ts`）按 section 分组：Files（read, write, edit, apply_patch）、Runtime（bash, exec）、Web（web_search, web_fetch）、Memory（memory tools）…… 总共几十个工具。Mini OpenClaw 只注册 3 个，但注册机制完全一致——`AgentRuntime.registerTool()` 将工具添加到内部的 `Map<name, ToolDefinition>` 中。

扩展工具很容易：实现 `ToolDefinition` 接口，调用 `registerTool()` 注册即可。比如要加一个 `list_files` 工具，只需写一个返回目录列表的函数。

## 31.6 消息格式转换

内部消息格式和 Anthropic API 格式不同，需要一个转换层：

```typescript
private buildAnthropicMessages(
  history: Message[],
  userMessage: string,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.content });
    }
    // system 消息在 system prompt 中处理，不放进 messages
  }

  messages.push({ role: 'user', content: userMessage });
  return messages;
}
```

这里有一个简化：历史消息中的工具调用记录没有还原成 Anthropic API 的 tool_use + tool_result 格式。在完整实现中（比如 OpenClaw），历史消息的工具调用上下文会被完整保留，让模型能"记住"之前做过什么。Mini OpenClaw 为了简单，只保留了文本内容。

## 31.7 本章代码清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/agent/runtime.ts` | ~190 | Agent 运行循环 |
| `src/agent/system-prompt.ts` | ~90 | System Prompt 组装 |
| `src/tools/bash.ts` | ~70 | Bash 工具 |
| `src/tools/read-file.ts` | ~100 | 文件读取工具 |
| `src/tools/write-file.ts` | ~60 | 文件写入工具 |
| `src/tools/index.ts` | ~15 | 工具注册 |

到这里，系统已经有了完整的 Agent 能力：接收用户消息 → 组装 prompt → 调用模型 → 执行工具 → 返回结果。但还缺少 Memory 和 Skills——Agent 每次启动都是一张白纸。下一章解决这个问题。

## 练习

**思考题**

1. Mini OpenClaw 的 Agent Runtime 核心循环在收到 `tool_use` 后执行工具并将结果作为 `tool_result` 追加到消息列表中，然后再次调用模型。如果模型在一轮中返回了 10 个 tool_use 请求，当前实现是串行执行还是并行执行？串行和并行各自的优劣是什么？OpenClaw 是怎么处理的？

**动手题**

2. 在 Mini OpenClaw 中添加一个新的工具：`list_files`，接受一个 `directory` 参数，返回该目录下的文件列表。在 `src/tools/` 下创建工具实现，在 `src/tools/index.ts` 中注册，然后通过 WebChat 客户端测试该工具是否能被 Agent 正确调用。

3. 修改 Mini OpenClaw 的 `src/agent/runtime.ts`，添加一个工具调用次数上限（比如单轮对话最多执行 20 次工具调用）。当达到上限时，向模型发送一条系统消息"工具调用次数已达上限，请直接给出回复"。测试该限制是否能有效防止工具调用死循环。

---

> 本章来自《OpenClaw 源码解析》开源版 · 作者「递归客」  
> 在线阅读完整书系：[inferloop.dev](https://inferloop.dev)  
> 源码仓库：[github.com/diguike/book-openclaw](https://github.com/diguike/book-openclaw)
