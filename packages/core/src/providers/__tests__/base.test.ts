import { describe, it, expect } from 'vitest';
import { isConversation, type ConversationTurn } from '../base.js';

describe('isConversation', () => {
  it('is false for a string and for plain messages', () => {
    expect(isConversation('hi')).toBe(false);
    expect(isConversation([])).toBe(false);
    expect(
      isConversation([
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]),
    ).toBe(false);
  });

  it('is false for an assistant turn with an empty toolCalls list', () => {
    expect(isConversation([{ role: 'assistant', content: 'b', toolCalls: [] }])).toBe(false);
  });

  it('is true when an assistant turn has tool calls or a tool turn is present', () => {
    const withCalls: ConversationTurn[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'a', arguments: {} }] },
    ];
    expect(isConversation(withCalls)).toBe(true);
    const withResults: ConversationTurn[] = [
      { role: 'user', content: 'q' },
      { role: 'tool', results: [{ callId: 'call_1', name: 'a', content: 'ok' }] },
    ];
    expect(isConversation(withResults)).toBe(true);
  });
});
