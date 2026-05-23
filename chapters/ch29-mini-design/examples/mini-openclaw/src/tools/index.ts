/**
 * 工具注册中心
 *
 * OpenClaw 的工具目录（src/agents/tool-catalog.ts）定义了数十个工具，
 * 按 section 分组（Files, Runtime, Web, Memory 等）。
 * 这里只注册三个核心工具：bash、read_file、write_file。
 */

import type { ToolDefinition } from '../types.js';
import { createBashTool } from './bash.js';
import { createReadFileTool } from './read-file.js';
import { createWriteFileTool } from './write-file.js';

/** 创建所有内置工具 */
export function createBuiltinTools(workspaceDir: string): ToolDefinition[] {
  return [
    createBashTool(workspaceDir),
    createReadFileTool(workspaceDir),
    createWriteFileTool(workspaceDir),
  ];
}
