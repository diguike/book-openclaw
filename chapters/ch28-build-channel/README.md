---
title: 第 28 章 — 实战：开发一个 Channel Extension
feishu_url: "https://www.feishu.cn/wiki/HIFnwdacUiROHCk5RSNc3g7qn0c"
last_synced: "2026-05-03"
---

# 第 28 章 — 实战：开发一个 Channel Extension

读完这章你能学到：OpenClaw Channel Extension 的完整开发流程——从包结构搭建、ChannelPlugin 接口实现、Webhook 入站处理、消息出站格式化，到本地调试和测试。本章以一个基于 HTTP Webhook 的自定义 Channel 为例，给出完整可运行的代码。

## 28.1 Channel Extension 的定位

第 27 章的 Skill 是"自然语言扩展"——你用 Markdown 告诉 Agent 该怎么做。Channel Extension 则是"代码级扩展"——你用 TypeScript 实现一个通信渠道，让 OpenClaw 能接收和发送消息到新的平台。

OpenClaw 的 `extensions/` 目录包含 130+ 个扩展，其中约 30 个是 Channel 类型的插件（Telegram、Discord、飞书、Synology Chat 等）。每个 Channel 扩展遵循相同的架构模式：

```
接收消息 → Webhook Handler → 入站转换 → Agent 处理 → 出站格式化 → 发送回复
```

我们要构建的是一个通用 HTTP Webhook Channel，名为 `custom-webhook`。它接收来自任意 HTTP 客户端的 POST 请求，将消息传递给 Agent 处理，然后通过回调 URL 返回响应。这种模式适用于集成内部系统、IoT 设备、或者任何能发 HTTP 请求的客户端。

## 28.2 Extension 包结构

先看 OpenClaw 中一个真实的 Channel 扩展（Synology Chat）的文件结构：

```
extensions/synology-chat/
  api.ts                    # 公开 API（re-export SDK 类型）
  channel-entry.ts          # 入口：未使用（此扩展用 index.ts）
  channel-plugin-api.ts     # 导出 channel plugin 实例
  contract-api.ts           # 类型契约
  index.ts                  # 插件入口定义
  openclaw.plugin.json      # 插件元数据清单
  package.json              # 包配置
  setup-api.ts              # Setup 阶段导出
  setup-entry.ts            # Setup 入口
  src/
    channel.ts              # ChannelPlugin 实现
    webhook-handler.ts      # Webhook 处理器
    client.ts               # API 客户端
    security.ts             # 安全校验
    types.ts                # 类型定义
    config-schema.ts         # 配置 Schema
    ...
```

核心文件只有四个：

1. **`index.ts`** — 调用 `defineBundledChannelEntry` 定义插件入口
2. **`openclaw.plugin.json`** — 声明插件的元数据和激活策略
3. **`src/channel.ts`** — 实现 `ChannelPlugin` 接口
4. **`src/webhook-handler.ts`** — 处理入站 Webhook

我们的 `custom-webhook` 扩展也遵循这个结构，但做了简化——去掉了生产环境才需要的 setup wizard、多账户支持、legacy migration 等复杂性。

## 28.3 ChannelPlugin 接口

Channel 扩展的核心是 `ChannelPlugin` 接口。这个接口定义在 `src/plugin-sdk/channel-core.ts`（通过 `openclaw/plugin-sdk/channel-core` 导出），使用 `createChatChannelPlugin` 工厂函数创建实例。

看 Synology Chat 的实现（`extensions/synology-chat/src/channel.ts:202-363`），可以提炼出 ChannelPlugin 的核心组成部分：

