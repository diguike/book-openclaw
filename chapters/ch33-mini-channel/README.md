---
title: 第 33 章 — 接入消息渠道与端到端联调
feishu_url: "https://www.feishu.cn/wiki/UAuYw45z6irIvOkdegbcezJWnCc"
last_synced: "2026-05-03"
---

# 第 33 章 — 接入消息渠道与端到端联调

> 读完这章，你会完成 Mini OpenClaw 的最后一块拼图——WebChat 客户端，并跑通完整的端到端链路：用户发消息 → Gateway → Agent → 模型调用 → 工具执行 → 回复用户。

前三章实现了 Gateway、Agent Runtime、Memory 和 Skills。所有后端能力都到位了，但还缺一个前端——用户怎么和 Agent 对话？

OpenClaw 通过 31 个 extension 支持 Telegram、Discord、Slack、微信等消息渠道，每个渠道都是一个独立的插件包。Mini OpenClaw 只实现一个：WebChat——一个纯 HTML + WebSocket 的聊天页面。

## 33.1 WebChat 客户端

WebChat 是最轻量的消息渠道：一个 HTML 文件，不需要任何构建工具。它通过 WebSocket 连接到 Gateway，发送和接收 JSON 事件。

```html
<!-- src/channel/webchat.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Mini OpenClaw - WebChat</title>
  <style>
    /* 暗色主题样式 */
    body {
      font-family: -apple-system, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #messages { flex: 1; overflow-y: auto; padding: 16px; }
    .message.user {
      margin-left: auto;
      background: #2a4a8a;
      border-radius: 12px 12px 4px 12px;
    }
    .message.assistant {
      background: #2a2a4a;
      border-radius: 12px 12px 12px 4px;
    }
    .message.tool {
      border-left: 3px solid #ffa726;
      font-size: 13px;
      color: #aaa;
    }
    /* ... */
  </style>
</head>
<body>
  <div id="messages"></div>
  <div id="input-area">
    <input type="text" id="input" placeholder="输入消息..." />
    <button id="send">发送</button>
  </div>
  <script>
    // WebSocket 连接和消息处理
  </script>
</body>
</html>
```

### WebSocket 连接管理

客户端启动后连接 `ws://localhost:3210`，收到 `connected` 事件后进入就绪状态：

```javascript
const WS_URL = `ws://${location.hostname || 'localhost'}:3210`;
let ws = null;
let sessionId = null;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleServerEvent(data);
  };

  ws.onclose = () => {
    // 断线自动重连
    setTimeout(connect, 3000);
  };
}
```

断线重连是一个基本的健壮性保障。OpenClaw 的客户端实现了更复杂的重连策略——指数退避、消息补发、会话状态恢复等。Mini OpenClaw 只做简单的 3 秒重试。

### 事件处理

服务端推送 7 种事件，客户端逐一处理：

```javascript
function handleServerEvent(event) {
  switch (event.type) {
    case 'connected':
      sessionId = event.sessionId;
      statusEl.textContent = `Connected (session: ${sessionId.slice(0, 8)}...)`;
      sendBtn.disabled = false;
      break;

    case 'chunk':
      // 流式显示：每个 chunk 追加到当前助手消息
      if (!currentAssistantEl) {
        currentAssistantEl = addMessage('assistant', '');
        currentAssistantText = '';
      }
      currentAssistantText += event.content;
      currentAssistantEl.innerHTML = formatMarkdown(currentAssistantText);
      scrollToBottom();
      break;

    case 'message_done':
      currentAssistantEl = null;
      sendBtn.disabled = false;
      break;

    case 'tool_start':
      addMessage('tool', `调用工具: ${event.toolName}...`);
      break;

    case 'tool_done':
      addMessage('tool', `${event.toolName} 完成`);
      break;

    case 'error':
      addMessage('error', `错误: ${event.message}`);
      break;
  }
}
```

流式显示的关键在 `chunk` 事件的处理：每次收到一个文本片段，就追加到当前助手消息的 DOM 节点上。用户看到的效果是文字逐字出现，像打字机一样。

### 简易 Markdown 渲染

聊天界面支持基本的 Markdown 格式——代码块、行内代码和粗体：

```javascript
function formatMarkdown(text) {
  return text
    .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}
```

这不是一个完整的 Markdown 解析器，但对于聊天场景来说够用了。生产环境中可以替换成 `marked` 或 `markdown-it`。

## 33.2 入口文件：组装所有模块

`src/index.ts` 是 Mini OpenClaw 的入口，负责按顺序初始化所有模块：

```typescript
// src/index.ts

