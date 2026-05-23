/**
 * WebSocket Gateway Server
 *
 * OpenClaw 的 Gateway（src/gateway/server.impl.ts）是一个 400+ 行的复杂入口，
 * 管理 HTTP 服务、WebSocket 连接、插件生命周期、认证、模型目录等。
 * 这里只保留核心：WebSocket 连接管理 + 消息路由。
 */

import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { ClientEvent, ServerEvent, MiniOpenClawConfig } from '../types.js';
import { SessionStore } from './session-store.js';
import type { AgentRuntime } from '../agent/runtime.js';

/** 连接上下文：每个 WebSocket 连接关联一个 session */
type ConnectionContext = {
  connectionId: string;
  sessionId: string;
  ws: WebSocket;
};

export class GatewayServer {
  private wss: WebSocketServer | null = null;
  private connections: Map<string, ConnectionContext> = new Map();
  private sessionStore: SessionStore;
  private agentRuntime: AgentRuntime;
  private config: MiniOpenClawConfig;

  constructor(
    config: MiniOpenClawConfig,
    sessionStore: SessionStore,
    agentRuntime: AgentRuntime,
  ) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.agentRuntime = agentRuntime;
  }

  /** 启动 WebSocket 服务 */
  start(): void {
    this.wss = new WebSocketServer({ port: this.config.port });

    this.wss.on('connection', (ws) => {
      this.handleConnection(ws);
    });

    console.log(`[Gateway] WebSocket 服务已启动，端口: ${this.config.port}`);
  }

  /** 停止服务 */
  stop(): void {
    for (const ctx of this.connections.values()) {
      ctx.ws.close();
    }
    this.connections.clear();
    this.wss?.close();
    console.log('[Gateway] 服务已停止');
  }

  /** 处理新的 WebSocket 连接 */
  private handleConnection(ws: WebSocket): void {
    const connectionId = uuidv4();
    // 默认使用 "webchat" 渠道创建或获取会话
    const sessionMeta = this.sessionStore.getOrCreateSession('webchat');

    const ctx: ConnectionContext = {
      connectionId,
      sessionId: sessionMeta.sessionId,
      ws,
    };
    this.connections.set(connectionId, ctx);

    // 发送连接成功事件
    this.send(ws, {
      type: 'connected',
      sessionId: sessionMeta.sessionId,
    });

    console.log(
      `[Gateway] 新连接: ${connectionId}, 会话: ${sessionMeta.sessionId}`,
    );

    ws.on('message', (data) => {
      this.handleMessage(ctx, data.toString());
    });

    ws.on('close', () => {
      this.connections.delete(connectionId);
      console.log(`[Gateway] 连接断开: ${connectionId}`);
    });

    ws.on('error', (err) => {
      console.error(`[Gateway] 连接错误: ${connectionId}`, err.message);
    });
  }

  /** 处理客户端消息 */
  private async handleMessage(
    ctx: ConnectionContext,
    raw: string,
  ): Promise<void> {
    let event: ClientEvent;
    try {
      event = JSON.parse(raw) as ClientEvent;
    } catch {
      this.send(ctx.ws, { type: 'error', message: '无效的 JSON 格式' });
      return;
    }

    if (event.type === 'ping') {
      this.send(ctx.ws, { type: 'pong' });
      return;
    }

    if (event.type === 'message') {
      // 如果客户端指定了 sessionId，切换到该会话
      if (event.sessionId) {
        ctx.sessionId = event.sessionId;
      }
      await this.routeToAgent(ctx, event.content);
    }
  }

  /**
   * 将用户消息路由到 Agent Runtime
   *
   * 这是 Gateway 的核心职责：接收用户输入，交给 Agent 处理，
   * 将 Agent 的流式输出转发回客户端。
   */
  private async routeToAgent(
    ctx: ConnectionContext,
    content: string,
  ): Promise<void> {
    const { sessionId } = ctx;

    // 1. 存储用户消息
    await this.sessionStore.appendMessage(sessionId, {
      role: 'user',
      content,
      timestamp: Date.now(),
    });

    // 2. 调用 Agent Runtime，传入流式回调
    try {
      const response = await this.agentRuntime.run({
        sessionId,
        userMessage: content,
        // 流式回调：每个文本块实时推送到客户端
        onChunk: (chunk: string) => {
          this.send(ctx.ws, {
            type: 'chunk',
            sessionId,
            content: chunk,
          });
        },
        // 工具执行回调
        onToolStart: (toolName: string) => {
          this.send(ctx.ws, {
            type: 'tool_start',
            sessionId,
            toolName,
          });
        },
        onToolDone: (toolName: string, output: string) => {
          this.send(ctx.ws, {
            type: 'tool_done',
            sessionId,
            toolName,
            output,
          });
        },
      });

      // 3. 存储助手回复
      await this.sessionStore.appendMessage(sessionId, {
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        toolCalls: response.toolCalls,
      });

      // 4. 发送完成事件
      this.send(ctx.ws, {
        type: 'message_done',
        sessionId,
        content: response.content,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误';
      console.error(`[Gateway] Agent 运行错误:`, message);
      this.send(ctx.ws, { type: 'error', message });
    }
  }

  /** 向客户端发送事件 */
  private send(ws: WebSocket, event: ServerEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }
}
