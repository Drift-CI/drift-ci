import type Anthropic from '@anthropic-ai/sdk';

import {
  callIdAt,
  isConversation,
  toMessages,
  type CompletionInput,
  type ToolCall,
  type ToolDefinition,
} from './base.js';

/** Shared by the Anthropic and Bedrock adapters, which speak the same Messages API. */
export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    ...(t.description !== undefined ? { description: t.description } : {}),
    // The suite schema validates a JSON-schema object; Anthropic types it as `{ type: 'object', ... }`.
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

/** Tool calls with the provider's own `tool_use` ids, which the next step echoes back. */
export function readAnthropicToolCalls(content: Anthropic.ContentBlock[]): ToolCall[] {
  return content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({
      id: b.id,
      name: b.name,
      arguments: (b.input ?? {}) as Record<string, unknown>,
    }));
}

/**
 * Plain input becomes `{ role, content }` messages, as always. A tool conversation maps an
 * assistant turn's calls to `tool_use` blocks (after its text, when there is any: the API rejects
 * empty text blocks) and a tool turn to a user message of `tool_result` blocks.
 */
export function toAnthropicMessages(input: CompletionInput): Anthropic.MessageParam[] {
  if (!isConversation(input)) {
    return toMessages(input).map((m) => ({ role: m.role, content: m.content }));
  }
  let ordinal = 0;
  return input.map((turn): Anthropic.MessageParam => {
    if (turn.role === 'user') return { role: 'user', content: turn.content };
    if (turn.role === 'assistant') {
      if (!turn.toolCalls?.length) return { role: 'assistant', content: turn.content };
      return {
        role: 'assistant',
        content: [
          ...(turn.content ? [{ type: 'text' as const, text: turn.content }] : []),
          ...turn.toolCalls.map((c) => ({
            type: 'tool_use' as const,
            id: callIdAt(c, ++ordinal),
            name: c.name,
            input: c.arguments,
          })),
        ],
      };
    }
    return {
      role: 'user',
      content: turn.results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.callId,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  });
}
