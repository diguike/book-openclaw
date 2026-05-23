/**
 * index.ts — custom-webhook 插件入口
 *
 * 这是 OpenClaw 加载此插件时的入口文件。
 * 它定义了插件的基本信息，并在 register 回调中完成：
 * 1. 创建 ChannelPlugin 实例
 * 2. 注册到 OpenClaw 渠道系统
 * 3. 注册入站 Webhook HTTP 路由
 *
 * 在 OpenClaw 仓库外开发时，api.ts 中的类型应替换为：
 *   import { definePluginEntry } from 'openclaw/plugin-sdk/core';
 */

import { definePluginEntry, type OpenClawPluginApi } from './api.js';
import { createCustomWebhookPlugin, resolveConfig } from './src/channel.js';
import { createWebhookHandler } from './src/webhook-handler.js';
import type { InboundMessage } from './src/types.js';

export default definePluginEntry({
  id: 'custom-webhook',
  name: 'Custom Webhook',
  description:
    'A generic HTTP webhook channel for integrating external systems with OpenClaw.',

  register(api: OpenClawPluginApi) {
    // 1. 创建 Channel Plugin
    const plugin = createCustomWebhookPlugin();
    api.registerChannel({ plugin });

    // 2. 解析配置
    const config = resolveConfig(api.config as Record<string, unknown>);

    // 3. 创建 Webhook 处理器
    const handler = createWebhookHandler({
      secret: config.secret,
      defaultCallbackUrl: config.defaultCallbackUrl,
      rateLimitPerMinute: config.rateLimitPerMinute,
      deliver: async (msg: InboundMessage): Promise<string | null> => {
        // 在生产环境中，这里通过 OpenClaw 运行时将消息传递给 Agent。
        // 具体实现取决于 Gateway 的 inbound 管道。
        //
        // 简化示例：直接记录日志
        api.logger.info?.(
          `[custom-webhook] Delivering message from ${msg.from}: ${msg.body.slice(0, 80)}`,
        );

        // 返回 null 表示异步处理，回复将通过 outbound.sendText 发送
        return null;
      },
      log: {
        info: (...args: unknown[]) => api.logger.info?.(String(args.join(' '))),
        warn: (...args: unknown[]) => api.logger.warn?.(String(args.join(' '))),
        error: (...args: unknown[]) => api.logger.error?.(String(args.join(' '))),
      },
    });

    // 4. 注册 HTTP 路由
    api.registerHttpRoute({
      path: config.webhookPath,
      auth: 'plugin',
      match: 'exact',
      handler: handler as unknown as (req: unknown, res: unknown) => Promise<boolean>,
    });

    api.logger.info?.(
      `[custom-webhook] Registered inbound webhook at ${config.webhookPath}`,
    );
  },
});
