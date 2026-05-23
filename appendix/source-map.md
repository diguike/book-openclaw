---
title: "附录 A — 源码导航速查表"
feishu_url: "https://www.feishu.cn/wiki/L7oZwEsZGi8t7pkN9JScDtO1nah"
last_synced: "2026-05-03"
---

# 附录 A — 源码导航速查表

本附录按模块列出 OpenClaw 仓库中的关键文件路径和职责，帮助你在阅读源码时快速定位目标代码。路径均以仓库根目录为起点。

## 入口和 CLI

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/entry.ts` | 进程入口，启动分发（CLI / Gateway / Daemon） | 第 2 章 |
| `src/entry.compile-cache.ts` | V8 compile cache 加速启动 | 第 2 章 |
| `src/entry.respawn.ts` | 进程自重启策略（版本检查、环境修复） | 第 25 章 |
| `src/index.ts` | 模块公共导出桶文件 | 第 2 章 |
| `src/library.ts` | 以库模式嵌入时的入口 | 第 26 章 |
| `src/cli/program.ts` | Commander 命令树注册，所有子命令的根 | 第 2 章 |
| `src/cli/run-main.ts` | CLI 主流程：参数解析 → 命令路由 → 执行 | 第 2 章 |
| `src/cli/argv.ts` | 全局参数定义（`--agent`、`--model` 等） | 第 3 章 |
| `src/cli/gateway-cli.ts` | `openclaw gateway` 子命令（start/stop/status） | 第 4 章 |
| `src/cli/daemon-cli.ts` | `openclaw daemon` 守护进程管理 | 第 4 章 |
| `src/cli/config-cli.ts` | `openclaw config` 配置读写 | 附录 B |
| `src/cli/plugins-cli.ts` | `openclaw plugins` 插件安装/卸载/更新 | 第 26 章 |
| `src/cli/skills-cli.ts` | `openclaw skills` 技能管理 | 第 14 章 |
| `src/cli/models-cli.ts` | `openclaw models` 模型列表与切换 | 第 11 章 |
| `src/cli/security-cli.ts` | `openclaw security` 安全审计 CLI | 第 23 章 |
| `src/cli/mcp-cli.ts` | `openclaw mcp` MCP 服务器管理 | 第 9 章 |
| `src/cli/cron-cli.ts` | `openclaw cron` 定时任务管理 | 第 16 章 |
| `src/cli/nodes-cli.ts` | `openclaw nodes` 远程节点管理 | 第 25 章 |
| `src/cli/prompt.ts` | 交互式提示（TUI 输入） | 第 3 章 |

## Gateway 核心

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/gateway/server.ts` | Gateway 服务器主入口，组装所有子系统 | 第 4 章 |
| `src/gateway/server.impl.ts` | 服务器核心实现（启动序列、信号处理） | 第 4 章 |
| `src/gateway/boot.ts` | Gateway 启动引导：配置加载、端口绑定、插件初始化 | 第 4 章 |
| `src/gateway/server-http.ts` | HTTP 路由（REST API、Control UI、健康检查） | 第 4 章 |
| `src/gateway/server-ws-runtime.ts` | WebSocket 连接管理与消息分发 | 第 4 章 |
| `src/gateway/client.ts` | Gateway 客户端（CLI 连接 Gateway 的桥梁） | 第 5 章 |
| `src/gateway/protocol/` | WebSocket 协议定义（消息类型、握手、心跳） | 第 4 章 |
| `src/gateway/server-chat.ts` | 聊天消息处理核心：接收 → 路由 → Agent 调用 → 响应 | 第 5 章 |
| `src/gateway/server-channels.ts` | 渠道连接管理（注册、健康监控、消息桥接） | 第 17 章 |
| `src/gateway/server-plugins.ts` | 插件生命周期管理（加载、激活、卸载） | 第 26 章 |
| `src/gateway/server-cron.ts` | Cron 调度器，管理定时任务触发 | 第 16 章 |
| `src/gateway/server-lanes.ts` | Lane 命令队列，保证 Session 单写者语义 | 第 6 章 |
| `src/gateway/server-methods/` | Gateway RPC 方法注册（供客户端调用的 API） | 第 4 章 |
| `src/gateway/server-startup.ts` | 启动阶段的子系统初始化顺序 | 第 4 章 |
| `src/gateway/server-startup-memory.ts` | Memory 子系统的启动初始化 | 第 15 章 |
| `src/gateway/server-startup-plugins.ts` | 插件子系统的启动初始化 | 第 26 章 |
| `src/gateway/auth.ts` | Gateway 认证：Token 验证、设备配对 | 第 23 章 |
| `src/gateway/connection-auth.ts` | 连接级认证（WebSocket 握手时验证） | 第 23 章 |
| `src/gateway/device-auth.ts` | 设备认证与配对管理（移动端/桌面端） | 第 23 章 |
| `src/gateway/control-ui.ts` | Control UI Web 控制台的路由与 CSP | 第 4 章 |
| `src/gateway/mcp-http.ts` | MCP over HTTP 的传输层实现 | 第 9 章 |
| `src/gateway/openai-http.ts` | OpenAI 兼容 API 端点 | 第 11 章 |
| `src/gateway/net.ts` | 网络层工具（端口发现、地址绑定） | 第 4 章 |

