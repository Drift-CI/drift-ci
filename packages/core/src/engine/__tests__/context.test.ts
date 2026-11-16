import { describe, it, expect } from 'vitest';
import { contextPassages, formatContext, withContext } from '../context.js';
import type { TestCase } from '../../types/index.js';

describe('contextPassages', () => {
  it('handles undefined, string and list', () => {
    expect(contextPassages({})).toBeUndefined();
    expect(contextPassages({ context: 'a' })).toEqual(['a']);
    expect(contextPassages({ context: ['a', 'b'] })).toEqual(['a', 'b']);
  });
});

describe('formatContext', () => {
  it('numbers passages inside a context block', () => {
    expect(formatContext(['one', 'two'])).toBe(
      'Answer using the context below.\n\n<context>\n[1] one\n[2] two\n</context>\n\n',
    );
  });
});

describe('withContext', () => {
  it('returns input unchanged with no context', () => {
    expect(withContext({ id: 'c', input: 'q' })).toBe('q');
  });

  it('returns the same messages array with no context', () => {
    const messages = [{ role: 'user' as const, content: 'q' }];
    expect(withContext({ id: 'c', messages })).toBe(messages);
  });

  it('prefixes an input case', () => {
    expect(withContext({ id: 'c', input: 'q', context: ['p1'] })).toBe(
      formatContext(['p1']) + 'q',
    );
  });

  it('prefixes only the last user turn of a messages case without mutating', () => {
    const tc: TestCase = {
      id: 'c',
      context: 'p',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
    };
    const copy = structuredClone(tc);
    const out = withContext(tc) as { role: string; content: string }[];
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(out[0].content).toBe('a');
    expect(out[1].content).toBe('b');
    expect(out[2].content).toBe(formatContext(['p']) + 'c');
    expect(tc).toEqual(copy);
  });
});
