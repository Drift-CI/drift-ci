import Anthropic from '@anthropic-ai/sdk';

import type { MessageParam } from '../types/index.js';
import {
  toMessages,
  type CompletionOptions,
  type CompletionResponse,
  type ProviderAdapter,
} from './base.js';
import { withRetry, type RetryOptions } from './utils.js';

export interface AnthropicProviderConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
  defaultMaxTokens?: number;
  retry?: RetryOptions;
  client?: AnthropicLike;
}

export interface AnthropicLike {
  messages: {
    create: (args: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  };
}

export class AnthropicProvider implements ProviderAdapter {
  name: string;
  private client: AnthropicLike;
  private config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    this.config = config;
    this.name = `anthropic/${config.model}`;
    if (config.client) {
      this.client = config.client;
    } else {
      const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'AnthropicProvider: ANTHROPIC_API_KEY env var (or config.apiKey) is required.',
        );
      }
      this.client = new Anthropic({ apiKey, baseURL: config.baseURL });
    }
  }

  async complete(
    input: string | MessageParam[],
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    const start = Date.now();

    const system = systemPrompt
      ? [
          {
            type: 'text' as const,
            text: systemPrompt,
            ...(options.cacheSystemPrompt
              ? { cache_control: { type: 'ephemeral' as const } }
              : {}),
          },
        ]
      : undefined;

    const response = await withRetry(
      () =>
        this.client.messages.create({
          model: this.config.model,
          max_tokens: options.maxTokens ?? this.config.defaultMaxTokens ?? 1024,
          temperature: options.temperature ?? 0,
          system,
          messages: toAnthropicMessages(input),
        }),
      this.config.retry,
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const cachedInputTokens = (response.usage as { cache_read_input_tokens?: number })
      .cache_read_input_tokens;

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        ...(typeof cachedInputTokens === 'number' ? { cachedInputTokens } : {}),
      },
      model: response.model,
      latencyMs: Date.now() - start,
    };
  }
}

function toAnthropicMessages(
  input: string | MessageParam[],
): Anthropic.MessageParam[] {
  return toMessages(input).map((m) => ({
    role: m.role,
    content: m.content,
  }));
}