## Agent Runtime

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/agents/pi-embedded-runner/` | Agent 推理主循环：请求 → LLM → 工具执行 → 循环 | 第 5 章 |
| `src/agents/system-prompt.ts` | System Prompt 组装：静态段 + 动态段 + 缓存边界 | 第 8 章 |
| `src/agents/system-prompt-params.ts` | System Prompt 的动态参数（时间、平台、用户信息） | 第 8 章 |
| `src/agents/system-prompt-cache-boundary.ts` | Anthropic prompt cache 边界控制 | 第 8 章 |
| `src/agents/compaction.ts` | 上下文压缩：摘要生成、标识符保留 | 第 12 章 |
| `src/agents/pi-hooks/context-pruning.ts` | 上下文裁剪：消息丢弃策略 | 第 12 章 |
| `src/agents/pi-hooks/context-pruning/pruner.ts` | Pruner 核心算法：按重要性评分裁剪消息 | 第 12 章 |
| `src/agents/lanes.ts` | Lane 定义：会话级命令队列的并发控制 | 第 6 章 |
| `src/agents/agent-scope.ts` | Agent 作用域：多 Agent 配置隔离 | 第 18 章 |
| `src/agents/agent-paths.ts` | Agent 目录路径解析（配置、数据、缓存） | 第 2 章 |
| `src/agents/agent-runtime-config.ts` | Agent 运行时配置的合并与优先级 | 第 13 章 |
| `src/agents/auth-profiles.ts` | 认证配置管理：多 Provider 凭证轮换 | 第 11 章 |
| `src/agents/heartbeat-system-prompt.ts` | Heartbeat 的 System Prompt 注入 | 第 16 章 |
| `src/agents/memory-search.ts` | Memory 检索：查询构建与结果注入 | 第 15 章 |
| `src/agents/acp-spawn.ts` | ACP (Agent Communication Protocol) 子进程启动 | 第 19 章 |

## 工具系统

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/agents/tool-catalog.ts` | 工具注册表：收集所有可用工具的元数据 | 第 9 章 |
| `src/agents/tool-policy.ts` | 工具策略引擎：allow / deny / ask 三级控制 | 第 9 章 |
| `src/agents/tool-policy-pipeline.ts` | 工具策略管道：多层策略的合并与求值 | 第 9 章 |
| `src/agents/tool-allowlist-guard.ts` | 工具白名单守卫（配置级约束） | 第 9 章 |
| `src/agents/bash-tools.exec-approval-request.ts` | Bash 执行审批请求构建 | 第 10 章 |
| `src/agents/bash-tools.exec-approval-followup.ts` | Bash 执行审批结果处理 | 第 10 章 |
| `src/agents/bash-tools.descriptions.ts` | Bash 工具描述文案（注入 System Prompt） | 第 10 章 |
| `src/agents/bash-process-registry.ts` | Bash 进程注册表：后台进程跟踪与清理 | 第 10 章 |
| `src/mcp/` | MCP 工具服务端/客户端实现 | 第 9 章 |
| `src/agents/pi-bundle-mcp-runtime.ts` | MCP 工具运行时绑定与调用 | 第 9 章 |
| `src/agents/pi-bundle-mcp-tools.ts` | MCP 工具 Schema 物化与注册 | 第 9 章 |

## Session 管理

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/sessions/session-id.ts` | Session ID 生成与解析 | 第 6 章 |
| `src/sessions/session-lifecycle-events.ts` | Session 生命周期事件（创建、恢复、销毁） | 第 6 章 |
| `src/sessions/send-policy.ts` | 消息发送策略（速率限制、队列控制） | 第 7 章 |
| `src/sessions/model-overrides.ts` | Session 级模型覆盖 | 第 11 章 |
| `src/gateway/session-compaction-checkpoints.ts` | Compaction 检查点持久化 | 第 12 章 |
| `src/gateway/session-lifecycle-state.ts` | Session 状态机（active / paused / killed） | 第 6 章 |
| `src/gateway/session-history-state.ts` | 会话历史记录管理 | 第 6 章 |
| `src/gateway/sessions-resolve.ts` | Session 路由解析（渠道 → Agent → Session） | 第 6 章 |

## Memory 系统

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/memory/root-memory-files.ts` | Memory 文件层：磁盘文件索引 | 第 15 章 |
| `extensions/memory-core/` | Memory 核心插件：嵌入、存储、检索 | 第 15 章 |
| `extensions/memory-lancedb/` | LanceDB 向量存储后端 | 第 15 章 |
| `extensions/memory-wiki/` | Wiki 风格 Markdown 记忆存储 | 第 15 章 |
| `src/plugin-sdk/memory-core-host-engine-embeddings.ts` | 嵌入引擎宿主桥接 | 第 15 章 |
| `src/plugin-sdk/memory-core-host-engine-storage.ts` | 存储引擎宿主桥接 | 第 15 章 |
| `src/plugin-sdk/memory-core-host-query.ts` | Memory 查询宿主桥接 | 第 15 章 |
| `src/plugin-sdk/memory-host-search.ts` | Memory 搜索 API（混合检索） | 第 15 章 |
| `src/memory-host-sdk/` | Memory 宿主 SDK 接口定义 | 第 15 章 |

