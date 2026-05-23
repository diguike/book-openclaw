---
title: "附录 B — 配置文件完整参考"
feishu_url: "https://www.feishu.cn/wiki/Amaiw1uIwieGQgko8sMcJZOVnNG"
last_synced: "2026-05-03"
---

# 附录 B — 配置文件完整参考

OpenClaw 的配置体系由多个文件组成，分布在不同路径。本附录汇总所有配置文件的结构和字段说明。

## 配置文件分布

OpenClaw 的配置按用途分为三层目录：

| 路径 | 用途 |
|------|------|
| `~/.openclaw/` | 全局配置根目录 |
| `~/.openclaw/openclaw.json` | 主配置文件（核心行为控制） |
| `~/.openclaw/agents/<agentId>/` | 每个 Agent 的独立配置目录 |
| `~/.openclaw/agents/<agentId>/agent/` | Agent 的 bootstrap 文件（SOUL.md 等） |
| `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` | Agent 的认证配置 |
| `~/.openclaw/agents/<agentId>/agent/models.json` | Agent 的模型配置 |
| `~/.openclaw/credentials/` | 渠道/Provider 凭证存储 |

## openclaw.json 完整字段

`openclaw.json` 是 OpenClaw 的主配置文件，使用 JSON5 格式（支持注释和尾逗号）。以下按顶级分组说明关键字段。

### meta（元数据）

系统自动维护的元数据，一般不需要手动修改。

| 字段 | 类型 | 说明 |
|------|------|------|
| `meta.lastTouchedVersion` | string | 最后一次写入配置的 OpenClaw 版本号 |
| `meta.lastTouchedAt` | string | 最后一次配置写入的 ISO 时间戳 |

### env（环境变量）

| 字段 | 类型 | 说明 |
|------|------|------|
| `env.shellEnv.enabled` | boolean | 是否从用户 shell profile 加载环境变量，默认 `true` |
| `env.shellEnv.timeoutMs` | integer | Shell 环境加载超时（毫秒） |
| `env.vars` | object | 键值对形式的自定义环境变量，注入到 Agent 运行时 |

### agents（Agent 配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `agents` | object | 以 Agent ID 为键的配置对象 |
| `agents.<id>.model` | string | 默认模型（如 `"anthropic:claude-sonnet-4-20250514"`） |
| `agents.<id>.modelFallback` | string | 回退模型 |
| `agents.<id>.maxTurns` | integer | 单次对话最大推理轮次 |
| `agents.<id>.systemPrompt` | string | System Prompt 覆盖（优先于 SOUL.md） |
| `agents.<id>.skills` | object | Skill 启用/禁用配置 |
| `agents.<id>.tools` | object | 工具策略配置（见下方工具策略小节） |
| `agents.<id>.memory` | object | Memory 配置（provider、搜索参数） |
| `agents.<id>.cron` | array | 定时任务定义 |
| `agents.<id>.concurrency` | integer | 并发会话上限 |
| `agents.<id>.heartbeat` | object | Heartbeat 配置（间隔、条件） |

### tools（工具策略）

工具策略控制 Agent 可以使用哪些工具，以及执行时的审批方式。

| 字段 | 类型 | 说明 |
|------|------|------|
| `tools.allow` | string[] | 允许列表，匹配的工具无需审批 |
| `tools.deny` | string[] | 拒绝列表，匹配的工具直接禁用 |
| `tools.ask` | string[] | 审批列表，匹配的工具每次执行需用户确认 |
| `tools.alsoAllow` | string[] | 附加允许列表（追加到默认允许列表） |
| `tools.allowFrom` | string[] | 来源白名单，仅允许特定来源的工具调用 |

### channels（渠道配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `channels.<type>.enabled` | boolean | 是否启用该渠道 |
| `channels.<type>.allowFrom` | string[] | 允许发送消息的用户/群组 ID |
| `channels.<type>.dmPolicy` | string | 私聊策略：`"allow"` / `"deny"` / `"ask"` |
| `channels.<type>.mentionGating` | boolean | 是否只响应 @提及 消息 |
| `channels.<type>.threadBinding` | string | 线程绑定模式：`"per-thread"` / `"per-channel"` |

