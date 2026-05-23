/**
 * Bash 工具 - 执行 Shell 命令
 *
 * OpenClaw 的 Bash 工具（src/agents/tools/bash/）非常复杂，
 * 包含进程注册、超时控制、输出截断、安全审计等。
 * 这里只保留核心：在子进程中执行命令并返回输出。
 */

import { exec } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../types.js';

/** 命令执行超时（毫秒） */
const TIMEOUT_MS = 30_000;

/** 输出最大字符数 */
const MAX_OUTPUT_CHARS = 10_000;

export function createBashTool(workspaceDir: string): ToolDefinition {
  return {
    name: 'bash',
    description:
      'Execute a bash command in the workspace directory. ' +
      'Use this for running scripts, installing packages, checking file status, etc.',
    parameters: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
        required: true,
      },
    },
    execute: async (params: Record<string, unknown>): Promise<ToolResult> => {
      const command = params.command as string;

      if (!command || typeof command !== 'string') {
        return {
          success: false,
          output: '',
          error: '缺少 command 参数',
        };
      }

      return new Promise((resolve) => {
        exec(
          command,
          {
            cwd: workspaceDir,
            timeout: TIMEOUT_MS,
            maxBuffer: 1024 * 1024, // 1MB
            shell: '/bin/bash',
          },
          (error, stdout, stderr) => {
            let output = '';

            if (stdout) {
              output += stdout;
            }
            if (stderr) {
              output += (output ? '\n' : '') + `STDERR: ${stderr}`;
            }

            // 截断过长的输出
            if (output.length > MAX_OUTPUT_CHARS) {
              output =
                output.slice(0, MAX_OUTPUT_CHARS) +
                `\n... (输出已截断，共 ${output.length} 字符)`;
            }

            if (error) {
              resolve({
                success: false,
                output,
                error: error.message,
              });
            } else {
              resolve({
                success: true,
                output: output || '（命令执行成功，无输出）',
              });
            }
          },
        );
      });
    },
  };
}