## Skills 系统

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/agents/skills/types.ts` | Skill 类型定义（元数据、配置、工具清单） | 第 14 章 |
| `src/agents/skills/filter.ts` | Skill 过滤：按 Agent 配置筛选可用 Skill | 第 14 章 |
| `src/agents/skills/frontmatter.ts` | Skill Markdown 头部解析（YAML frontmatter） | 第 14 章 |
| `src/agents/skills/local-loader.ts` | 本地 Skill 加载器（从磁盘读取） | 第 14 章 |
| `src/agents/skills/workspace.ts` | Workspace Skill 发现与注册 | 第 14 章 |
| `src/agents/skills/plugin-skills.ts` | 插件 Skill 加载（从已安装插件中提取） | 第 14 章 |
| `src/agents/skills/refresh.ts` | Skill 索引刷新（文件变更监听） | 第 14 章 |
| `src/agents/skills/config.ts` | Skill 配置 Schema（enable/disable 控制） | 第 14 章 |
| `src/agents/skills/bundled-dir.ts` | 内置 Skill 目录路径解析 | 第 14 章 |
| `skills/` | 52 个内置 Skill（github、slack、discord 等） | 第 14 章 |

## Channel / Platform

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/channels/registry.ts` | Channel 注册表：管理所有已激活渠道 | 第 17 章 |
| `src/channels/channel-config.ts` | Channel 配置加载与验证 | 第 17 章 |
| `src/channels/session.ts` | Channel Session 绑定（渠道消息 → Session） | 第 17 章 |
| `src/channels/run-state-machine.ts` | Channel 消息处理状态机 | 第 17 章 |
| `src/channels/typing.ts` | 打字状态指示器（typing indicator） | 第 17 章 |
| `src/channels/draft-stream-controls.ts` | 流式输出的分块控制 | 第 7 章 |
| `src/channels/thread-bindings-policy.ts` | 线程绑定策略（Thread Binding） | 第 18 章 |
| `src/channels/conversation-binding-context.ts` | 会话绑定上下文解析 | 第 18 章 |
| `src/channels/mention-gating.ts` | @提及 过滤（哪些消息触发 Agent） | 第 17 章 |
| `src/channels/allow-from.ts` | 来源白名单（allowFrom 配置） | 第 23 章 |
| `extensions/telegram/` | Telegram 渠道插件 | 第 17 章 |
| `extensions/discord/` | Discord 渠道插件 | 第 17 章 |
| `extensions/slack/` | Slack 渠道插件 | 第 17 章 |
| `extensions/whatsapp/` | WhatsApp 渠道插件 | 第 17 章 |
| `extensions/imessage/` | iMessage 渠道插件 | 第 17 章 |
| `extensions/matrix/` | Matrix 渠道插件 | 第 17 章 |

