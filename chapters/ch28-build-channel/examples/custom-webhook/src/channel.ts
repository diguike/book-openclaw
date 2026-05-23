/**
 * channel.ts — ChannelPlugin 实现
 *
 * 实现 OpenClaw 的 ChannelPlugin 接口，定义了 custom-webhook 渠道的：
 * - 元信息（名称、能力）
 * - 配置 Schema
 * - 消息路由规则
 * - Gateway 生命周期回调
 * - 出站消息发送逻辑
 *
 * 生产环境中应使用 openclaw/plugin-sdk/channel-core 中的
 * createChatChannelPlugin 工厂函数。本示例提供了等效的简化实现。
 */

import type { SendResult, CustomWebhookConfig } from './types.js';

const CHANNEL_ID = 'custom-webhook' as const;

/**
 * 渠道能力声明
 *
 * OpenClaw 根据这些声明决定哪些功能对该渠道可用。
 * 比如 threads: false 意味着 Agent 不会尝试在此渠道创建线程。
 */
const CAPABILITIES = {
  chatTypes: ['direct'] as const,
  media: false,         // 不支持图片/文件
  threads: false,       // 不支持线程
  reactions: false,     // 不支持 Reaction
  edit: false,          // 不支持编辑已发送消息
  unsend: false,        // 不支持撤回
  reply: false,         // 不支持引用回复
  effects: false,       // 不支持消息特效
  blockStreaming: false, // 不支持流式分块发送
};

/**
 * 渠道元信息
 *
 * 用于 UI 展示和渠道选择。
 */
const META = {
  id: CHANNEL_ID,
  label: 'Custom Webhook',
  selectionLabel: 'Custom Webhook (HTTP)',
  detailLabel: 'Custom Webhook (HTTP POST)',
  docsPath: '/channels/custom-webhook',
  blurb: 'Connect any HTTP client to OpenClaw via webhooks',
  order: 100,  // 排序权重，数字越大越靠后
};

/**
 * 默认配置
 */
const DEFAULT_CONFIG: CustomWebhookConfig = {
  secret: '',
  rateLimitPerMinute: 30,
  webhookPath: '/plugins/custom-webhook/inbound',
};

/**
 * 从环境变量和配置文件解析渠道配置
 */
export function resolveConfig(
  cfg?: Record<string, unknown>,
): CustomWebhookConfig {
  const channelCfg = (cfg?.channels as Record<string, unknown>)?.[CHANNEL_ID] as
    Record<string, unknown> | undefined;

  return {
    secret:
      process.env.CUSTOM_WEBHOOK_SECRET ??
      (channelCfg?.secret as string) ??
      DEFAULT_CONFIG.secret,
    defaultCallbackUrl:
      process.env.CUSTOM_WEBHOOK_CALLBACK_URL ??
      (channelCfg?.callbackUrl as string) ??
      undefined,
    rateLimitPerMinute:
      (channelCfg?.rateLimitPerMinute as number) ??
      DEFAULT_CONFIG.rateLimitPerMinute,
    webhookPath:
      (channelCfg?.webhookPath as string) ??
      DEFAULT_CONFIG.webhookPath,
  };
}

/**
 * 发送文本消息到目标 callback URL
 *
 * @param callbackUrl - 回调地址
 * @param text - 消息内容
 * @returns 发送结果
 */
