/**
 * 会话存储 - JSONL 持久化
 *
 * OpenClaw 的会话存储使用 JSONL 格式（src/gateway/session-transcript-files.fs.ts），
 * 每条消息占一行，追加写入，支持快速尾部读取。
 * 这里保留了同样的 JSONL 格式，但简化了锁机制和归档逻辑。
 */

import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Message, Session, SessionMeta, SessionStatus } from '../types.js';

export class SessionStore {
  private sessionsDir: string;
  /** 内存中的会话索引，启动时从磁盘加载 */
  private index: Map<string, SessionMeta> = new Map();
  /** 写入锁：每个 session 同时只允许一个写入操作 */
  private writeLocks: Map<string, Promise<void>> = new Map();

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
    // 确保目录存在
    fs.mkdirSync(sessionsDir, { recursive: true });
    // 启动时扫描已有会话
    this.rebuildIndex();
  }

  /** 创建新会话 */
  createSession(channelId: string): SessionMeta {
    const sessionId = uuidv4();
    const now = Date.now();
    const meta: SessionMeta = {
      sessionId,
      channelId,
      createdAt: now,
      lastActiveAt: now,
      status: 'active',
    };
    // 写入元数据文件
    const metaPath = this.metaPath(sessionId);
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf-8');
    // 创建空的 JSONL 文件
    fs.writeFileSync(this.transcriptPath(sessionId), '', 'utf-8');
    this.index.set(sessionId, meta);
    return meta;
  }

  /** 追加消息到 JSONL 文件 */
  async appendMessage(sessionId: string, message: Message): Promise<void> {
    // 单写者锁：等待上一次写入完成
    const prev = this.writeLocks.get(sessionId) ?? Promise.resolve();
    const current = prev.then(() => this.doAppend(sessionId, message));
    this.writeLocks.set(sessionId, current);
    await current;
  }

  /** 读取会话的全部消息 */
  loadMessages(sessionId: string): Message[] {
    const filePath = this.transcriptPath(sessionId);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) {
      return [];
    }
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Message);
  }

  /** 加载完整会话数据 */
  loadSession(sessionId: string): Session | null {
    const meta = this.index.get(sessionId);
    if (!meta) {
      return null;
    }
    return {
      meta,
      messages: this.loadMessages(sessionId),
    };
  }

  /** 获取指定 channel 的最新活跃会话，不存在则创建 */
  getOrCreateSession(channelId: string): SessionMeta {
    // 找到该 channel 最后活跃的会话
    for (const meta of this.index.values()) {
      if (meta.channelId === channelId && meta.status === 'active') {
        return meta;
      }
    }
    return this.createSession(channelId);
  }

  /** 更新会话状态 */
  updateStatus(sessionId: string, status: SessionStatus): void {
    const meta = this.index.get(sessionId);
    if (!meta) return;
    meta.status = status;
    meta.lastActiveAt = Date.now();
    fs.writeFileSync(this.metaPath(sessionId), JSON.stringify(meta), 'utf-8');
  }

  /** 列出所有会话 */
  listSessions(): SessionMeta[] {
    return Array.from(this.index.values());
  }

  // ---- 内部方法 ----

  private async doAppend(sessionId: string, message: Message): Promise<void> {
    const filePath = this.transcriptPath(sessionId);
    const line = JSON.stringify(message) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
    // 更新索引中的最后活跃时间
    const meta = this.index.get(sessionId);
    if (meta) {
      meta.lastActiveAt = Date.now();
    }
  }

  private transcriptPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private metaPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.meta.json`);
  }

  /** 从磁盘扫描重建会话索引 */
  private rebuildIndex(): void {
    if (!fs.existsSync(this.sessionsDir)) return;
    const files = fs.readdirSync(this.sessionsDir);
    for (const file of files) {
      if (!file.endsWith('.meta.json')) continue;
      try {
        const content = fs.readFileSync(
          path.join(this.sessionsDir, file),
          'utf-8',
        );
        const meta = JSON.parse(content) as SessionMeta;
        this.index.set(meta.sessionId, meta);
      } catch {
        // 跳过损坏的元数据文件
      }
    }
  }
}