## Security

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/security/audit.ts` | 安全审计入口：运行所有审计检查项 | 第 23 章 |
| `src/security/audit-gateway-config.ts` | Gateway 配置安全审计 | 第 23 章 |
| `src/security/audit-tool-policy.ts` | 工具策略安全审计 | 第 23 章 |
| `src/security/audit-channel.ts` | Channel 配置安全审计 | 第 23 章 |
| `src/security/audit-plugins-trust.ts` | 插件信任等级审计 | 第 24 章 |
| `src/security/audit-deep-code-safety.ts` | 深度代码安全扫描 | 第 24 章 |
| `src/security/skill-scanner.ts` | Skill 安全扫描（检测恶意指令） | 第 24 章 |
| `src/security/dm-policy-shared.ts` | DM 策略（私聊安全控制） | 第 23 章 |
| `src/security/fix.ts` | 安全问题自动修复 | 第 23 章 |
| `src/security/dangerous-config-flags.ts` | 危险配置标记检测 | 第 23 章 |
| `src/security/context-visibility.ts` | 上下文可见性控制（哪些信息对 LLM 可见） | 第 23 章 |

## Config

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/config/io.ts` | 配置文件读写核心（JSON5 解析、原子写入） | 附录 B |
| `src/config/schema.ts` | 配置 Schema 导出（Zod + JSON Schema） | 附录 B |
| `src/config/schema.base.generated.ts` | 自动生成的完整 JSON Schema | 附录 B |
| `src/config/schema.help.ts` | 配置项帮助文案（`openclaw config --help`） | 附录 B |
| `src/config/validation.ts` | 配置校验（运行时 + 启动时） | 附录 B |
| `src/config/defaults.ts` | 各配置项的默认值定义 | 附录 B |
| `src/config/types.ts` | 配置类型总导出（按子模块拆分） | 附录 B |
| `src/config/types.base.ts` | 基础配置类型（`OpenClawConfig` 根类型） | 附录 B |
| `src/config/types.agents.ts` | Agent 相关配置类型 | 第 13 章 |
| `src/config/types.channels.ts` | Channel 配置类型 | 第 17 章 |
| `src/config/types.tools.ts` | 工具策略配置类型 | 第 9 章 |
| `src/config/types.memory.ts` | Memory 配置类型 | 第 15 章 |
| `src/config/types.skills.ts` | Skills 配置类型 | 第 14 章 |
| `src/config/types.cron.ts` | Cron 配置类型 | 第 16 章 |
| `src/config/types.gateway.ts` | Gateway 配置类型 | 第 4 章 |
| `src/config/types.sandbox.ts` | 沙箱配置类型 | 第 10 章 |
| `src/config/types.mcp.ts` | MCP 配置类型 | 第 9 章 |
| `src/config/merge-patch.ts` | 配置合并（JSON Merge Patch 语义） | 附录 B |
| `src/config/legacy.ts` | 旧版配置迁移 | 附录 B |
| `src/config/mcp-config.ts` | MCP Server 配置解析 | 第 9 章 |

## Plugin SDK

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/plugin-sdk/agent-runtime.ts` | Agent Runtime API（供插件使用） | 第 26 章 |
| `src/plugin-sdk/channel-core.ts` | Channel SDK 核心（消息收发、状态管理） | 第 26 章 |
| `src/plugin-sdk/channel-lifecycle.ts` | Channel 生命周期钩子 | 第 26 章 |
| `src/plugin-sdk/channel-reply-pipeline.ts` | 回复管道 SDK（分块、媒体、格式化） | 第 26 章 |
| `src/plugin-sdk/provider-stream.ts` | Provider 流式 SDK（SSE 解析、token 计数） | 第 11 章 |
| `src/plugin-sdk/provider-auth-runtime.ts` | Provider 认证 SDK | 第 11 章 |
| `src/plugin-sdk/plugin-runtime.ts` | 插件运行时生命周期 | 第 26 章 |
| `src/plugin-sdk/skills-runtime.ts` | Skill 运行时 SDK | 第 14 章 |
| `src/plugin-sdk/memory-host-core.ts` | Memory 插件宿主核心 | 第 15 章 |
| `src/plugin-sdk/index.ts` | SDK 公共 API 导出（`openclaw/plugin-sdk`） | 第 26 章 |
| `src/plugins/` | 插件加载器（发现、扫描、激活） | 第 26 章 |
| `extensions/` | 130+ 个官方插件（渠道、Provider、工具） | 第 26 章 |

## 其他重要模块

| 文件路径 | 职责简述 | 相关章节 |
|---------|---------|---------|
| `src/daemon/` | 守护进程管理（launchd、systemd 集成） | 第 25 章 |
| `src/cron/` | Cron 调度核心（任务定义、投递、重试） | 第 16 章 |
| `src/browser/` | 浏览器自动化（CDP / Playwright） | 第 22 章 |
| `src/canvas-host/` | Canvas 渲染宿主（A2UI 前端运行时） | 第 20 章 |
| `src/canvas-host/a2ui/` | A2UI（Agent-to-UI）前端 bundle | 第 20 章 |
| `src/tts/` | TTS 语音合成调度 | 第 21 章 |
| `src/realtime-voice/` | 实时语音会话（WebRTC） | 第 21 章 |
| `src/bootstrap/` | 启动环境初始化（CA 证书、Node 环境变量） | 第 2 章 |
| `src/web-search/` | Web 搜索抽象层 | 第 9 章 |
| `src/web-fetch/` | Web 内容抓取 | 第 9 章 |
| `src/image-generation/` | 图像生成调度 | 第 20 章 |
| `src/routing/` | 消息路由核心 | 第 5 章 |
| `src/hooks/` | 钩子系统（生命周期回调） | 第 4 章 |
| `ui/` | Web 控制台前端（Control UI） | 第 4 章 |
| `apps/` | macOS / iOS / Android 客户端 | 第 25 章 |