每个渠道类型还有专属字段（如 Telegram 的 `botToken`、Discord 的 `guildId` 等），具体参见对应渠道的文档。

### gateway（Gateway 配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `gateway.port` | integer | Gateway HTTP/WS 监听端口，默认 `4141` |
| `gateway.host` | string | 绑定地址，默认 `"127.0.0.1"` |
| `gateway.secret` | string | Gateway 认证密钥 |
| `gateway.controlUI` | boolean | 是否启用 Web 控制台 |
| `gateway.controlUIOrigins` | string[] | 允许访问控制台的跨域来源 |
| `gateway.tailscale` | object | Tailscale 集成配置 |

### sandbox（沙箱配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `sandbox.enabled` | boolean | 是否启用沙箱执行 |
| `sandbox.docker` | object | Docker 沙箱配置（镜像、挂载、网络） |

### memory（Memory 配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `memory.provider` | string | Memory 存储后端（`"lancedb"` / `"wiki"` 等） |
| `memory.enabled` | boolean | 是否启用 Memory |
| `memory.searchTopK` | integer | 检索时返回的最大结果数 |

### mcp（MCP 配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `mcp.servers` | object | MCP Server 定义，键为服务名 |
| `mcp.servers.<name>.command` | string | 启动命令 |
| `mcp.servers.<name>.args` | string[] | 启动参数 |
| `mcp.servers.<name>.env` | object | 环境变量 |
| `mcp.servers.<name>.url` | string | SSE/HTTP URL（远程模式） |

### hooks（钩子配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `hooks.beforeChat` | string | 聊天前触发的脚本路径 |
| `hooks.afterChat` | string | 聊天后触发的脚本路径 |
| `hooks.beforeTool` | string | 工具执行前触发的脚本路径 |

### logging（日志配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `logging.level` | string | 日志级别：`"debug"` / `"info"` / `"warn"` / `"error"` |
| `logging.maxFileBytes` | integer | 单个日志文件的最大字节数 |

### plugins（插件配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `plugins` | object | 已安装插件的配置（由 `openclaw plugins install` 自动管理） |
| `plugins.<id>.enabled` | boolean | 是否启用该插件 |
| `plugins.<id>.config` | object | 插件专属配置 |

---

## models.json

位于 `~/.openclaw/agents/<agentId>/agent/models.json`，定义 Agent 可用的模型列表和别名。

