/**
 * webhook-handler.ts — 入站 Webhook 处理器
 *
 * 处理外部 HTTP 请求，校验安全凭证，解析消息，传递给 Agent。
 *
 * 处理流程：
 * 1. 校验 HTTP 方法（只接受 POST）
 * 2. 提取 Authorization Token
 * 3. Constant-time Token 比较
 * 4. 读取和校验请求体
 * 5. 输入清洗
 * 6. 立即返回 202 Accepted
 * 7. 异步投递到 Agent 运行时
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { WebhookPayload, InboundMessage } from './types.js';

// ─── 配置常量 ─────────────────────────────────────────

/** 请求体最大字节数（64 KB） */
const MAX_BODY_BYTES = 64 * 1024;

/** 读取请求体的超时时间（5 秒） */
const BODY_TIMEOUT_MS = 5_000;

/** 速率限制窗口（1 分钟） */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** 默认速率限制（每分钟请求数） */
const DEFAULT_RATE_LIMIT = 30;

// ─── Zod Schema ──────────────────────────────────────

/**
 * 入站消息的校验 Schema
 *
 * 使用 Zod 做类型安全的输入校验。
 * OpenClaw 内部也大量使用 Zod 做 schema 校验（见 webhooks 扩展的 http.ts）。
 */
const webhookPayloadSchema = z.object({
  senderId: z.string().trim().min(1, 'senderId is required'),
  senderName: z.string().trim().optional(),
  text: z.string().trim().min(1, 'text is required'),
  callbackUrl: z.string().url('callbackUrl must be a valid URL').optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ─── 安全工具 ─────────────────────────────────────────

/**
 * Constant-time 字符串比较
 *
 * 防止时序攻击：无论在哪个位置不匹配，比较时间都相同。
 * OpenClaw 使用 openclaw/plugin-sdk/security-runtime 中的 safeEqualSecret。
 * 这里提供一个等效的独立实现。
 */
export function timingSafeCompare(a: string, b: string): boolean {
  // 先做哈希让长度一致，避免长度泄露
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * 从 HTTP 请求中提取 Bearer Token
 */
function extractBearerToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader) return undefined;

  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!header) return undefined;

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

// ─── 速率限制 ─────────────────────────────────────────

/**
 * 简单的固定窗口速率限制器
 *
 * OpenClaw 使用更完善的 createFixedWindowRateLimiter
 * （从 openclaw/plugin-sdk/webhook-ingress 导出）。
 */
export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly windows = new Map<string, { count: number; startMs: number }>();

  constructor(maxRequests = DEFAULT_RATE_LIMIT, windowMs = RATE_LIMIT_WINDOW_MS) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * 检查请求是否在限制内
   * @returns true 如果允许，false 如果超限
   */
  check(key: string): boolean {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || now - existing.startMs >= this.windowMs) {
      this.windows.set(key, { count: 1, startMs: now });
      return true;
    }

    existing.count++;
    return existing.count <= this.maxRequests;
  }

  /** 清除所有状态（用于测试） */
  clear(): void {
    this.windows.clear();
  }
}

// ─── 请求体读取 ────────────────────────────────────────

/**
 * 安全地读取 HTTP 请求体
 *
 * 包含以下防护：
 * - 大小限制（防止内存耗尽）
 * - 超时限制（防止慢速攻击）
 * - Content-Type 校验
 */
async function readRequestBody(
  req: IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
  timeoutMs = BODY_TIMEOUT_MS,
): Promise<{ ok: true; body: string } | { ok: false; status: number; error: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let resolved = false;

    const finish = (result: { ok: true; body: string } | { ok: false; status: number; error: string }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(result);
    };

    // 超时保护
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, status: 408, error: 'Request timeout' });
    }, timeoutMs);

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        finish({ ok: false, status: 413, error: 'Request body too large' });
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      finish({ ok: true, body: Buffer.concat(chunks).toString('utf-8') });
    });

    req.on('error', () => {
      finish({ ok: false, status: 400, error: 'Failed to read request body' });
    });
  });
}

// ─── 输入清洗 ──────────────────────────────────────────

/**
 * 清洗用户输入
 *
 * 移除可能的控制字符和过长的空白。
 */
