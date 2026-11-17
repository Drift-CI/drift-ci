import OpenAI from 'openai';

import {
  callIdAt,
  isConversation,
  toMessages,
  withCallIds,
  type CompletionInput,
  type CompletionOptions,
  type CompletionResponse,
  type ProviderAdapter,
  type ToolCall,
  type ToolDefinition,
} from './base.js';
import { parseArgs, withRetry, type RetryOptions } from './utils.js';

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
    input: CompletionInput,
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    const start = Date.now();
    const tools = options.tools?.length ? options.tools : undefined;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push(...toOpenAIMessages(input));

    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.config.model,
          max_tokens: options.maxTokens ?? this.config.defaultMaxTokens ?? 1024,
          temperature: options.temperature ?? 0,
          messages,
          ...(tools ? { tools: toOpenAITools(tools) } : {}),
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
      ...(tools ? { toolCalls: withCallIds(readOpenAIToolCalls(choice?.message?.tool_calls), input) } : {}),
    };
  }
}

/**
 * Plain input becomes `{ role, content }` messages, as always. A tool conversation maps an
 * assistant turn's calls to `tool_calls` (JSON-string arguments; `content: null` without text)
 * and a tool turn to one `role: 'tool'` message per result.
 */
function toOpenAIMessages(
  input: CompletionInput,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (!isConversation(input)) {
    return toMessages(input).map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }
  let ordinal = 0;
  return input.flatMap((turn): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => {
    if (turn.role === 'user') return [{ role: 'user', content: turn.content }];
    if (turn.role === 'assistant') {
      if (!turn.toolCalls?.length) return [{ role: 'assistant', content: turn.content }];
      return [
        {
          role: 'assistant',
          content: turn.content || null,
          tool_calls: turn.toolCalls.map((c) => ({
            id: callIdAt(c, ++ordinal),
            type: 'function' as const,
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        },
      ];
    }
    return turn.results.map((r) => ({
      role: 'tool' as const,
      tool_call_id: r.callId,
      content: r.content,
    }));
  });
}

function toOpenAITools(
  tools: ToolDefinition[],
): OpenAI.Chat.Completions.ChatCompletionFunctionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      parameters: t.parameters,
    },
  }));
}

function readOpenAIToolCalls(
  calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
): ToolCall[] {
  return (calls ?? [])
    .filter(
      (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
        c.type === 'function',
    )
    .map((c) => ({
      // OpenAI always sends an id; an OpenAI-compatible server might not, so withCallIds fills it.
      ...(c.id ? { id: c.id } : {}),
      name: c.function.name,
      arguments: parseArgs(c.function.arguments),
    }));
}
