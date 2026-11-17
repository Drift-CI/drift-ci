import {
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
import { stripTrailingSlashes } from '../util/url.js';

export interface OllamaProviderConfig {
  model: string;
  baseURL?: string;
  apiKey?: string;
  defaultMaxTokens?: number;
  retry?: RetryOptions;
  fetch?: typeof fetch;
}

type OllamaChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
    }
  | { role: 'tool'; content: string; tool_name: string };

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string; tool_calls?: OllamaToolCall[] };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Ollama sends arguments as an object; tolerate a JSON string too. */
interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaProvider implements ProviderAdapter {
  name: string;
  private readonly config: OllamaProviderConfig;
  private readonly baseURL: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OllamaProviderConfig) {
    this.config = config;
    this.name = `ollama/${config.model}`;
    this.baseURL = stripTrailingSlashes(config.baseURL ?? DEFAULT_BASE_URL);
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'OllamaProvider: global fetch is not available; pass config.fetch (Node 18+ has native fetch).',
      );
    }
  }

  async complete(
    input: CompletionInput,
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    const start = Date.now();
    const tools = options.tools?.length ? options.tools : undefined;

    const messages: OllamaChatMessage[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push(...toOllamaMessages(input));

    const body = {
      model: this.config.model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0,
        num_predict:
          options.maxTokens ?? this.config.defaultMaxTokens ?? 1024,
      },
      ...(tools ? { tools: toOllamaTools(tools) } : {}),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    };
    const apiKey = this.config.apiKey ?? process.env.OLLAMA_API_KEY;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const url = `${this.baseURL}/api/chat`;

    const response = await withRetry(async () => {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await safeReadText(res);
        const err = new Error(
          `Ollama request failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`,
        ) as Error & { status: number };
        err.status = res.status;
        throw err;
      }
      return (await res.json()) as OllamaChatResponse;
    }, this.config.retry);

    const inputTokens = response.prompt_eval_count ?? 0;
    const outputTokens = response.eval_count ?? 0;

    return {
      text: response.message?.content ?? '',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      model: response.model ?? this.config.model,
      latencyMs: Date.now() - start,
      ...(tools ? { toolCalls: withCallIds(readOllamaToolCalls(response.message?.tool_calls), input) } : {}),
    };
  }
}

/**
 * Plain input becomes `{ role, content }` messages, as always. A tool conversation maps an
 * assistant turn's calls to `tool_calls` and a tool turn to one `role: 'tool'` message per result,
 * named by `tool_name` (Ollama has no call ids).
 */
function toOllamaMessages(input: CompletionInput): OllamaChatMessage[] {
  if (!isConversation(input)) {
    return toMessages(input).map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }
  return input.flatMap((turn): OllamaChatMessage[] => {
    if (turn.role === 'user') return [{ role: 'user', content: turn.content }];
    if (turn.role === 'assistant') {
      if (!turn.toolCalls?.length) return [{ role: 'assistant', content: turn.content }];
      return [
        {
          role: 'assistant',
          content: turn.content,
          tool_calls: turn.toolCalls.map((c) => ({
            function: { name: c.name, arguments: c.arguments },
          })),
        },
      ];
    }
    return turn.results.map((r) => ({ role: 'tool' as const, content: r.content, tool_name: r.name }));
  });
}

function toOllamaTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      parameters: t.parameters,
    },
  }));
}

function readOllamaToolCalls(calls: OllamaToolCall[] | undefined): ToolCall[] {
  return (calls ?? []).map((c) => {
    const args = c.function?.arguments;
    return {
      name: c.function?.name ?? '',
      arguments:
        args === undefined || args === null
          ? {}
          : typeof args === 'string'
            ? parseArgs(args)
            : typeof args === 'object' && !Array.isArray(args)
              ? args
              : { __unparsed: JSON.stringify(args) },
    };
  });
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