```typescript
createChatChannelPlugin({
  base: {
    id: "synology-chat",              // 渠道唯一标识
    meta: {                            // 显示信息
      id: "synology-chat",
      label: "Synology Chat",
      blurb: "Connect your Synology NAS Chat to OpenClaw",
      order: 90,
    },
    capabilities: {                    // 能力声明
      chatTypes: ["direct"],
      media: true,
      threads: false,
      reactions: false,
      edit: false,
    },
    configSchema: SynologyChatChannelConfigSchema,
    config: synologyChatConfigAdapter,  // 配置适配器
    messaging: { ... },                 // 消息路由
    directory: { ... },                 // 联系人目录
    gateway: {                          // Gateway 生命周期
      startAccount: async (ctx) => { ... },
      stopAccount: async (ctx) => { ... },
    },
  },
  outbound: {                          // 出站消息
    deliveryMode: "gateway",
    textChunkLimit: 2000,
    sendText: async (ctx) => { ... },
    sendMedia: async (ctx) => { ... },
  },
  // ...
});
```

每个字段的职责：

| 组件 | 职责 |
|------|------|
| `meta` | UI 展示信息：名称、描述、排序 |
| `capabilities` | 声明渠道支持的功能（线程、Reaction、编辑等） |
| `configSchema` | 配置项的 Zod Schema |
| `config` | 读取和写入渠道配置 |
| `messaging` | 目标地址解析和格式化 |
| `gateway` | 启动/停止时的生命周期回调 |
| `outbound` | 发送消息的具体实现 |

## 28.4 插件入口定义

OpenClaw 通过 `defineBundledChannelEntry` 函数将 Channel 注册到系统中。看 Synology Chat 的入口文件：

```typescript
// extensions/synology-chat/index.ts
import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "synology-chat",
  name: "Synology Chat",
  description: "Native Synology Chat channel plugin for OpenClaw",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "synologyChatPlugin",
  },
  runtime: {
    specifier: "./api.js",
    exportName: "setSynologyRuntime",
  },
});
```

`defineBundledChannelEntry` 做了几件事（见 `src/plugin-sdk/channel-entry-contract.ts:433-507`）：

1. 延迟加载 Channel Plugin——只有在需要时才 `loadBundledEntryExportSync`
2. 注册到 `api.registerChannel`
3. 设置运行时依赖注入（`setChannelRuntime`）

对于第三方插件（非 bundled），使用 `definePluginEntry` + `api.registerChannel` 的组合，逻辑类似但更简单。我们的示例就用这种方式。

## 28.5 实现 custom-webhook Channel

完整代码在 `examples/custom-webhook/` 目录中。以下逐文件解析关键实现。

### package.json

```json
{
  "name": "@openclaw-examples/custom-webhook",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@openclaw/plugin-sdk": "workspace:*",
    "typescript": "^5.7.0"
  },
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

`openclaw.extensions` 告诉 OpenClaw 从哪个文件加载插件入口。

### openclaw.plugin.json — 插件清单

```json
{
  "id": "custom-webhook",
  "activation": {
    "onStartup": false
  },
  "channels": ["custom-webhook"],
  "channelEnvVars": {
    "custom-webhook": [
      "CUSTOM_WEBHOOK_SECRET",
      "CUSTOM_WEBHOOK_CALLBACK_URL"
    ]
  }
}
```

`activation.onStartup: false` 意味着这个插件只在配置中启用了对应渠道时才加载。`channelEnvVars` 声明了渠道相关的环境变量，OpenClaw 在配置向导中会提示用户设置这些变量。

### index.ts — 插件入口

```typescript
import { definePluginEntry, type OpenClawPluginApi } from './api.js';
import { createCustomWebhookPlugin } from './src/channel.js';
import { createWebhookHandler } from './src/webhook-handler.js';

