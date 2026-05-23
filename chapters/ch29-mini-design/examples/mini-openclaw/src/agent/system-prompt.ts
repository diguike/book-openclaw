/**
 * System Prompt 组装
 *
 * OpenClaw 的 System Prompt 构建非常复杂（src/agents/system-prompt.ts，800+ 行），
 * 包含 bootstrap 文件加载、prompt cache boundary、provider 差异化适配等。
 * 这里只保留核心逻辑：身份 + 引导文件 + 运行时信息 + 工具说明。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, MiniOpenClawConfig } from '../types.js';
import type { MemoryManager } from '../memory/manager.js';
import type { SkillsLoader } from '../memory/skills.js';

/** 尝试读取文件，不存在则返回 null */
function tryReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 构建 System Prompt
 *
 * 组装顺序（参考 OpenClaw 的 CONTEXT_FILE_ORDER）：
 * 1. 身份与角色
 * 2. SOUL.md（Agent 人设）
 * 3. TOOLS.md（工具使用指南）
 * 4. Memory 上下文
 * 5. Skills 索引
 * 6. 运行时信息
 * 7. 可用工具列表
 */
export function buildSystemPrompt(params: {
  config: MiniOpenClawConfig;
  tools: ToolDefinition[];
  memoryManager: MemoryManager;
  skillsLoader: SkillsLoader;
}): string {
  const { config, tools, memoryManager, skillsLoader } = params;
  const sections: string[] = [];

  // ---- 1. 身份 ----
  sections.push(
    'You are an AI assistant powered by Mini OpenClaw.',
    'You can read files, execute commands, and help users with various tasks.',
    '',
  );

  // ---- 2. SOUL.md ----
  const soulPath = path.join(config.workspaceDir, '.openclaw', 'SOUL.md');
  const soulContent = tryReadFile(soulPath);
  if (soulContent) {
    sections.push('## Identity & Personality', '', soulContent.trim(), '');
  }

  // ---- 3. TOOLS.md ----
  const toolsDocPath = path.join(config.workspaceDir, '.openclaw', 'TOOLS.md');
  const toolsDoc = tryReadFile(toolsDocPath);
  if (toolsDoc) {
    sections.push('## Tool Usage Guidelines', '', toolsDoc.trim(), '');
  }

  // ---- 4. Memory 上下文 ----
  const memoryContext = memoryManager.getContextForPrompt();
  if (memoryContext) {
    sections.push('## Memory', '', memoryContext, '');
  }

  // ---- 5. Skills 索引 ----
  const skillsContext = skillsLoader.getSkillsIndexForPrompt();
  if (skillsContext) {
    sections.push(skillsContext, '');
  }

  // ---- 6. 运行时信息 ----
  const now = new Date();
  sections.push(
    '## Runtime Information',
    '',
    `- Current time: ${now.toISOString()}`,
    `- Working directory: ${config.workspaceDir}`,
    `- Platform: ${process.platform}`,
    `- Node.js: ${process.version}`,
    '',
  );

  // ---- 7. 可用工具 ----
  if (tools.length > 0) {
    sections.push('## Available Tools', '');
    for (const tool of tools) {
      sections.push(`- **${tool.name}**: ${tool.description}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}
