/**
 * webhook-handler.test.ts — Webhook 处理器的单元测试
 *
 * 使用 Node.js 内置 test runner（node:test）。
 * 运行方式：node --import tsx --test src/webhook-handler.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createWebhookHandler, timingSafeCompare, RateLimiter } from './webhook-handler.js';

// ─── 测试辅助工具 ──────────────────────────────────────

const TEST_SECRET = 'test-secret-token-12345';
const TEST_CALLBACK_URL = 'https://example.com/callback';

/**
 * 创建一个测试用的 HTTP 服务器
 * 返回服务器的 base URL 和清理函数
 */
async function createTestServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Failed to get server address');
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * 发送测试请求到 Webhook 端点
 */
async function sendWebhookRequest(params: {
  baseUrl: string;
  method?: string;
  token?: string;
  body?: unknown;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.token) {
    headers['Authorization'] = `Bearer ${params.token}`;
  }

  const response = await fetch(`${params.baseUrl}/plugins/custom-webhook/inbound`, {
    method: params.method ?? 'POST',
    headers,
    body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
  });

  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return { status: response.status, body };
}

// ─── 单元测试：timingSafeCompare ──────────────────────

describe('timingSafeCompare', () => {
  it('相同字符串应返回 true', () => {
    assert.equal(timingSafeCompare('hello', 'hello'), true);
  });

  it('不同字符串应返回 false', () => {
    assert.equal(timingSafeCompare('hello', 'world'), false);
  });

  it('空字符串比较应返回 true', () => {
    assert.equal(timingSafeCompare('', ''), true);
  });

  it('不同长度的字符串应返回 false', () => {
    assert.equal(timingSafeCompare('short', 'longer-string'), false);
  });
});

// ─── 单元测试：RateLimiter ───────────────────────────

describe('RateLimiter', () => {
  it('在限制内应返回 true', () => {
    const limiter = new RateLimiter(3);
    assert.equal(limiter.check('user-1'), true);
    assert.equal(limiter.check('user-1'), true);
    assert.equal(limiter.check('user-1'), true);
  });

  it('超过限制应返回 false', () => {
    const limiter = new RateLimiter(2);
    assert.equal(limiter.check('user-1'), true);
    assert.equal(limiter.check('user-1'), true);
    assert.equal(limiter.check('user-1'), false);
  });

  it('不同 key 应独立计数', () => {
    const limiter = new RateLimiter(1);
    assert.equal(limiter.check('user-1'), true);
    assert.equal(limiter.check('user-2'), true);
    assert.equal(limiter.check('user-1'), false);
    assert.equal(limiter.check('user-2'), false);
  });
});

// ─── 集成测试：Webhook Handler ─────────────────────────

describe('WebhookHandler', () => {
  let server: { baseUrl: string; close: () => Promise<void> };
  let deliveredMessages: Array<{ body: string; from: string }>;

  beforeEach(async () => {
    deliveredMessages = [];

    const handler = createWebhookHandler({
      secret: TEST_SECRET,
      defaultCallbackUrl: TEST_CALLBACK_URL,
      deliver: async (msg) => {
        deliveredMessages.push({ body: msg.body, from: msg.from });
        return `Echo: ${msg.body}`;
      },
      rateLimitPerMinute: 100,
    });

    server = await createTestServer(handler);
  });

  // 每个测试后关闭服务器
  // 注意：node:test 的 afterEach 需要手动管理
  const cleanup = async () => {
    if (server) await server.close();
  };

  it('正常消息应返回 202', async () => {
    const result = await sendWebhookRequest({
      baseUrl: server.baseUrl,
      token: TEST_SECRET,
      body: {
        senderId: 'user-123',
        senderName: 'Alice',
        text: 'Hello, OpenClaw!',
      },
    });

    assert.equal(result.status, 202);
    assert.equal(result.body.ok, true);

    // 等待异步投递完成
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(deliveredMessages.length, 1);
    assert.equal(deliveredMessages[0].body, 'Hello, OpenClaw!');
    assert.equal(deliveredMessages[0].from, 'user-123');

    await cleanup();
  });

  it('缺少 Authorization Header 应返回 401', async () => {
    const result = await sendWebhookRequest({
      baseUrl: server.baseUrl,
      body: { senderId: 'user-123', text: 'test' },
    });

    assert.equal(result.status, 401);
    assert.match(result.body.error as string, /Missing Authorization/);

    await cleanup();
  });

  it('错误的 Token 应返回 401', async () => {
    const result = await sendWebhookRequest({
      baseUrl: server.baseUrl,
      token: 'wrong-token',
      body: { senderId: 'user-123', text: 'test' },
    });

    assert.equal(result.status, 401);
    assert.match(result.body.error as string, /Invalid token/);

    await cleanup();
  });

  it('缺少必填字段应返回 400', async () => {
    const result = await sendWebhookRequest({
      baseUrl: server.baseUrl,
      token: TEST_SECRET,
      body: { senderId: 'user-123' }, // 缺少 text
    });

    assert.equal(result.status, 400);

    await cleanup();
  });

  it('GET 请求应返回 405', async () => {
    const result = await sendWebhookRequest({
      baseUrl: server.baseUrl,
      method: 'GET',
      token: TEST_SECRET,
    });

    assert.equal(result.status, 405);

    await cleanup();
  });

  it('空消息体应返回 400', async () => {
    const result = await sendWebhookRequest({
      baseUrl: server.baseUrl,
      token: TEST_SECRET,
      body: { senderId: 'user-123', text: '   ' }, // 清洗后为空
    });

    assert.equal(result.status, 400);

    await cleanup();
  });

  it('额外字段应被拒绝（strict mode）', async () => {
    const result = await sendWebhookRequest({
      baseUrl: server.baseUrl,
      token: TEST_SECRET,
      body: {
        senderId: 'user-123',
        text: 'test',
        unknownField: 'hacker',
      },
    });

    assert.equal(result.status, 400);

    await cleanup();
  });

  it('自定义 callbackUrl 应覆盖默认值', async () => {
    const customCallback = 'https://custom.example.com/webhook';

    const result = await sendWebhookRequest({
      baseUrl: server.baseUrl,
      token: TEST_SECRET,
      body: {
        senderId: 'user-123',
        text: 'test with custom callback',
        callbackUrl: customCallback,
      },
    });

    assert.equal(result.status, 202);

    // 等待异步投递
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(deliveredMessages.length, 1);

    await cleanup();
  });
});
