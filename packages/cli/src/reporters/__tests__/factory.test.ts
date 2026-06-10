import { describe, it, expect } from 'vitest';
import {
  createReporter,
  InkReporter,
  JsonReporter,
  TextReporter,
} from '../index.js';

describe('createReporter', () => {
  it('returns JsonReporter for kind=json regardless of TTY', () => {
    const tty = createReporter({ kind: 'json', stdoutIsTty: true });
    const pipe = createReporter({ kind: 'json', stdoutIsTty: false });
    expect(tty).toBeInstanceOf(JsonReporter);
    expect(pipe).toBeInstanceOf(JsonReporter);
  });

  it('returns InkReporter for kind=terminal on a TTY', () => {
    const r = createReporter({ kind: 'terminal', stdoutIsTty: true });
    expect(r).toBeInstanceOf(InkReporter);
  });

  it('returns TextReporter for kind=terminal when stdout is not a TTY', () => {
    const r = createReporter({ kind: 'terminal', stdoutIsTty: false });
    expect(r).toBeInstanceOf(TextReporter);
  });

  it('treats a missing stdoutIsTty as non-TTY', () => {
    const r = createReporter({ kind: 'terminal' });
    expect(r).toBeInstanceOf(TextReporter);
  });
});
