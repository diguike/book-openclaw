---
title: 第 30 章 — 实现 Gateway 与 Session 核心
feishu_url: "https://www.feishu.cn/wiki/DCR4wnSaViyR5ikjkI6ca9uqnSR"
last_synced: "2026-05-03"
---

# 第 30 章 — 实现 Gateway 与 Session 核心

> 读完这章，你会完成 Mini OpenClaw 的项目脚手架、WebSocket Gateway 服务和 JSONL 持久化的 Session 管理。这是整个系统的通信骨架。

## 30.1 项目脚手架

先把项目初始化好。Mini OpenClaw 使用 Node.js + TypeScript + ESM 模块：

```json
// package.json
{
  "name": "mini-openclaw",
  "version": "0.1.0",
  "description": "Mini OpenClaw - 精简版 Agent 系统",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "ws": "^8.18.0",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.13",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

依赖说明：`ws` 是 WebSocket 服务端，`@anthropic-ai/sdk` 用于后续章节的模型调用，`uuid` 生成唯一 ID，`tsx` 在开发时直接运行 TypeScript。

安装依赖并验证编译：

```bash
cd mini-openclaw
npm install
npx tsc --noEmit  # 应该无错误
```

## 30.2 类型定义

先把核心类型定义好。OpenClaw 的类型分散在多个模块中（`src/types/`、`src/gateway/protocol/`、`src/agents/` 等），Mini OpenClaw 把关键类型集中在一个文件里：

```typescript
// src/types.ts

/** 用户发送的消息 */
export type UserMessage = {
  role: 'user';
  content: string;
  timestamp: number;
};

/** 助手回复的消息 */
export type AssistantMessage = {
  role: 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallRecord[];
};

/** 系统消息（内部使用） */
export type SystemMessage = {
  role: 'system';
  content: string;
  timestamp: number;
};

/** 统一消息类型 */
export type Message = UserMessage | AssistantMessage | SystemMessage;
```

WebSocket 协议使用 JSON 格式的事件：

```typescript
/** 客户端 → 服务端 */
export type ClientEvent =
  | { type: 'message'; sessionId?: string; content: string }
  | { type: 'ping' };

/** 服务端 → 客户端 */
export type ServerEvent =
  | { type: 'connected'; sessionId: string }
  | { type: 'chunk'; sessionId: string; content: string }
  | { type: 'message_done'; sessionId: string; content: string }
  | { type: 'tool_start'; sessionId: string; toolName: string }
  | { type: 'tool_done'; sessionId: string; toolName: string; output: string }
  | { type: 'error'; message: string }
  | { type: 'pong' };
```

OpenClaw 的 Gateway 协议（`src/gateway/protocol/`）要复杂得多，支持认证握手、方法调用、频道订阅等。Mini OpenClaw 只用两种事件：`message`（用户发消息）和各种服务端推送。

完整的类型定义见 `src/types.ts`（项目源码）。

## 30.3 WebSocket Gateway 服务

Gateway 是整个系统的入口。OpenClaw 的 Gateway（`src/gateway/server.impl.ts`）负责的事情非常多：HTTP 服务、WebSocket 运行时、认证、模型目录、插件生命周期、cron 调度…… 仅 import 就有 100 行。

Mini OpenClaw 的 Gateway 只做三件事：

1. 管理 WebSocket 连接
2. 为每个连接关联一个 Session
3. 将用户消息路由到 Agent Runtime

```typescript
// src/gateway/server.ts

import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { ClientEvent, ServerEvent, MiniOpenClawConfig } from '../types.js';
import { SessionStore } from './session-store.js';
import type { AgentRuntime } from '../agent/runtime.js';

/** 连接上下文：每个 WebSocket 连接关联一个 session */
type ConnectionContext = {
  connectionId: string;
  sessionId: string;
  ws: WebSocket;
};

export class GatewayServer {
  private wss: WebSocketServer | null = null;
  private connections: Map<string, ConnectionContext> = new Map();
  private sessionStore: SessionStore;
  private agentRuntime: AgentRuntime;
  private config: MiniOpenClawConfig;

