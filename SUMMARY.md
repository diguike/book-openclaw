---
title: 目录
feishu_url: ""
last_synced: ""
---

# 目录

## 前言

- [前言 — 为什么要读一个 Agent 项目的源码](./chapters/ch00-preface/README.md)

## 第一部分：全局认知

- [第 1 章 — OpenClaw 全景：从 Clawdbot 到 350K Stars](./chapters/ch01-overview/README.md)
- [第 2 章 — 项目工程结构：Monorepo、模块划分与构建体系](./chapters/ch02-project-structure/README.md)
- [第 3 章 — 快速上手：本地部署你的第一个 Agent](./chapters/ch03-quickstart/README.md)

## 第二部分：Gateway 与运行时核心

- [第 4 章 — Gateway 架构：单进程守护与 WebSocket 协议设计](./chapters/ch04-gateway/README.md)
- [第 5 章 — 请求生命周期：从消息到达到响应返回的完整链路](./chapters/ch05-request-lifecycle/README.md)
- [第 6 章 — Session 管理：单写者模型与 Lane-aware 命令队列](./chapters/ch06-session/README.md)
- [第 7 章 — 流式响应：分块输出、段落感知与 NO_REPLY 机制](./chapters/ch07-streaming/README.md)

## 第三部分：Agent Runtime 深度剖析

- [第 8 章 — System Prompt 组装：动态拼装的工程艺术](./chapters/ch08-system-prompt/README.md)
- [第 9 章 — 工具系统：注册、发现、策略与执行](./chapters/ch09-tool-system/README.md)
- [第 10 章 — Bash 工具：进程管理、PTY 与沙箱执行](./chapters/ch10-bash-tools/README.md)
- [第 11 章 — Model Provider 抽象：多模型统一接入与故障转移](./chapters/ch11-model-provider/README.md)
- [第 12 章 — Context Window 管理：Compaction、Pruning 与预算控制](./chapters/ch12-context-window/README.md)

## 第四部分：Workspace Kernel — 文件驱动的 Agent 设计哲学

- [第 13 章 — Bootstrap Files：SOUL.md 与文件驱动的 Agent 人格](./chapters/ch13-bootstrap-files/README.md)
- [第 14 章 — Skills 系统：元数据索引与按需加载](./chapters/ch14-skills/README.md)
- [第 15 章 — Memory 系统：四层记忆架构与混合检索](./chapters/ch15-memory/README.md)
- [第 16 章 — Heartbeat 与 Cron：Agent 的主动行为机制](./chapters/ch16-heartbeat-cron/README.md)

## 第五部分：平台接入与多 Agent 协作

- [第 17 章 — Channel Bridge：25+ 渠道的统一消息抽象](./chapters/ch17-channel-bridge/README.md)
- [第 18 章 — 多 Agent 路由：Bindings、Workspace 隔离与会话分发](./chapters/ch18-multi-agent/README.md)
- [第 19 章 — Sub-Agent 系统：异步编排与结构化通信](./chapters/ch19-sub-agent/README.md)

## 第六部分：交互前沿

- [第 20 章 — Canvas 与 A2UI：Agent 驱动的可视化界面](./chapters/ch20-canvas-a2ui/README.md)
- [第 21 章 — Voice 与 TTS：语音交互全链路](./chapters/ch21-voice-tts/README.md)
- [第 22 章 — Browser 自动化：CDP、Playwright 与网页操作](./chapters/ch22-browser/README.md)

## 第七部分：安全与生产化

- [第 23 章 — 七层安全模型：从认证到沙箱的纵深防御](./chapters/ch23-security/README.md)
- [第 24 章 — 实战安全分析：真实漏洞、恶意 Skill 与 Prompt 注入](./chapters/ch24-security-cases/README.md)
- [第 25 章 — 生产部署：从单机到 Kubernetes 的架构演进](./chapters/ch25-deployment/README.md)
- [第 26 章 — Plugin 与 Extension 开发：扩展 Gateway 能力](./chapters/ch26-plugin-extension/README.md)

## 第八部分：实战与构建

- [第 27 章 — 实战：从零开发一个 OpenClaw Skill](./chapters/ch27-build-skill/README.md)
- [第 28 章 — 实战：开发一个 Channel Extension](./chapters/ch28-build-channel/README.md)
- [第 29 章 — Mini OpenClaw 架构设计](./chapters/ch29-mini-design/README.md)
- [第 30 章 — 实现 Gateway 与 Session 核心](./chapters/ch30-mini-gateway/README.md)
- [第 31 章 — 实现 Agent Runtime 与工具执行](./chapters/ch31-mini-agent/README.md)
- [第 32 章 — 实现 Memory 与 Skills 加载](./chapters/ch32-mini-memory-skills/README.md)
- [第 33 章 — 接入消息渠道与端到端联调](./chapters/ch33-mini-channel/README.md)

## 第九部分：设计模式总结

- [第 34 章 — OpenClaw 的 10 个核心设计模式](./chapters/ch34-design-patterns/README.md)

## 附录

- [附录 A — 源码导航速查表](./appendix/source-map.md)
- [附录 B — 配置文件完整参考](./appendix/config-reference.md)
- [附录 C — 术语表](./appendix/glossary.md)
