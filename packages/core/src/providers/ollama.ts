import type { MessageParam } from '../types/index.js';
import {
  toMessages,
  type CompletionOptions,
  type CompletionResponse,
  type ProviderAdapter,
} from './base.js';
import { withRetry, type RetryOptions } from './utils.js';

export interface OllamaProviderConfig {
  model: string;
  baseURL?: string;
  apiKey?: string;
  defaultMaxTokens?: number;
  retry?: RetryOptions;
  fetch?: typeof fetch;
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
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
    this.baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'OllamaProvider: global fetch is not available; pass config.fetch (Node 18+ has native fetch).',
      );
    }
  }

  async complete(
    input: string | MessageParam[],
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    const start = Date.now();

    const messages: OllamaChatMessage[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    for (const m of toMessages(input)) {
      messages.push({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    }

    const body = {
      model: this.config.model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0,
        num_predict:
          options.maxTokens ?? this.config.defaultMaxTokens ?? 1024,
      },
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
    };
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
