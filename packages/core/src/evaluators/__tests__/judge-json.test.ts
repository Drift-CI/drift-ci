import { describe, it, expect } from 'vitest';

import { stripJsonFence } from '../judge-json.js';

describe('stripJsonFence', () => {
  it('returns plain text unchanged (trimmed)', () => {
    expect(stripJsonFence('  {"score": 1}  ')).toBe('{"score": 1}');
  });

  it('strips a ```json fence', () => {
    expect(stripJsonFence('```json\n{"score": 1, "reason": "ok"}\n```')).toBe(
      '{"score": 1, "reason": "ok"}',
    );
  });

  it('strips a bare ``` fence', () => {
    expect(stripJsonFence('```\n{"score": 0}\n```')).toBe('{"score": 0}');
  });

  it('leaves prose-wrapped JSON untouched (no fuzzy extraction)', () => {
    // Not a fence — returned trimmed; the caller will strict-parse and fail.
    const text = 'Here is my verdict: {"score": 1}';
    expect(stripJsonFence(text)).toBe('Here is my verdict: {"score": 1}');
  });
});
