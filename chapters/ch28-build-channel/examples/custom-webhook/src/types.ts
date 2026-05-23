/**
 * types.ts — custom-webhook 渠道的类型定义
 */

/**
 * 入站 Webhook 请求的 payload 格式
 *
 * 外部系统向 OpenClaw 发送消息时使用此格式。
 */
export interface WebhookPayload {
  /** 发送者唯一标识（必填） */
  senderId: string;

  /** 发送者显示名称（可选，默认使用 senderId） */
  senderName?: string;

  /** 消息正文（必填） */
  text: string;

  /** 回复回调地址（可选，用于接收 Agent 的回复） */
  callbackUrl?: string;

  /** 扩展元数据（可选，透传到 Agent 上下文） */
  metadata?: Record<string, unknown>;
}

/**
 * 转换后的内部消息格式
 *
 * Webhook Handler 将 WebhookPayload 转换为此格式，
 * 然后传递给 Agent 运行时。
 */
export interface InboundMessage {
  /** 清洗后的消息正文 */
  body: string;

  /** 发送者标识 */
  from: string;

  /** 发送者显示名称 */
  senderName: string;

  /** 渠道提供者标识 */
  provider: 'custom-webhook';

  /** 聊天类型 */
  chatType: 'direct';

  /** 回复回调地址 */
  callbackUrl: string;
}

/**
 * 出站消息的发送结果
 */
export interface SendResult {
  /** 渠道标识 */
  channel: 'custom-webhook';

  /** 消息唯一标识 */
  messageId: string;

  /** 目标聊天标识（这里是 callback URL） */
  chatId: string;
}

/**
 * 渠道配置
 */
export interface CustomWebhookConfig {
  /** Webhook 认证密钥 */
  secret: string;

  /** 默认回调 URL（当请求中未指定 callbackUrl 时使用） */
  defaultCallbackUrl?: string;

  /** 速率限制：每分钟最大请求数 */
  rateLimitPerMinute: number;

  /** Webhook 路径 */
  webhookPath: string;
}
