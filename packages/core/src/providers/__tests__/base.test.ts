import { describe, it, expect } from 'vitest';
import {
  callIdAt,
  countToolCalls,
  isConversation,
  isGeneratedCallId,
  withCallIds,
  type ConversationTurn,
} from '../base.js';

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

describe('call id helpers', () => {
  const conversation: ConversationTurn[] = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'x', name: 'a', arguments: {} }, { name: 'b', arguments: {} }] },
    { role: 'tool', results: [{ callId: 'x', name: 'a', content: 'ok' }] },
  ];

  it('counts the tool calls already in a conversation, and none in plain input', () => {
    expect(countToolCalls(conversation)).toBe(2);
    expect(countToolCalls('hi')).toBe(0);
    expect(countToolCalls([{ role: 'user', content: 'hi' }])).toBe(0);
  });

  it('fills missing ids numbered on from the conversation, keeping provider ids', () => {
    expect(
      withCallIds([{ name: 'c', arguments: {} }, { id: 'own', name: 'd', arguments: {} }], conversation),
    ).toEqual([
      { id: 'call_3', name: 'c', arguments: {} },
      { id: 'own', name: 'd', arguments: {} },
    ]);
  });

  it('tells generated ids from provider ids', () => {
    expect(isGeneratedCallId('call_12')).toBe(true);
    expect(isGeneratedCallId('call_abc')).toBe(false);
    expect(isGeneratedCallId('toolu_01')).toBe(false);
  });

  it('falls back to call_<ordinal> for a call without an id', () => {
    expect(callIdAt({ name: 'a', arguments: {} }, 4)).toBe('call_4');
    expect(callIdAt({ id: 'x', name: 'a', arguments: {} }, 4)).toBe('x');
  });
});
