/**
 * api.ts — 公开 SDK 类型的 re-export
 *
 * 第三方插件通过 openclaw/plugin-sdk/core 获取所有需要的类型。
 * 这个文件作为统一的导入入口，方便插件内部的其他模块使用。
 *
 * 注意：在独立开发时（非 OpenClaw 仓库内），
 * 你需要安装 openclaw npm 包来获取这些类型。
 * 在开发模式下（放入 extensions/ 目录），使用 workspace:* 引用。
 */

// 生产环境：从 openclaw/plugin-sdk/core 导入
// export {
//   definePluginEntry,
//   type OpenClawPluginApi,
//   type PluginLogger,
//   type PluginRuntime,
// } from 'openclaw/plugin-sdk/core';

// 开发/示例环境：使用本地类型定义
export interface PluginLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface OpenClawPluginApi {
  config: Record<string, unknown>;
  pluginConfig: unknown;
  logger: PluginLogger;
  registrationMode: 'full' | 'discovery' | 'cli-metadata';
  registerChannel: (params: { plugin: unknown }) => void;
  registerHttpRoute: (params: {
    path: string;
    auth: 'plugin' | 'none';
    match: 'exact' | 'prefix';
    handler: (req: unknown, res: unknown) => Promise<boolean>;
    replaceExisting?: boolean;
  }) => void;
  runtime: {
    tasks: {
      managedFlows: {
        bindSession: (params: { sessionKey: string }) => unknown;
      };
    };
  };
}

export interface OpenClawPluginDefinition {
  id: string;
  name: string;
  description: string;
  register: (api: OpenClawPluginApi) => void;
}

/**
 * definePluginEntry — 定义插件入口
 *
 * 在 OpenClaw 仓库外开发时，使用 openclaw/plugin-sdk/core 中的版本：
 *   import { definePluginEntry } from 'openclaw/plugin-sdk/core';
 */
export function definePluginEntry(definition: OpenClawPluginDefinition): OpenClawPluginDefinition {
  return definition;
}
