import type {
  CompletionInput,
  CompletionOptions,
  CompletionResponse,
  ProviderAdapter,
  ToolCall,
} from './base.js';
import { isConversation, toMessages, withCallIds } from './base.js';

/** Receives the input as-is, including a multi-step tool conversation. */
export type MockResponder = (
  input: CompletionInput,
  systemPrompt: string | undefined,
  options: CompletionOptions,
) => MockResult | Promise<MockResult> | Error;

/** A responder's reply: plain text, or text with the model's tool calls. */
export type MockResult = string | { text: string; toolCalls?: ToolCall[] };

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
    input: CompletionInput,
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    if (this.responder) {
      const result = await this.responder(input, systemPrompt, options);
      if (result instanceof Error) throw result;
      return this.wrap(result, input);
    }

    const key =
      typeof input === 'string'
        ? input
        : JSON.stringify(isConversation(input) ? input : toMessages(input));
    // A lone user turn (step 1 of a multi-step case) matches by its content, like a string input.
    const single = Array.isArray(input) && input.length === 1 && input[0]?.role === 'user' ? input[0] : undefined;
    const text =
      (single && 'content' in single ? this.responses[single.content] : undefined) ??
      this.responses[key] ??
      this.defaultResponse;
    return this.wrap(text, input);
  }

  private wrap(result: MockResult, input: CompletionInput): CompletionResponse {
    const { text, toolCalls } = typeof result === 'string' ? { text: result, toolCalls: undefined } : result;
    return {
      text,
      ...(toolCalls !== undefined ? { toolCalls: withCallIds(toolCalls, input) } : {}),
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      model: this.name,
      latencyMs: this.latencyMs,
    };
  }
}