export default definePluginEntry({
  id: 'custom-webhook',
  name: 'Custom Webhook',
  description: 'A generic HTTP webhook channel for integrating external systems with OpenClaw.',
  register(api: OpenClawPluginApi) {
    const plugin = createCustomWebhookPlugin();
    api.registerChannel({ plugin });

    // 注册 Webhook 路由
    const handler = createWebhookHandler({
      secret: process.env.CUSTOM_WEBHOOK_SECRET ?? '',
      deliver: async (msg) => {
        // deliver 函数由 OpenClaw 运行时注入
        // 这里是概念示意；实际实现中通过 gateway runtime 桥接
        return null;
      },
    });

    api.registerHttpRoute({
      path: '/plugins/custom-webhook/inbound',
      auth: 'plugin',
      match: 'exact',
      handler,
    });

    api.logger.info?.('[custom-webhook] registered inbound webhook route');
  },
});
```

这里用了 `definePluginEntry`（而非 `defineBundledChannelEntry`），因为这是第三方插件的标准方式。`api.registerHttpRoute` 把 Webhook 处理器挂载到 OpenClaw 的 Gateway HTTP 服务器上。

### src/channel.ts — ChannelPlugin 实现

这是核心文件，完整实现见 `examples/custom-webhook/src/channel.ts`。关键部分：

```typescript
export function createCustomWebhookPlugin(): ChannelPlugin {
  return createChatChannelPlugin({
    base: {
      id: CHANNEL_ID,
      meta: {
        id: CHANNEL_ID,
        label: 'Custom Webhook',
        selectionLabel: 'Custom Webhook (HTTP)',
        detailLabel: 'Custom Webhook (HTTP POST)',
        blurb: 'Connect any HTTP client to OpenClaw via webhooks',
        order: 100,
      },
      capabilities: {
        chatTypes: ['direct'],
        media: false,
        threads: false,
        reactions: false,
        edit: false,
        unsend: false,
        reply: false,
        blockStreaming: false,
      },
      // ...
    },
    outbound: {
      deliveryMode: 'gateway',
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        // 通过 callback URL 发送回复
        const response = await fetch(to, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, timestamp: Date.now() }),
        });
        if (!response.ok) {
          throw new Error(`Callback failed: ${response.status}`);
        }
        return { channel: CHANNEL_ID, messageId: `cw-${Date.now()}`, chatId: to };
      },
    },
  });
}
```

`capabilities` 声明了这个渠道只支持 direct 聊天、不支持媒体/线程/Reaction——这是一个最小化的能力声明。`outbound.sendText` 通过 HTTP POST 将 Agent 的回复发送到 `to` 地址（这里 `to` 就是 callback URL）。

### src/webhook-handler.ts — 入站消息处理

Webhook 处理器负责接收外部 HTTP 请求，校验安全凭证，解析消息，然后传递给 Agent。

看 Synology Chat 的处理器实现（`extensions/synology-chat/src/webhook-handler.ts:594-647`），其核心流程是：

1. 校验请求方法（只接受 POST）
2. 并发控制（防止 Webhook 洪泛）
3. 读取请求体
4. 解析 payload
5. Token 校验（constant-time 比较）
6. 用户授权检查
7. 速率限制
8. 输入清洗
9. 立即 ACK（204）
10. 异步投递到 Agent

我们的简化版保留了核心安全逻辑，省去了多账户和 legacy 兼容性处理。完整实现见 `examples/custom-webhook/src/webhook-handler.ts`。

关键的安全实现：

```typescript
// 使用 constant-time 比较防止时序攻击
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}
```

OpenClaw 内部使用 `safeEqualSecret` 函数（从 `openclaw/plugin-sdk/security-runtime` 导出）完成同样的工作。第三方插件可以直接调用这个 SDK 方法。

### src/types.ts — 类型定义

```typescript
export interface WebhookPayload {
  senderId: string;       // 发送者标识
  senderName?: string;    // 发送者名称
  text: string;           // 消息正文
  callbackUrl?: string;   // 回复回调地址
  metadata?: Record<string, unknown>;  // 扩展元数据
}

