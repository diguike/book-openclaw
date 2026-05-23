/**
 * Mini OpenClaw 核心类型定义
 *
 * 对应 OpenClaw 的 src/types/ 和 src/gateway/protocol/，
 * 这里只保留最小可用子集。
 */

// ============================================================
// 消息类型
// ============================================================

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
  /** 本轮使用了哪些工具 */
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

// ============================================================
// 工具类型
// ============================================================

/** 工具参数定义 */
export type ToolParameter = {
  type: string;
  description: string;
  required?: boolean;
};

/** 工具定义 */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  /** 工具执行函数 */
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
};

/** 工具执行结果 */
export type ToolResult = {
  success: boolean;
  output: string;
  error?: string;
};

/** 工具调用记录（存入会话历史） */
export type ToolCallRecord = {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
};

// ============================================================
// 会话类型
// ============================================================

/** 会话状态 */
export type SessionStatus = 'active' | 'idle' | 'archived';

/** 会话元数据 */
export type SessionMeta = {
  sessionId: string;
  channelId: string;
  /** 会话创建时间 */
  createdAt: number;
  /** 最后活跃时间 */
  lastActiveAt: number;
  status: SessionStatus;
};

/** 完整会话数据 */
export type Session = {
  meta: SessionMeta;
  messages: Message[];
};

// ============================================================
// WebSocket 协议
// ============================================================

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

// ============================================================
// 配置类型
// ============================================================

/** Mini OpenClaw 全局配置 */
export type MiniOpenClawConfig = {
  /** WebSocket 服务端口 */
  port: number;
  /** Anthropic API Key */
  anthropicApiKey: string;
  /** 使用的模型 */
  model: string;
  /** 工作目录（Agent 的文件操作根目录） */
  workspaceDir: string;
  /** 会话存储目录 */
  sessionsDir: string;
  /** Memory 目录 */
  memoryDir: string;
  /** Skills 目录 */
  skillsDir: string;
  /** 最大上下文消息条数 */
  maxContextMessages: number;
};
