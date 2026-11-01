import { describe, it, expect } from 'vitest';
import type { Suite } from '@drift-ci/core';
import { actionIngestContext } from '../ingest-context.js';

describe('actionIngestContext', () => {
  it('combines suite hashes, judge hash and the delta verdicts', () => {
    const suite = {
      id: 's',
      cases: [
        { id: 'a', input: 'x' },
        { id: 'b', input: 'y' },
      ],
    } as unknown as Suite;
    const ctx = actionIngestContext(suite, 'sha256:j', {
      deltas: { a: -0.4, b: 0.2 },
      regressions: ['a'],
      improvements: ['b'],
      missingBaselines: [],
      staleBaselines: [],
      staleJudges: [],
      noScore: [],
    });
    expect(Object.keys(ctx.suiteHashes).sort()).toEqual(['a', 'b']);
    expect(ctx.judgeHash).toBe('sha256:j');
    expect(ctx.delta).toEqual({ regressions: ['a'], improvements: ['b'], deltas: { a: -0.4, b: 0.2 } });
  });
});
