/**
 * Mini OpenClaw - 入口文件
 *
 * 启动流程：
 * 1. 加载配置
 * 2. 初始化 SessionStore
 * 3. 初始化 Memory 和 Skills
 * 4. 初始化 AgentRuntime，注册工具
 * 5. 启动 Gateway WebSocket 服务
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { SessionStore } from './gateway/session-store.js';
import { GatewayServer } from './gateway/server.js';
import { AgentRuntime } from './agent/runtime.js';
import { MemoryManager } from './memory/manager.js';
import { SkillsLoader } from './memory/skills.js';
import { createBuiltinTools } from './tools/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  console.log('========================================');
  console.log('  Mini OpenClaw v0.1.0');
  console.log('========================================');
  console.log();

  // 1. 加载配置
  const config = loadConfig();

  if (!config.anthropicApiKey) {
    console.error('[错误] 缺少 ANTHROPIC_API_KEY 环境变量');
    console.error('请设置: export ANTHROPIC_API_KEY=your-key-here');
    process.exit(1);
  }

  console.log(`[Config] 工作目录: ${config.workspaceDir}`);
  console.log(`[Config] 模型: ${config.model}`);
  console.log(`[Config] 端口: ${config.port}`);
  console.log();

  // 2. 初始化 SessionStore
  const sessionStore = new SessionStore(config.sessionsDir);
  console.log(`[Session] 存储目录: ${config.sessionsDir}`);

  // 3. 初始化 Memory 和 Skills
  const memoryManager = new MemoryManager(config.memoryDir, config.workspaceDir);
  console.log(`[Memory] 目录: ${config.memoryDir}`);

  const skillsLoader = new SkillsLoader(config.skillsDir);
  console.log(`[Skills] 目录: ${config.skillsDir}`);
  console.log();

  // 4. 初始化 AgentRuntime
  const agentRuntime = new AgentRuntime({
    config,
    sessionStore,
    memoryManager,
    skillsLoader,
  });

  // 注册内置工具
  const tools = createBuiltinTools(config.workspaceDir);
  for (const tool of tools) {
    agentRuntime.registerTool(tool);
  }
  console.log();

  // 5. 启动 Gateway
  const gateway = new GatewayServer(config, sessionStore, agentRuntime);
  gateway.start();

  // 提示 WebChat 地址
  const chatHtmlPath = path.join(__dirname, 'channel', 'webchat.html');
  console.log();
  console.log(`[WebChat] 在浏览器中打开: file://${chatHtmlPath}`);
  console.log(`[WebChat] 或使用任何 WebSocket 客户端连接 ws://localhost:${config.port}`);
  console.log();

  // 优雅退出
  process.on('SIGINT', () => {
    console.log('\n正在关闭...');
    gateway.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    gateway.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
