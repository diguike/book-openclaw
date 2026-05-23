/**
 * 文件读取工具
 *
 * OpenClaw 的 read 工具（src/agents/tools/read/）支持行号范围、
 * 图片读取、PDF 解析、Jupyter Notebook 等。
 * 这里只保留文本文件读取，支持行号范围参数。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../types.js';

/** 单次读取的最大行数 */
const MAX_LINES = 2000;

/** 最大文件大小（字节） */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function createReadFileTool(workspaceDir: string): ToolDefinition {
  return {
    name: 'read_file',
    description:
      'Read the contents of a file. Returns the file content with line numbers. ' +
      'Use absolute paths or paths relative to the workspace directory.',
    parameters: {
      file_path: {
        type: 'string',
        description: 'Path to the file to read (absolute or relative to workspace)',
        required: true,
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-based, default: 1)',
        required: false,
      },
      limit: {
        type: 'number',
        description: `Maximum number of lines to read (default: ${MAX_LINES})`,
        required: false,
      },
    },
    execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
      const filePath = params.file_path as string;
      const offset = (params.offset as number) || 1;
      const limit = (params.limit as number) || MAX_LINES;

      if (!filePath) {
        return {
          success: false,
          output: '',
          error: '缺少 file_path 参数',
        };
      }

      // 解析路径：支持绝对路径和相对路径
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workspaceDir, filePath);

      // 检查文件是否存在
      if (!fs.existsSync(resolvedPath)) {
        return {
          success: false,
          output: '',
          error: `文件不存在: ${resolvedPath}`,
        };
      }

      // 检查是否为文件
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return {
          success: false,
          output: '',
          error: `不是文件: ${resolvedPath}`,
        };
      }

      // 检查文件大小
      if (stat.size > MAX_FILE_SIZE) {
        return {
          success: false,
          output: '',
          error: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，上限 5MB`,
        };
      }

      try {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        const lines = content.split('\n');

        // 应用行号范围（offset 是 1-based）
        const startIdx = Math.max(0, offset - 1);
        const endIdx = Math.min(lines.length, startIdx + limit);
        const selectedLines = lines.slice(startIdx, endIdx);

        // 添加行号（模仿 cat -n 格式）
        const numberedLines = selectedLines.map(
          (line, i) => `${String(startIdx + i + 1).padStart(6, ' ')}  ${line}`,
        );

        let output = numberedLines.join('\n');

        // 如果有截断，添加提示
        if (endIdx < lines.length) {
          output += `\n\n(显示第 ${startIdx + 1}-${endIdx} 行，共 ${lines.length} 行)`;
        }

        return {
          success: true,
          output,
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `读取文件失败: ${err instanceof Error ? err.message : '未知错误'}`,
        };
      }
    },
  };
}
