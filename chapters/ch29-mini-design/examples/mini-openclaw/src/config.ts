/**
 * 配置加载
 *
 * OpenClaw 使用 Zod schemas 做复杂的配置校验（src/config/），
 * 这里简化为从环境变量读取 + 默认值。
 */

import path from 'node:path';
import type { MiniOpenClawConfig } from './types.js';

/** 从环境变量和默认值构建配置 */
export function loadConfig(): MiniOpenClawConfig {
  const workspaceDir = process.env.MINI_OPENCLAW_WORKSPACE
    || process.cwd();

  const dataDir = process.env.MINI_OPENCLAW_DATA_DIR
    || path.join(workspaceDir, '.mini-openclaw');

  return {
    port: parseInt(process.env.MINI_OPENCLAW_PORT || '3210', 10),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.MINI_OPENCLAW_MODEL || 'claude-sonnet-4-20250514',
    workspaceDir,
    sessionsDir: path.join(dataDir, 'sessions'),
    memoryDir: path.join(dataDir, 'memory'),
    skillsDir: path.join(workspaceDir, '.openclaw', 'skills'),
    maxContextMessages: parseInt(
      process.env.MINI_OPENCLAW_MAX_CONTEXT || '50',
      10,
    ),
  };
}