export interface InboundMessage {
  body: string;
  from: string;
  senderName: string;
  provider: string;
  chatType: 'direct';
  callbackUrl: string;
}
```

## 28.6 消息入站转换

入站转换是 Webhook Handler 最重要的职责之一。外部系统发来的 HTTP 请求格式各异，Channel 需要把它们统一转换为 OpenClaw 能理解的内部消息格式。

Synology Chat 的做法是支持多种 Content-Type 和字段别名：

```typescript
// extensions/synology-chat/src/webhook-handler.ts:273-329
function parsePayload(req: IncomingMessage, body: string): SynologyWebhookPayload | null {
  const contentType = normalizeLowercaseStringOrEmpty(req.headers["content-type"]);
  let bodyFields: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    bodyFields = parseJsonBody(body);
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    bodyFields = parseFormBody(body);
  } else {
    // Fallback: 先尝试 JSON，再尝试 form-urlencoded
    try { bodyFields = parseJsonBody(body); }
    catch { bodyFields = parseFormBody(body); }
  }
  // ...
}
```

这种容错设计在实际集成中很重要——你不能期望所有客户端都发送正确的 Content-Type。

我们的 `custom-webhook` 入站消息格式设计如下：

```json
{
  "senderId": "user-123",
  "senderName": "Alice",
  "text": "帮我查看最近的部署状态",
  "callbackUrl": "https://my-system.example.com/openclaw/callback"
}
```

这个 payload 经过 Zod 校验后，被转换为内部格式传递给 Agent。

## 28.7 出站消息格式化

Agent 处理完消息后，回复需要通过 `outbound.sendText` 发送回去。对于我们的 Webhook 渠道，回复通过 HTTP POST 发送到 `callbackUrl`：

```typescript
sendText: async ({ to, text }) => {
  const response = await fetch(to, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      timestamp: Date.now(),
    }),
  });
  // ...
}
```

生产环境中还需要考虑：
- 回调超时处理（设置合理的 timeout）
- 重试策略（指数退避）
- 回调 URL 的 SSRF 防护（不允许内网地址）

Synology Chat 的做法是调用 `sendMessage` 函数通过 NAS 的 Incoming Webhook URL 发送（`extensions/synology-chat/src/channel.ts:338-346`），本质也是一个 HTTP POST。

## 28.8 注册到 Gateway

Gateway 是 OpenClaw 的消息枢纽。Channel 通过 `gateway.startAccount` 注册自己，通过 `gateway.stopAccount` 注销。

Synology Chat 的 Gateway 注册逻辑：

```typescript
// extensions/synology-chat/src/channel.ts:257-278
gateway: {
  startAccount: async (ctx) => {
    const { cfg, accountId, log, abortSignal } = ctx;
    const account = resolveAccount(cfg, accountId);
    if (!validateSynologyGatewayAccountStartup({ cfg, account, accountId, log }).ok) {
      return waitUntilAbort(abortSignal);
    }

    const unregister = registerSynologyWebhookRoute({ account, accountId, log });

    // 保持运行直到收到停止信号
    return waitUntilAbort(abortSignal, () => {
      log?.info?.(`Stopping Synology Chat channel (account: ${accountId})`);
      unregister();
    });
  },
  stopAccount: async (ctx) => {
    ctx.log?.info?.(`Synology Chat account ${ctx.accountId} stopped`);
  },
},
```

`waitUntilAbort` 是一个关键工具函数——它返回一个 Promise，在 AbortSignal 触发前一直保持 pending。Gateway 期望 `startAccount` 返回的 Promise 在渠道运行期间不 resolve；如果立即 resolve，Gateway 会认为渠道崩溃并触发重启。

我们的 `custom-webhook` 在 Gateway 启动时注册 HTTP 路由，在停止时注销：

```typescript
gateway: {
  startAccount: async ({ accountId, abortSignal, log }) => {
    log?.info?.(`Starting custom-webhook channel (account: ${accountId})`);
    // HTTP 路由已在 register() 中注册
    // 保持运行直到收到停止信号
    return new Promise<void>((resolve) => {
      abortSignal.addEventListener('abort', () => {
        log?.info?.(`Stopping custom-webhook channel (account: ${accountId})`);
        resolve();
      });
    });
  },
},
```

## 28.9 本地调试和测试

### 开发环境搭建

1. 将 `custom-webhook` 目录放入 OpenClaw 的 `extensions/` 中（开发模式）
2. 在 OpenClaw 配置中启用渠道：

```json
// ~/.openclaw/openclaw.json
{
  "channels": {
    "custom-webhook": {
      "enabled": true
    }
  }
}
```

3. 设置环境变量：

```bash
export CUSTOM_WEBHOOK_SECRET="your-secret-token-here"
```

### 测试入站 Webhook

启动 OpenClaw Gateway 后，用 curl 测试入站消息：

```bash
curl -X POST http://localhost:3000/plugins/custom-webhook/inbound \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token-here" \
  -d '{
    "senderId": "test-user-1",
    "senderName": "Test User",
    "text": "Hello, what can you do?",
    "callbackUrl": "https://webhook.site/your-unique-url"
  }'