async function sendTextToCallback(
  callbackUrl: string,
  text: string,
): Promise<SendResult> {
  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      source: 'openclaw',
      channel: CHANNEL_ID,
      text,
      timestamp: Date.now(),
    }),
    signal: AbortSignal.timeout(30_000), // 30 秒超时
  });

  if (!response.ok) {
    throw new Error(
      `Callback POST failed: ${response.status} ${response.statusText}`,
    );
  }

  return {
    channel: CHANNEL_ID,
    messageId: `cw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chatId: callbackUrl,
  };
}

/**
 * ChannelPlugin 类型定义（简化版）
 *
 * 生产环境中使用 openclaw/plugin-sdk/channel-core 中的完整类型。
 */
export interface ChannelPlugin {
  id: string;
  meta: typeof META;
  capabilities: typeof CAPABILITIES;
  messaging: {
    normalizeTarget: (target: string) => string | undefined;
    targetResolver: {
      looksLikeId: (id: string) => boolean;
      hint: string;
    };
  };
  gateway: {
    startAccount: (ctx: {
      cfg: Record<string, unknown>;
      accountId: string;
      abortSignal: AbortSignal;
      log?: {
        info: (message: string) => void;
        warn: (message: string) => void;
        error: (message: string) => void;
      };
    }) => Promise<unknown>;
    stopAccount: (ctx: {
      cfg: Record<string, unknown>;
      accountId: string;
      log?: {
        info: (message: string) => void;
      };
    }) => Promise<void>;
  };
  outbound: {
    deliveryMode: 'gateway';
    textChunkLimit: number;
    sendText: (ctx: {
      cfg: Record<string, unknown>;
      to: string;
      text: string;
      accountId?: string | null;
    }) => Promise<SendResult>;
  };
  agentPrompt?: {
    messageToolHints: () => string[];
  };
}

/**
 * 创建 custom-webhook ChannelPlugin 实例
 *
 * 这是本 Channel 扩展的核心工厂函数。
 * 生产环境中应改为调用 createChatChannelPlugin。
 */
export function createCustomWebhookPlugin(): ChannelPlugin {
  return {
    id: CHANNEL_ID,
    meta: META,
    capabilities: CAPABILITIES,

    // 消息路由
    messaging: {
      // 将目标地址标准化
      normalizeTarget: (target: string) => {
        const trimmed = target.trim();
        if (!trimmed) return undefined;
        // 去除 channel 前缀
        return trimmed.replace(/^custom-webhook:/i, '').trim();
      },
      targetResolver: {
        // 判断一个字符串是否看起来像有效的目标地址
        looksLikeId: (id: string) => {
          const trimmed = id?.trim();
          if (!trimmed) return false;
          // callback URL 应该是一个 HTTP(S) URL
          return /^https?:\/\//i.test(trimmed) ||
            /^custom-webhook:/i.test(trimmed);
        },
        hint: '<callback-url>',
      },
    },

    // Gateway 生命周期
    gateway: {
      startAccount: async ({ accountId, abortSignal, log }) => {
        log?.info?.(
          `[custom-webhook] Starting channel (account: ${accountId})`,
        );

        // HTTP 路由已在 register() 中注册
        // 这里只需要保持运行直到收到停止信号
        return new Promise<void>((resolve) => {
          const onAbort = () => {
            log?.info?.(
              `[custom-webhook] Stopping channel (account: ${accountId})`,
            );
            resolve();
          };

          if (abortSignal.aborted) {
            onAbort();
            return;
          }
          abortSignal.addEventListener('abort', onAbort, { once: true });
        });
      },

      stopAccount: async ({ accountId, log }) => {
        log?.info?.(
          `[custom-webhook] Account ${accountId} stopped`,
        );
      },
    },

    // 出站消息
    outbound: {
      deliveryMode: 'gateway',
      textChunkLimit: 4000, // 单条消息最大字符数

      sendText: async ({ to, text }) => {
        if (!to || !to.trim()) {
          throw new Error('No callback URL provided for reply delivery');
        }
        return sendTextToCallback(to.trim(), text);
      },
    },

    // Agent Prompt 提示
    agentPrompt: {
      messageToolHints: () => [
        '',
        '### Custom Webhook Formatting',
        'This channel receives messages via HTTP webhook and sends replies to a callback URL.',
        '',
        '**Limitations:**',
        '- Plain text only (no rich formatting)',
        '- No media attachments',
        '- No message editing or deletion',
        '- Keep messages under 4000 characters',
        '',
        '**Best practices:**',
        '- Use clear, concise text responses',
        '- Use line breaks to separate sections',
        '- Include relevant links as plain URLs',
      ],
    },
  };
}