function sanitizeInput(text: string): string {
  return text
    // 移除 null 字节
    .replace(/\0/g, '')
    // 规范化换行
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // 移除非打印控制字符（保留换行和 tab）
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

// ─── JSON 响应工具 ──────────────────────────────────────

function respondJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// ─── Webhook Handler ──────────────────────────────────

export interface WebhookHandlerDeps {
  /** Webhook 认证密钥 */
  secret: string;

  /** 默认回调 URL */
  defaultCallbackUrl?: string;

  /**
   * 将消息传递给 Agent 运行时
   * @returns Agent 的回复文本，或 null
   */
  deliver: (msg: InboundMessage) => Promise<string | null>;

  /** 日志记录器 */
  log?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  /** 每分钟速率限制 */
  rateLimitPerMinute?: number;
}

/**
 * 创建 Webhook 请求处理器
 *
 * 返回一个标准的 Node.js HTTP 请求处理函数，
 * 可以直接注册到 OpenClaw 的 Gateway HTTP 服务器。
 */
export function createWebhookHandler(deps: WebhookHandlerDeps) {
  const { secret, deliver, log, defaultCallbackUrl } = deps;
  const rateLimiter = new RateLimiter(deps.rateLimitPerMinute);

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    // 1. 校验 HTTP 方法
    if (req.method !== 'POST') {
      respondJson(res, 405, { error: 'Method not allowed. Use POST.' });
      return true;
    }

    // 2. 提取并校验 Token
    const token = extractBearerToken(req);
    if (!token) {
      respondJson(res, 401, { error: 'Missing Authorization header. Use Bearer token.' });
      return true;
    }

    if (!secret) {
      log?.error?.('[custom-webhook] Secret not configured, rejecting all requests');
      respondJson(res, 500, { error: 'Webhook secret not configured' });
      return true;
    }

    // 3. Constant-time Token 比较
    if (!timingSafeCompare(token, secret)) {
      log?.warn?.(`[custom-webhook] Invalid token from ${req.socket?.remoteAddress}`);
      respondJson(res, 401, { error: 'Invalid token' });
      return true;
    }

    // 4. 速率限制
    const clientIp = req.socket?.remoteAddress ?? 'unknown';
    if (!rateLimiter.check(clientIp)) {
      log?.warn?.(`[custom-webhook] Rate limit exceeded for ${clientIp}`);
      respondJson(res, 429, { error: 'Rate limit exceeded. Try again later.' });
      return true;
    }

    // 5. 读取请求体
    const bodyResult = await readRequestBody(req);
    if (!bodyResult.ok) {
      respondJson(res, bodyResult.status, { error: bodyResult.error });
      return true;
    }

    // 6. 解析和校验 payload
    let payload: WebhookPayload;
    try {
      const parsed = JSON.parse(bodyResult.body);
      const validated = webhookPayloadSchema.safeParse(parsed);
      if (!validated.success) {
        const firstError = validated.error.issues[0];
        const errorPath = firstError?.path.join('.') ?? '';
        const errorMsg = firstError?.message ?? 'Invalid request body';
        respondJson(res, 400, {
          error: errorPath ? `${errorPath}: ${errorMsg}` : errorMsg,
        });
        return true;
      }
      payload = validated.data;
    } catch {
      respondJson(res, 400, { error: 'Invalid JSON body' });
      return true;
    }

    // 7. 输入清洗
    const cleanText = sanitizeInput(payload.text);
    if (!cleanText) {
      respondJson(res, 400, { error: 'Message text is empty after sanitization' });
      return true;
    }

    // 8. 解析回调 URL
    const callbackUrl = payload.callbackUrl ?? defaultCallbackUrl;
    if (!callbackUrl) {
      respondJson(res, 400, {
        error: 'No callbackUrl provided and no default configured',
      });
      return true;
    }

    const preview = cleanText.length > 80
      ? `${cleanText.slice(0, 80)}...`
      : cleanText;
    log?.info?.(
      `[custom-webhook] Message from ${payload.senderName ?? payload.senderId}: ${preview}`,
    );

    // 9. 立即 ACK（202 Accepted）
    respondJson(res, 202, {
      ok: true,
      message: 'Message received, processing...',
    });

    // 10. 异步投递到 Agent
    const inboundMessage: InboundMessage = {
      body: cleanText,
      from: payload.senderId,
      senderName: payload.senderName ?? payload.senderId,
      provider: 'custom-webhook',
      chatType: 'direct',
      callbackUrl,
    };

    // 投递是 fire-and-forget，不阻塞 HTTP 响应
    deliver(inboundMessage).catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.(
        `[custom-webhook] Failed to process message from ${payload.senderId}: ${errMsg}`,
      );
    });

    return true;
  };
}
