import { describe, it, expect } from 'vitest';

import { claudeModelRejectsSamplingParams } from '../claude-models.js';

describe('claudeModelRejectsSamplingParams', () => {
  it('is true for the claude-4.7+ generation that removed sampling params', () => {
    for (const m of [
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-fable-5',
      'claude-mythos-5',
    ]) {
      expect(claudeModelRejectsSamplingParams(m)).toBe(true);
    }
  });

  it('is false for earlier generations that still accept temperature', () => {
    for (const m of [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
    ]) {
      expect(claudeModelRejectsSamplingParams(m)).toBe(false);
    }
  });

  it('matches Bedrock-style anthropic.-prefixed ids', () => {
    expect(claudeModelRejectsSamplingParams('anthropic.claude-opus-4-8')).toBe(
      true,
    );
    expect(claudeModelRejectsSamplingParams('anthropic.claude-sonnet-4-6')).toBe(
      false,
    );
  });
});