async function main(): Promise<void> {
  console.log('  Mini OpenClaw v0.1.0');

  // 1. 加载配置
  const config = loadConfig();
  if (!config.anthropicApiKey) {
    console.error('[错误] 缺少 ANTHROPIC_API_KEY 环境变量');
    process.exit(1);
  }

  // 2. 初始化 SessionStore
  const sessionStore = new SessionStore(config.sessionsDir);

  // 3. 初始化 Memory 和 Skills
  const memoryManager = new MemoryManager(config.memoryDir, config.workspaceDir);
  const skillsLoader = new SkillsLoader(config.skillsDir);

  // 4. 初始化 AgentRuntime，注册工具
  const agentRuntime = new AgentRuntime({
    config, sessionStore, memoryManager, skillsLoader,
  });
  const tools = createBuiltinTools(config.workspaceDir);
  for (const tool of tools) {
    agentRuntime.registerTool(tool);
  }

  // 5. 启动 Gateway
  const gateway = new GatewayServer(config, sessionStore, agentRuntime);
  gateway.start();

  // 优雅退出
  process.on('SIGINT', () => {
    gateway.stop();
    process.exit(0);
  });
}
```

初始化顺序有讲究：SessionStore 先于 AgentRuntime（因为 Runtime 需要读取会话历史），Memory 和 Skills 先于 Gateway（因为 prompt 组装需要它们），Gateway 最后启动（它依赖前面所有模块）。

OpenClaw 的启动流程（`src/gateway/server.impl.ts`）同样遵循依赖顺序，但步骤多得多：加载 TLS 配置、准备插件清单、初始化认证、预热模型目录缓存、启动 cron 服务……

## 33.3 启动与运行

### 环境准备

```bash
# 安装依赖
cd mini-openclaw
npm install

# 设置 API Key（必需）
export ANTHROPIC_API_KEY=your-key-here

# 可选配置
export MINI_OPENCLAW_PORT=3210              # WebSocket 端口
export MINI_OPENCLAW_MODEL=claude-sonnet-4-20250514  # 模型
export MINI_OPENCLAW_WORKSPACE=/path/to/workspace   # 工作目录
```

### 启动服务

```bash
# 开发模式（直接运行 TypeScript）
npm run dev

# 或者编译后运行
npm run build
npm start
```

启动成功后会看到：

```
========================================
  Mini OpenClaw v0.1.0
========================================

[Config] 工作目录: /home/ubuntu/projects
[Config] 模型: claude-sonnet-4-20250514
[Config] 端口: 3210

[Session] 存储目录: /home/ubuntu/projects/.mini-openclaw/sessions
[Memory] 目录: /home/ubuntu/projects/.mini-openclaw/memory
[Skills] 目录: /home/ubuntu/projects/.openclaw/skills
[Skills] 共加载 0 个 skill

[Agent] 已注册工具: bash
[Agent] 已注册工具: read_file
[Agent] 已注册工具: write_file

[Gateway] WebSocket 服务已启动，端口: 3210

[WebChat] 在浏览器中打开: file:///path/to/src/channel/webchat.html
```

### 打开 WebChat

在浏览器中打开 `src/channel/webchat.html` 文件。页面会自动连接到 `ws://localhost:3210`，连接成功后状态栏显示绿色的 `Connected`。

现在可以发送消息了。

## 33.4 端到端联调

下面跟踪一条消息从用户到 Agent 再到回复的完整链路。

### 测试 1：简单问答

在 WebChat 输入："你好，你是谁？"

链路：
1. WebChat 通过 WebSocket 发送 `{ type: "message", content: "你好，你是谁？" }`
2. Gateway `handleMessage()` 解析事件，调用 `routeToAgent()`
3. `routeToAgent()` 将消息存入 Session JSONL 文件
4. AgentRuntime `run()` 被调用：加载历史消息，组装 system prompt
5. `callModel()` 调用 Anthropic API（流式），model 返回文本
6. 每个 token 通过 `onChunk` 回调推送给 Gateway
7. Gateway 通过 WebSocket 发送 `chunk` 事件给客户端
8. 客户端实时显示文字
9. 模型完成后，Gateway 发送 `message_done` 事件
10. 助手回复存入 Session JSONL 文件

### 测试 2：工具调用

输入："帮我看看当前目录有什么文件"

这次 Agent 会使用工具：

1. 用户消息送到 AgentRuntime
2. 模型判断需要查看目录，返回 `tool_use: bash`，参数 `{ command: "ls -la" }`
3. Runtime 检测到 tool_use，执行 bash 工具
4. Gateway 推送 `tool_start` 和 `tool_done` 事件，WebChat 显示工具执行状态
5. 工具输出（目录列表）送回模型
6. 模型根据输出生成自然语言回复
7. 回复通过流式推送给客户端

### 测试 3：多轮工具调用

输入："帮我创建一个 hello.js 文件，内容是打印 Hello World，然后运行它"

这次 Agent 需要多轮工具调用：

1. **第一轮**：模型返回 `tool_use: write_file`，写入 hello.js
2. 工具结果送回模型
3. **第二轮**：模型返回 `tool_use: bash`，执行 `node hello.js`
4. 工具结果送回模型
5. **第三轮**：模型生成最终回复，告诉用户文件已创建并运行成功

这就是 Agent 循环的威力——模型可以连续调用多个工具完成复杂任务。

### 测试 4：Memory 持久化