  constructor(
    config: MiniOpenClawConfig,
    sessionStore: SessionStore,
    agentRuntime: AgentRuntime,
  ) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.agentRuntime = agentRuntime;
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.config.port });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    console.log(`[Gateway] WebSocket 服务已启动，端口: ${this.config.port}`);
  }
  // ...
}
```

连接处理的核心逻辑：新连接到来时，为它找到或创建一个 Session，然后监听消息：

```typescript
private handleConnection(ws: WebSocket): void {
  const connectionId = uuidv4();
  const sessionMeta = this.sessionStore.getOrCreateSession('webchat');

  const ctx: ConnectionContext = {
    connectionId,
    sessionId: sessionMeta.sessionId,
    ws,
  };
  this.connections.set(connectionId, ctx);

  // 告诉客户端连接成功
  this.send(ws, { type: 'connected', sessionId: sessionMeta.sessionId });

  ws.on('message', (data) => this.handleMessage(ctx, data.toString()));
  ws.on('close', () => this.connections.delete(connectionId));
}
```

消息路由是 Gateway 最关键的职责。用户消息进来，存入 Session，交给 Agent，把 Agent 的流式输出转发回客户端：

```typescript
private async routeToAgent(ctx: ConnectionContext, content: string): Promise<void> {
  const { sessionId } = ctx;

  // 1. 存储用户消息
  await this.sessionStore.appendMessage(sessionId, {
    role: 'user',
    content,
    timestamp: Date.now(),
  });

  // 2. 调用 Agent，传入流式回调
  const response = await this.agentRuntime.run({
    sessionId,
    userMessage: content,
    onChunk: (chunk) => {
      this.send(ctx.ws, { type: 'chunk', sessionId, content: chunk });
    },
    onToolStart: (toolName) => {
      this.send(ctx.ws, { type: 'tool_start', sessionId, toolName });
    },
    onToolDone: (toolName, output) => {
      this.send(ctx.ws, { type: 'tool_done', sessionId, toolName, output });
    },
  });

  // 3. 存储助手回复
  await this.sessionStore.appendMessage(sessionId, {
    role: 'assistant',
    content: response.content,
    timestamp: Date.now(),
    toolCalls: response.toolCalls,
  });

  // 4. 发送完成事件
  this.send(ctx.ws, { type: 'message_done', sessionId, content: response.content });
}
```

这里的 `onChunk` 回调实现了流式响应——模型生成一个 token，Gateway 立刻推送给客户端，用户能看到文字逐字出现。OpenClaw 用了更复杂的 streaming 协议（参见第 7 章），支持 preview/block 模式和 fallback delivery。Mini OpenClaw 直接用最简单的 chunk 推送。

## 30.4 Session 管理与 JSONL 持久化

OpenClaw 的会话存储使用 JSONL 格式。JSONL（JSON Lines）的特点是每行一个 JSON 对象，追加写入。这和数据库比起来有几个好处：

- 写入快：只需 `fs.appendFileSync()`，不需要事务
- 可读性好：用 `cat` 或 `jq` 就能查看会话内容
- 恢复简单：文件就是数据，不需要额外的恢复工具

OpenClaw 中，JSONL 文件的路径由 `session-transcript-files.fs.ts` 管理，支持会话归档（按时间戳重命名）和分叉（fork 出新会话文件）。Mini OpenClaw 只实现基本的读写：

```typescript
// src/gateway/session-store.ts

