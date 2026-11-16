import type Anthropic from '@anthropic-ai/sdk';

import type { ToolCall, ToolDefinition } from './base.js';

/** Shared by the Anthropic and Bedrock adapters, which speak the same Messages API. */
export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    ...(t.description !== undefined ? { description: t.description } : {}),
    // The suite schema validates a JSON-schema object; Anthropic types it as `{ type: 'object', ... }`.
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

export function readAnthropicToolCalls(content: Anthropic.ContentBlock[]): ToolCall[] {
  return content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({
      name: b.name,
      arguments: (b.input ?? {}) as Record<string, unknown>,
    }));
}