```

如果一切正常，你会收到 `202 Accepted` 响应，然后在 `callbackUrl` 上收到 Agent 的回复。

### 单元测试

`examples/custom-webhook/src/` 目录中包含了 `webhook-handler.test.ts` 测试文件，覆盖了以下场景：

- 正常消息的处理流程
- 缺失 Authorization Header 时返回 401
- Token 校验失败时返回 401
- 缺少必填字段时返回 400
- 非 POST 请求返回 405

运行测试：

```bash
cd examples/custom-webhook
npm install
npm test
```

### 调试技巧

- 使用 `webhook.site` 或 `ngrok` 作为 callbackUrl，方便查看出站消息
- OpenClaw 的日志中会显示 `[custom-webhook]` 前缀的信息
- 如果 Webhook 没有触发，检查 `openclaw.plugin.json` 中的 `activation` 和 `channels` 配置

## 28.10 对比：Plugin vs Channel Extension

理解 OpenClaw 的两种插件类型有助于选择合适的扩展方式。

Webhooks 插件（`extensions/webhooks/`）是一个非渠道的通用插件，用 `definePluginEntry` 定义，将 HTTP 请求桥接到 TaskFlow 系统。它不实现 ChannelPlugin 接口，不出现在渠道列表中，没有出站消息能力。

Channel Extension（如 Synology Chat、本章的 custom-webhook）则是完整的渠道实现，出现在 OpenClaw 的渠道选择列表中，支持双向消息通信。

| 维度 | Plugin | Channel Extension |
|------|--------|-------------------|
| 入口定义 | `definePluginEntry` | `defineBundledChannelEntry` |
| 消息方向 | 单向（入站） | 双向 |
| 渠道列表 | 不出现 | 出现 |
| Gateway 生命周期 | 无 | startAccount/stopAccount |
| 配置向导 | 无 | 支持 |
| 适用场景 | 自动化触发、数据桥接 | 聊天平台集成 |

## 28.11 完整代码

本章的完整代码位于 `examples/custom-webhook/` 目录，包含以下文件：

```
examples/custom-webhook/
  package.json              # 包配置
  tsconfig.json             # TypeScript 配置
  openclaw.plugin.json      # 插件清单
  index.ts                  # 插件入口
  api.ts                    # SDK 类型 re-export
  src/
    channel.ts              # ChannelPlugin 实现
    webhook-handler.ts       # Webhook 处理器
    webhook-handler.test.ts  # 单元测试
    types.ts                 # 类型定义
```

所有文件都可以直接使用。将 `custom-webhook/` 复制到 OpenClaw 的 `extensions/` 目录中即可在开发模式下运行。

对于独立发布的第三方插件，将其打包为 npm 包后，用户通过 `npm install` + OpenClaw 配置即可加载。这正是 `VISION.md` 中描述的分发方式："Preferred plugin path is npm package distribution plus local extension loading for development。"

## 练习

**思考题**

1. 本章的 custom-webhook Channel 使用 HTTP webhook 接收消息。与 WebSocket 长连接（如 Telegram Bot API）相比，webhook 模式在消息实时性、服务器资源占用、部署复杂度方面各有什么优劣？如果你要接入一个同时支持 webhook 和 WebSocket 的平台，你会选择哪种方式？

**动手题**

2. 在本章 custom-webhook 的基础上，添加一个简单的消息签名验证功能：入站请求必须带上 `X-Signature` header，Channel 用预配置的密钥验证签名。这模拟了 Telegram Bot API 和 GitHub Webhook 的安全验证机制。

3. 将 custom-webhook Channel 注册到 Gateway 后，用 `curl` 发送一条 JSON 格式的测试消息到 webhook 端点，验证消息能被 Gateway 接收并路由到 Agent。观察 Agent 的回复消息是如何通过出站转换函数格式化后返回给调用者的。