```jsonc
{
  // 默认模型
  "default": "anthropic:claude-sonnet-4-20250514",
  // 模型别名映射
  "aliases": {
    "fast": "anthropic:claude-haiku-3-20250307",
    "smart": "anthropic:claude-sonnet-4-20250514",
    "reasoning": "anthropic:claude-opus-4-20250514"
  },
  // 模型专属参数覆盖
  "overrides": {
    "anthropic:claude-sonnet-4-20250514": {
      "maxTokens": 8192,
      "temperature": 0.7
    }
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `default` | string | 默认模型标识，格式为 `provider:modelId` |
| `aliases` | object | 模型别名，键为别名、值为完整模型标识 |
| `overrides` | object | 按模型 ID 覆盖请求参数（maxTokens、temperature 等） |

---

## auth-profiles.json

位于 `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`，管理多 Provider 的认证凭证。支持配置多个 profile 实现故障转移和负载分散。

```jsonc
{
  "profiles": [
    {
      "id": "anthropic-primary",
      "provider": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "priority": 1
    },
    {
      "id": "openai-fallback",
      "provider": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "priority": 2
    },
    {
      "id": "vertex-org",
      "provider": "anthropic-vertex",
      "projectId": "my-gcp-project",
      "region": "us-central1",
      "priority": 3
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `profiles` | array | 认证配置列表 |
| `profiles[].id` | string | 唯一标识（用于日志和状态追踪） |
| `profiles[].provider` | string | Provider 类型（`anthropic` / `openai` / `google` 等） |
| `profiles[].apiKey` | string | API Key，支持 `${ENV_VAR}` 引用环境变量 |
| `profiles[].priority` | integer | 优先级，数字越小优先级越高 |
| `profiles[].projectId` | string | GCP 项目 ID（Vertex AI 专用） |
| `profiles[].region` | string | 区域（Vertex AI / Bedrock 专用） |
| `profiles[].baseUrl` | string | 自定义 API 端点（自部署场景） |
| `profiles[].cooldownMs` | integer | 失败后冷却时间（毫秒），默认自动计算 |

凭证轮换逻辑参见第 11 章。

---

## Bootstrap Files 推荐模板

Bootstrap Files 是 Agent 的"人格文件"，位于 Agent 目录下的 `agent/` 子目录。以下是三个核心文件的推荐模板。

### SOUL.md

定义 Agent 的身份、性格和行为边界。

```markdown
# 身份

你是 [Agent 名称]，[一句话定位]。

# 性格

- [特征 1]
- [特征 2]
- [特征 3]

# 规则

- [硬性约束 1]
- [硬性约束 2]

# 知识

[Agent 的领域知识或上下文]
```

关键原则：
- 保持简洁，不超过 500 词。过长的 SOUL.md 会占用 Context Window 预算
- 用祈使句写规则，不要用"你应该"之类的委婉表达
- 避免和 System Prompt 的默认指令重复

### AGENTS.md

定义 Agent 的工作流程和任务处理策略。当 Agent 目录下存在此文件时，内容会被注入到 System Prompt。

```markdown
# 工作流程

1. [步骤 1]
2. [步骤 2]
3. [步骤 3]

# 处理规则

- 当 [场景 A] 时，[行为 A]
- 当 [场景 B] 时，[行为 B]

# 输出格式

[对输出格式的约束]
```

### TOOLS.md

显式声明 Agent 可用的工具和使用指导。适合需要精确控制工具使用的场景。

```markdown
# 可用工具

## [工具名称 1]
- 用途：[说明]
- 注意：[使用时的约束]

## [工具名称 2]
- 用途：[说明]
- 注意：[使用时的约束]

# 禁止使用

- [不应使用的工具或操作]
```

---

## 环境变量速查

OpenClaw 支持通过环境变量覆盖配置或控制运行时行为。以下列出常用环境变量。

### Provider 凭证

| 环境变量 | 说明 |
|---------|------|
| `ANTHROPIC_API_KEY` | Anthropic API Key |
| `OPENAI_API_KEY` | OpenAI API Key |
| `GOOGLE_API_KEY` | Google AI API Key |
| `GROQ_API_KEY` | Groq API Key |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `XAI_API_KEY` | xAI API Key |
| `MISTRAL_API_KEY` | Mistral API Key |
| `TOGETHER_API_KEY` | Together AI API Key |
| `FIREWORKS_API_KEY` | Fireworks API Key |
| `OPENROUTER_API_KEY` | OpenRouter API Key |

### Gateway 控制

| 环境变量 | 说明 |
|---------|------|
| `OPENCLAW_GATEWAY_PORT` | 覆盖 Gateway 监听端口 |
| `OPENCLAW_GATEWAY_SECRET` | 覆盖 Gateway 认证密钥 |
| `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS` | 允许非 TLS 的私网 WebSocket 连接 |

### 运行时行为

| 环境变量 | 说明 |
|---------|------|
| `OPENCLAW_LOCAL_CHECK` | `1` 启用本地校验，`0` 禁用 |
| `OPENCLAW_LOCAL_CHECK_MODE` | 校验模式：`throttled` / `full` |
| `OPENCLAW_VITEST_MAX_WORKERS` | 测试并行 worker 数量上限 |
| `OPENCLAW_LIVE_TEST` | `1` 启用 live 测试（真实 API 调用） |
| `OPENCLAW_LIVE_TEST_QUIET` | `0` 显示 live 测试详细输出 |

### 调试

| 环境变量 | 说明 |
|---------|------|
| `OPENCLAW_LOG_LEVEL` | 日志级别覆盖 |
| `OPENCLAW_DEBUG` | 启用调试模式 |
| `NODE_OPTIONS` | Node.js 运行时选项（如 `--max-old-space-size=4096`） |

配置优先级从高到低：环境变量 > `openclaw.json` > Agent 配置 > 默认值。`${ENV_VAR}` 语法可在配置文件中引用环境变量，OpenClaw 会在加载时进行替换。
