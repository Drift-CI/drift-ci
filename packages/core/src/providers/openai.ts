import OpenAI from 'openai';

import type { MessageParam } from '../types/index.js';
import {
  toMessages,
  type CompletionOptions,
  type CompletionResponse,
  type ProviderAdapter,
} from './base.js';
import { withRetry, type RetryOptions } from './utils.js';

export interface OpenAIProviderConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
  defaultMaxTokens?: number;
  retry?: RetryOptions;
  /**
   * Inject an alternate client (e.g. the official SDK's Azure flavour or
   * a minimal fake for unit tests). The shape we need is narrow — only
   * `chat.completions.create` — so anything matching it works.
   */
  client?: OpenAILike;
  /**
   * Label rendered by the runner and baselines. Defaults to
   * `openai/<model>`; Azure sets its own prefix.
   */
  nameOverride?: string;
}

export interface OpenAILike {
  chat: {
    completions: {
      create: (
        args: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      ) => Promise<OpenAI.Chat.Completions.ChatCompletion>;
    };
  };
}

export class OpenAIProvider implements ProviderAdapter {
  readonly name: string;
  protected readonly config: OpenAIProviderConfig;
  protected readonly client: OpenAILike;

  constructor(config: OpenAIProviderConfig) {
    this.config = config;
    this.name = config.nameOverride ?? `openai/${config.model}`;
    if (config.client) {
      this.client = config.client;
    } else {
      const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OpenAIProvider: OPENAI_API_KEY env var (or config.apiKey) is required.',
        );
      }
      this.client = new OpenAI({ apiKey, baseURL: config.baseURL });
    }
  }

  async complete(
    input: string | MessageParam[],
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    const start = Date.now();

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    for (const m of toMessages(input)) {
      messages.push({
        role: m.role,
        content:
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    }

    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.config.model,
          max_tokens: options.maxTokens ?? this.config.defaultMaxTokens ?? 1024,
          temperature: options.temperature ?? 0,
          messages,
        }),
      this.config.retry,
    );

    const choice = response.choices[0];
    const text =
      typeof choice?.message?.content === 'string' ? choice.message.content : '';

    const usage = response.usage;
    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    // OpenAI surfaces server-side prompt caching via
    // usage.prompt_tokens_details.cached_tokens (gpt-4o+ and newer). We
    // normalise it into our CachedInputTokens field so dashboards can
    // show cache-hit ratios uniformly across providers.
    const cachedInputTokens =
      (usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)
        ?.prompt_tokens_details?.cached_tokens;

    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        ...(typeof cachedInputTokens === 'number' ? { cachedInputTokens } : {}),
      },
      model: response.model ?? this.config.model,
      latencyMs: Date.now() - start,
    };
  }
}
