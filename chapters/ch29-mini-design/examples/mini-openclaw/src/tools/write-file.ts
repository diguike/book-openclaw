/**
 * 文件写入工具
 *
 * 支持创建和覆盖文件，自动创建父目录。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../types.js';

export function createWriteFileTool(workspaceDir: string): ToolDefinition {
  return {
    name: 'write_file',
    description:
      'Write content to a file. Creates the file if it does not exist, ' +
      'or overwrites it if it does. Parent directories are created automatically.',
    parameters: {
      file_path: {
        type: 'string',
        description: 'Path to the file to write (absolute or relative to workspace)',
        required: true,
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
        required: true,
      },
    },
    execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
      const filePath = params.file_path as string;
      const content = params.content as string;

      if (!filePath) {
        return { success: false, output: '', error: '缺少 file_path 参数' };
      }
      if (content === undefined || content === null) {
        return { success: false, output: '', error: '缺少 content 参数' };
      }

      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workspaceDir, filePath);

      try {
        // 确保父目录存在
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, content, 'utf-8');

        return {
          success: true,
          output: `文件已写入: ${resolvedPath} (${content.length} 字符)`,
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `写入文件失败: ${err instanceof Error ? err.message : '未知错误'}`,
        };
      }
    },
  };
}
