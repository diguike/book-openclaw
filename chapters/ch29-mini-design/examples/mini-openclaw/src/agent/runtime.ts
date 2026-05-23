/**
 * Agent Runtime - 核心运行循环
 *
 * OpenClaw 的 Agent 循环由 pi-coding-agent 驱动，核心在
 * src/agents/pi-embedded-runner/run/attempt.ts，实现了完整的
 * prompt → model → tool → response 循环。
 * 这里直接使用 Anthropic SDK 的原生 tool_use 能力实现同样的循环。
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MiniOpenClawConfig,
  ToolDefinition,
  ToolCallRecord,
  Message,
} from '../types.js';
import { SessionStore } from '../gateway/session-store.js';
import { buildSystemPrompt } from './system-prompt.js';
import type { MemoryManager } from '../memory/manager.js';
import type { SkillsLoader } from '../memory/skills.js';

/** Agent 运行时的回调 */
export type AgentCallbacks = {
  /** 流式文本块 */
  onChunk: (chunk: string) => void;
  /** 工具开始执行 */
  onToolStart: (toolName: string) => void;
  /** 工具执行完成 */
  onToolDone: (toolName: string, output: string) => void;
};

/** Agent 单次运行的输入 */
export type AgentRunInput = {
  sessionId: string;
  userMessage: string;
} & AgentCallbacks;

/** Agent 单次运行的结果 */
export type AgentRunResult = {
  content: string;
  toolCalls: ToolCallRecord[];
};

/** 最大工具调用轮次，防止无限循环 */
const MAX_TOOL_ROUNDS = 10;

export class AgentRuntime {
  private client: Anthropic;
  private config: MiniOpenClawConfig;
  private sessionStore: SessionStore;
  private tools: Map<string, ToolDefinition> = new Map();
  private memoryManager: MemoryManager;
  private skillsLoader: SkillsLoader;

  constructor(params: {
    config: MiniOpenClawConfig;
    sessionStore: SessionStore;
    memoryManager: MemoryManager;
    skillsLoader: SkillsLoader;
  }) {
    this.config = params.config;
    this.sessionStore = params.sessionStore;
    this.memoryManager = params.memoryManager;
    this.skillsLoader = params.skillsLoader;
    this.client = new Anthropic({
      apiKey: this.config.anthropicApiKey,
    });
  }

  /** 注册工具 */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    console.log(`[Agent] 已注册工具: ${tool.name}`);
  }

  /** 获取所有已注册的工具定义 */
  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 执行一次完整的 Agent 运行
   *
   * 核心循环：
   * 1. 加载会话历史
   * 2. 组装 system prompt
   * 3. 调用模型（流式）
   * 4. 如果模型返回 tool_use，执行工具并将结果送回模型
   * 5. 重复 3-4 直到模型返回纯文本或达到轮次上限
   */
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const { sessionId, userMessage, onChunk, onToolStart, onToolDone } = input;

    // 1. 加载历史消息，截取最近 N 条
    const history = this.sessionStore.loadMessages(sessionId);
    const recentHistory = history.slice(-this.config.maxContextMessages);

    // 2. 组装 system prompt
    const systemPrompt = buildSystemPrompt({
      config: this.config,
      tools: this.getTools(),
      memoryManager: this.memoryManager,
      skillsLoader: this.skillsLoader,
    });

    // 3. 构建消息序列（Anthropic API 格式）
    const messages = this.buildAnthropicMessages(recentHistory, userMessage);

    // 4. 构建工具定义（Anthropic API 格式）
    const toolDefs = this.buildAnthropicTools();

    // 5. 进入 Agent 循环
    const allToolCalls: ToolCallRecord[] = [];
    let finalContent = '';
    let currentMessages = messages;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // 调用模型（流式）
      const response = await this.callModel({
        systemPrompt,
        messages: currentMessages,
        tools: toolDefs,
        onChunk,
      });

      // 检查是否有工具调用
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );

      // 收集本轮文本
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text',
      );
      const roundText = textBlocks.map((b) => b.text).join('');

      if (toolUseBlocks.length === 0) {
        // 没有工具调用，循环结束
        finalContent = roundText;
        break;
      }

      // 执行工具调用
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        onToolStart(toolUse.name);

        const tool = this.tools.get(toolUse.name);
        let output: string;

        if (!tool) {
          output = `错误: 未知工具 "${toolUse.name}"`;
        } else {
          try {
            const result = await tool.execute(
              toolUse.input as Record<string, unknown>,
            );
            output = result.success
              ? result.output
              : `错误: ${result.error || '工具执行失败'}`;
          } catch (err) {
            output = `错误: ${err instanceof Error ? err.message : '未知错误'}`;
          }
        }

        onToolDone(toolUse.name, output);

        allToolCalls.push({
          toolName: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          output,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: output,
        });
      }

      // 将助手消息和工具结果追加到消息序列，继续循环
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: response.content },
        { role: 'user' as const, content: toolResults },
      ];

      // 如果是最后一轮，记录文本
      if (round === MAX_TOOL_ROUNDS - 1) {
        finalContent = roundText || '（已达到最大工具调用轮次）';
      }
    }

    return {
      content: finalContent,
      toolCalls: allToolCalls,
    };
  }

  /** 调用 Anthropic API（流式） */
  private async callModel(params: {
    systemPrompt: string;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
    onChunk: (chunk: string) => void;
  }): Promise<Anthropic.Message> {
    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: 4096,
      system: params.systemPrompt,
      messages: params.messages,
      tools: params.tools.length > 0 ? params.tools : undefined,
    });

    // 监听流式文本事件
    stream.on('text', (text) => {
      params.onChunk(text);
    });

    // 等待完整响应
    const response = await stream.finalMessage();
    return response;
  }

  /** 将内部消息格式转换为 Anthropic API 格式 */
  private buildAnthropicMessages(
    history: Message[],
    userMessage: string,
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    for (const msg of history) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        messages.push({ role: 'assistant', content: msg.content });
      }
      // 跳过 system 消息（已在 system prompt 中处理）
    }

    // 追加当前用户消息
    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  /** 将内部工具定义转换为 Anthropic API 格式 */
  private buildAnthropicTools(): Anthropic.Tool[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, param]) => [
            key,
            { type: param.type, description: param.description },
          ]),
        ),
        required: Object.entries(tool.parameters)
          .filter(([, param]) => param.required !== false)
          .map(([key]) => key),
      },
    }));
  }
}