export class SessionStore {
  private sessionsDir: string;
  private index: Map<string, SessionMeta> = new Map();
  /** 写入锁：每个 session 同时只允许一个写入操作 */
  private writeLocks: Map<string, Promise<void>> = new Map();

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
    fs.mkdirSync(sessionsDir, { recursive: true });
    this.rebuildIndex();
  }
  // ...
}
```

两个关键设计决策：

**内存索引**：启动时扫描磁盘上所有 `.meta.json` 文件，在内存中建立 `Map<sessionId, SessionMeta>` 索引。查询会话不需要每次读磁盘。OpenClaw 有类似的设计，只是索引更复杂，包含了归档状态、子 Agent 关联等信息。

**单写者锁**：每个 Session 的 JSONL 文件同一时间只有一个写入操作在进行。实现方式是 Promise 链——新的写入操作会等前一个完成再开始：

```typescript
async appendMessage(sessionId: string, message: Message): Promise<void> {
  const prev = this.writeLocks.get(sessionId) ?? Promise.resolve();
  const current = prev.then(() => this.doAppend(sessionId, message));
  this.writeLocks.set(sessionId, current);
  await current;
}
```

这个模式很轻量，不需要引入外部锁库。在 Node.js 单线程环境中，这种基于 Promise 的串行化足够保证写入顺序。

JSONL 读取则是一次性加载全部内容，按行解析：

```typescript
loadMessages(sessionId: string): Message[] {
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Message);
}
```

对于生产系统，全量加载会有性能问题——几千轮对话的 JSONL 文件可能有几 MB。OpenClaw 的做法是只加载最近的 N 条消息，更早的消息按需加载。Mini OpenClaw 也实现了截取：在 Agent Runtime 中只取最近 `maxContextMessages` 条消息送给模型。

## 30.5 配置加载

OpenClaw 用 Zod schemas 做配置校验（`src/config/`），支持多层级配置合并、运行时覆盖、热重载等。Mini OpenClaw 简化为环境变量 + 默认值：

```typescript
// src/config.ts

export function loadConfig(): MiniOpenClawConfig {
  const workspaceDir = process.env.MINI_OPENCLAW_WORKSPACE || process.cwd();
  const dataDir = process.env.MINI_OPENCLAW_DATA_DIR
    || path.join(workspaceDir, '.mini-openclaw');

  return {
    port: parseInt(process.env.MINI_OPENCLAW_PORT || '3210', 10),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.MINI_OPENCLAW_MODEL || 'claude-sonnet-4-20250514',
    workspaceDir,
    sessionsDir: path.join(dataDir, 'sessions'),
    memoryDir: path.join(dataDir, 'memory'),
    skillsDir: path.join(workspaceDir, '.openclaw', 'skills'),
    maxContextMessages: parseInt(process.env.MINI_OPENCLAW_MAX_CONTEXT || '50', 10),
  };
}
```

唯一的强制配置是 `ANTHROPIC_API_KEY`。其余配置都有合理的默认值，开发时不需要任何配置文件就能启动。

## 30.6 本章代码清单

本章实现了以下文件：

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/types.ts` | ~120 | 核心类型定义 |
| `src/config.ts` | ~30 | 配置加载 |
| `src/gateway/server.ts` | ~160 | WebSocket Gateway |
| `src/gateway/session-store.ts` | ~140 | Session 管理 + JSONL 持久化 |
| `package.json` | ~25 | 项目配置和依赖 |
| `tsconfig.json` | ~20 | TypeScript 配置 |

这些代码已经可以编译通过。但还不能运行——Gateway 依赖 AgentRuntime，那是下一章的内容。

项目源码位于 `examples/mini-openclaw/`，可以直接查看完整实现。

下一章实现 Agent Runtime 和工具执行，让系统能够真正处理用户消息。

## 练习

**思考题**

1. Mini OpenClaw 的 Session Store 使用 JSONL 文件存储对话记录，但没有实现文件锁。如果两个 WebSocket 客户端同时向同一个 Session 发送消息，会发生什么？JSONL 文件可能出现什么样的数据损坏？

**动手题**

2. 在 Mini OpenClaw 的 `src/gateway/server.ts` 中，添加一个简单的 HTTP 健康检查端点（`GET /health`），返回当前活跃的 WebSocket 连接数和 Session 数量。参考 OpenClaw 的 `/healthz` 和 `/readyz` 的分层设计，思考两者的区别。

3. 修改 Mini OpenClaw 的 Session Store，为 JSONL 文件添加一个简单的并发保护：在写入 transcript 时使用 `fs.open` 的 `wx` flag 创建一个 `.lock` 文件，写入完成后删除。测试当两个请求同时到达时，锁机制是否能防止并发写入。

---

> 本章来自《OpenClaw 源码解析》开源版 · 作者「递归客」  
> 在线阅读完整书系：[inferloop.dev](https://inferloop.dev)  
> 源码仓库：[github.com/diguike/book-openclaw](https://github.com/diguike/book-openclaw)
