/**
 * Memory 管理器
 *
 * OpenClaw 的 Memory 系统（src/memory/）包括向量检索、嵌入模型、
 * 混合搜索等复杂能力。
 * 这里简化为文件驱动的 Memory：MEMORY.md 作为长期记忆，
 * daily-log 作为每日工作日志。
 */

import fs from 'node:fs';
import path from 'node:path';

/** Memory 文件名常量（与 OpenClaw 保持一致） */
const MEMORY_FILENAME = 'MEMORY.md';
const DAILY_LOG_DIR = 'daily-logs';

export class MemoryManager {
  private memoryDir: string;
  private workspaceDir: string;

  constructor(memoryDir: string, workspaceDir: string) {
    this.memoryDir = memoryDir;
    this.workspaceDir = workspaceDir;
    // 确保目录存在
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.mkdirSync(path.join(memoryDir, DAILY_LOG_DIR), { recursive: true });
  }

  /**
   * 获取用于注入 System Prompt 的 Memory 上下文
   *
   * OpenClaw 中由 buildMemoryPromptSection()（src/plugins/memory-state.ts）负责，
   * 会根据配置选择性注入 MEMORY.md 的内容。
   */
  getContextForPrompt(): string | null {
    const parts: string[] = [];

    // 读取根 MEMORY.md
    const rootMemory = this.readRootMemory();
    if (rootMemory) {
      parts.push('### Long-term Memory (MEMORY.md)', '', rootMemory);
    }

    // 读取今日日志
    const todayLog = this.readDailyLog(this.todayDateString());
    if (todayLog) {
      parts.push('### Today\'s Log', '', todayLog);
    }

    return parts.length > 0 ? parts.join('\n') : null;
  }

  /** 读取根 MEMORY.md */
  readRootMemory(): string | null {
    // 优先读取工作目录下的 MEMORY.md（与 OpenClaw 行为一致）
    const workspacePath = path.join(this.workspaceDir, MEMORY_FILENAME);
    const memoryPath = path.join(this.memoryDir, MEMORY_FILENAME);

    for (const p of [workspacePath, memoryPath]) {
      try {
        return fs.readFileSync(p, 'utf-8').trim();
      } catch {
        // 继续尝试下一个路径
      }
    }
    return null;
  }

  /** 写入根 MEMORY.md */
  writeRootMemory(content: string): void {
    const filePath = path.join(this.memoryDir, MEMORY_FILENAME);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /** 追加一条到今日日志 */
  appendDailyLog(entry: string): void {
    const dateStr = this.todayDateString();
    const logPath = this.dailyLogPath(dateStr);
    const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
    const line = `- [${timestamp}] ${entry}\n`;
    fs.appendFileSync(logPath, line, 'utf-8');
  }

  /** 读取指定日期的日志 */
  readDailyLog(dateStr: string): string | null {
    const logPath = this.dailyLogPath(dateStr);
    try {
      const content = fs.readFileSync(logPath, 'utf-8').trim();
      return content || null;
    } catch {
      return null;
    }
  }

  /** 列出所有日志日期 */
  listDailyLogs(): string[] {
    const logsDir = path.join(this.memoryDir, DAILY_LOG_DIR);
    try {
      return fs
        .readdirSync(logsDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace('.md', ''))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  // ---- 内部方法 ----

  private dailyLogPath(dateStr: string): string {
    return path.join(this.memoryDir, DAILY_LOG_DIR, `${dateStr}.md`);
  }

  private todayDateString(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }
}
