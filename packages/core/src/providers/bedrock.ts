import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type Anthropic from '@anthropic-ai/sdk';

import type { MessageParam } from '../types/index.js';
import {
  toMessages,
  type CompletionOptions,
  type CompletionResponse,
  type ProviderAdapter,
} from './base.js';
import { withRetry, type RetryOptions } from './utils.js';
import type { AnthropicLike } from './anthropic.js';

export interface BedrockAnthropicProviderConfig {
  /** Bedrock model id, e.g. `anthropic.claude-sonnet-4-5-20260101-v1:0`. Takes precedence over `model`. */
  modelId?: string;
  /** Alias kept for symmetry with other providers; mapped to `modelId` internally. */
  model?: string;
  /** AWS region, e.g. `us-east-1`. Falls back to `AWS_REGION`. */
  region?: string;
  /**
   * Inline credentials. Omit in production in favour of the AWS credential
   * chain (env vars, IAM role, `~/.aws/credentials`).
   */
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsSessionToken?: string;
  defaultMaxTokens?: number;
  retry?: RetryOptions;
  /** Inject a client (e.g. for unit tests) instead of constructing one. */
  client?: AnthropicLike;
}

export class BedrockAnthropicProvider implements ProviderAdapter {
  readonly name: string;
  private readonly modelId: string;
  private readonly client: AnthropicLike;
  private readonly config: BedrockAnthropicProviderConfig;

  constructor(config: BedrockAnthropicProviderConfig) {
    const modelId = config.modelId ?? config.model;
    if (!modelId) {
      throw new Error(
        'BedrockAnthropicProvider: `modelId` (or `model`) is required.',
      );
    }
    this.modelId = modelId;
    this.config = config;
    this.name = `bedrock/${modelId}`;

    if (config.client) {
      this.client = config.client;
    } else {
      this.client = new AnthropicBedrock({
        awsRegion: config.region ?? process.env.AWS_REGION,
        awsAccessKey: config.awsAccessKey,
        awsSecretKey: config.awsSecretKey,
        awsSessionToken: config.awsSessionToken,
      }) as unknown as AnthropicLike;
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
          model: this.modelId,
          max_tokens: options.maxTokens ?? this.config.defaultMaxTokens ?? 1024,
          temperature: options.temperature ?? 0,
          system,
          messages: toBedrockMessages(input),
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
      model: response.model ?? this.modelId,
      latencyMs: Date.now() - start,
    };
  }
}

function toBedrockMessages(
  input: string | MessageParam[],
): Anthropic.MessageParam[] {
  return toMessages(input).map((m) => ({
    role: m.role,
    content: m.content,
  }));
}
