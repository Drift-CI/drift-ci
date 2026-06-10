import type {
  CompletionOptions,
  CompletionResponse,
  MessageParam,
  ProviderAdapter,
} from './base.js';
import { toMessages } from './base.js';

export type MockResponder = (
  input: string | MessageParam[],
  systemPrompt: string | undefined,
  options: CompletionOptions,
) => string | Promise<string> | Error;

export interface MockProviderOptions {
  name?: string;
  responses?: Record<string, string>;
  defaultResponse?: string;
  responder?: MockResponder;
  latencyMs?: number;
}

export class MockProvider implements ProviderAdapter {
  name: string;
  private responses: Record<string, string>;
  private defaultResponse: string;
  private responder?: MockResponder;
  private latencyMs: number;

  constructor(options: MockProviderOptions = {}) {
    this.name = options.name ?? 'mock/test-model';
    this.responses = options.responses ?? {};
    this.defaultResponse = options.defaultResponse ?? 'Mock response';
    this.responder = options.responder;
    this.latencyMs = options.latencyMs ?? 0;
  }

  async complete(
    input: string | MessageParam[],
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    if (this.responder) {
      const result = await this.responder(input, systemPrompt, options);
      if (result instanceof Error) throw result;
      return this.wrap(result);
    }

    const messages = toMessages(input);
    const key =
      typeof input === 'string' ? input : JSON.stringify(messages);
    const text = this.responses[key] ?? this.defaultResponse;
    return this.wrap(text);
  }

  private wrap(text: string): CompletionResponse {
    return {
      text,
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      model: this.name,
      latencyMs: this.latencyMs,
    };
  }
}