1. 输入："请记住我的名字叫小明"
2. Agent 可能会写入 MEMORY.md
3. 重启服务
4. 在新会话中输入："你还记得我叫什么吗？"
5. Agent 从 MEMORY.md 中读取信息，回答"小明"

这验证了 Memory 系统的跨会话持久化能力。

## 33.5 数据产物

一次完整的对话后，磁盘上会产生这些文件：

```
.mini-openclaw/
├── sessions/
│   ├── 550e8400-e29b-41d4-a716-446655440000.meta.json   # 会话元数据
│   └── 550e8400-e29b-41d4-a716-446655440000.jsonl       # 会话记录
└── memory/
    ├── MEMORY.md           # 长期记忆（如果 Agent 写入了）
    └── daily-logs/
        └── 2026-04-29.md   # 今日日志
```

JSONL 文件的内容：

```jsonl
{"role":"user","content":"你好，你是谁？","timestamp":1745934600000}
{"role":"assistant","content":"你好！我是 Mini OpenClaw...","timestamp":1745934602000}
{"role":"user","content":"帮我看看当前目录","timestamp":1745934610000}
{"role":"assistant","content":"当前目录包含以下文件...","timestamp":1745934614000,"toolCalls":[{"toolName":"bash","input":{"command":"ls -la"},"output":"total 32\ndrwxr-xr-x..."}]}
```

## 33.6 项目完整文件清单

```
mini-openclaw/
├── package.json                    # 项目配置
├── tsconfig.json                   # TypeScript 配置
└── src/
    ├── index.ts                    # 入口文件
    ├── config.ts                   # 配置加载
    ├── types.ts                    # 类型定义
    ├── gateway/
    │   ├── server.ts               # WebSocket Gateway
    │   └── session-store.ts        # Session 管理
    ├── agent/
    │   ├── runtime.ts              # Agent 运行循环
    │   └── system-prompt.ts        # System Prompt 组装
    ├── tools/
    │   ├── index.ts                # 工具注册
    │   ├── bash.ts                 # Bash 工具
    │   ├── read-file.ts            # 文件读取工具
    │   └── write-file.ts           # 文件写入工具
    ├── memory/
    │   ├── manager.ts              # Memory 管理器
    │   └── skills.ts               # Skills 加载器
    └── channel/
        └── webchat.html            # WebChat 客户端
```

总共约 1,000 行 TypeScript + 200 行 HTML/CSS/JS。

## 33.7 与 OpenClaw 的对比总结

| 维度 | OpenClaw | Mini OpenClaw |
|------|---------|---------------|
| 代码规模 | 几十万行 | ~1,200 行 |
| 启动时间 | 数秒（加载插件、预热缓存） | <1 秒 |
| 依赖数量 | 100+ | 6 |
| 消息渠道 | 31 个 | 1 个 |
| 工具数量 | 几十个 | 3 个 |
| Memory | 向量检索 + 嵌入 + 混合搜索 | 文件驱动 |
| 安全 | 沙箱 + 审计 + 权限控制 | 无 |
| 多 Agent | 完整的 spawn/supervision | 无 |

代码量差了两个数量级，但核心架构一脉相承：

- **Gateway 模式**：WebSocket 连接管理 + 消息路由
- **Session 持久化**：JSONL 格式，追加写入
- **Agent 循环**：prompt → model → tool → result → model
- **Bootstrap Files**：SOUL.md 定义人设，TOOLS.md 定义偏好
- **Skills 索引**：frontmatter 解析 + XML 格式注入 + 按需加载
- **Memory**：MEMORY.md 长期记忆

理解了 Mini OpenClaw 的 1,200 行代码，再回头看 OpenClaw 的几十万行，你会发现那些代码在做的就是：把每个模块从"能跑"做到"能在生产环境稳定运行"。安全加固、边界处理、性能优化、多平台适配——这些才是工程量的大头。

但骨架，就是这 1,200 行。

## 练习

**思考题**

1. Mini OpenClaw 的 WebChat 客户端是一个单页面 HTML 文件，通过 WebSocket 直接连接 Gateway。如果要接入第二个渠道（比如 Telegram），需要在现有代码中修改哪些模块？对比 OpenClaw 的 Channel Plugin 架构，Mini OpenClaw 的当前设计在扩展新渠道时有什么不足？

**动手题**

2. 启动 Mini OpenClaw 的完整系统，进行一次端到端测试：在 WebChat 中要求 Agent 创建一个文件、读取该文件的内容、然后修改文件。检查每一步的 Session transcript（JSONL 文件），确认消息记录是否完整覆盖了用户输入、模型输出、工具调用和工具结果。

3. 在 Mini OpenClaw 中实现一个简单的消息格式化功能：当 Agent 的回复包含 Markdown 代码块时，WebChat 客户端能正确渲染代码高亮（可以使用 `highlight.js` 或简单的 `<pre><code>` 标签）。修改 `webchat.html` 中的消息渲染逻辑，测试代码块、列表、粗体等 Markdown 元素的渲染效果。
