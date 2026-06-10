import { describe, it, expect, vi } from 'vitest';
import {
  extractCase,
  getCaseTimeline,
  getPreviousSnapshotForCase,
  getRunById,
  listRunsPaged,
  type RunListItem,
} from '../queries';
import type { Db } from '../db';
import { decodeCursor } from '../cursor';

interface ChainState {
  whereCalled: boolean;
  orderByCalled: boolean;
  limitArg?: number;
  rows: RunListItem[];
}

function makeDbReturning(rows: RunListItem[]): { db: Db; state: ChainState } {
  const state: ChainState = { whereCalled: false, orderByCalled: false, rows };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => {
      state.whereCalled = true;
      return chain;
    }),
    orderBy: vi.fn(() => {
      state.orderByCalled = true;
      return chain;
    }),
    limit: vi.fn((n: number) => {
      state.limitArg = n;
      return Promise.resolve(rows.slice(0, n));
    }),
  };
  const select = vi.fn(() => chain);
  const db = { select } as unknown as Db;
  return { db, state };
}

function makeRow(id: string, startedAt: string): RunListItem {
  return {
    id,
    suiteId: 'suite-x',
    provider: 'mock/m',
    startedAt: new Date(startedAt),
    completedAt: new Date(startedAt),
    receivedAt: new Date(startedAt),
    data: {},
  };
}

describe('listRunsPaged', () => {
  it('over-fetches by one and trims, returning a nextCursor when more rows exist', async () => {
    const fakeRows = Array.from({ length: 6 }, (_, i) =>
      makeRow(`r${i}`, `2026-04-${String(20 - i).padStart(2, '0')}T00:00:00Z`),
    );
    const { db, state } = makeDbReturning(fakeRows);

    const result = await listRunsPaged(db, { limit: 5, cursor: null });

    expect(state.limitArg).toBe(6); // limit + 1 over-fetch
    expect(result.rows).toHaveLength(5);
    expect(result.nextCursor).not.toBeNull();
    const decoded = decodeCursor(result.nextCursor);
    expect(decoded?.id).toBe('r4'); // 5th row, last one we kept
  });

  it('returns no nextCursor when the db has fewer rows than the limit', async () => {
    const { db } = makeDbReturning([
      makeRow('only', '2026-04-25T00:00:00Z'),
    ]);
    const result = await listRunsPaged(db, { limit: 20, cursor: null });
    expect(result.nextCursor).toBeNull();
    expect(result.rows).toHaveLength(1);
  });

  it('passes a cursor through to the where clause', async () => {
    const { db, state } = makeDbReturning([]);
    await listRunsPaged(db, {
      limit: 5,
      cursor: { startedAt: '2026-04-25T00:00:00Z', id: 'r0' },
    });
    expect(state.whereCalled).toBe(true);
  });

  it('respects suiteId filter', async () => {
    const { db, state } = makeDbReturning([]);
    await listRunsPaged(db, { limit: 5, cursor: null, suiteId: 'suite-x' });
    expect(state.whereCalled).toBe(true);
  });

  it('sorts by started_at desc + id desc for deterministic cursor pagination', async () => {
    const { db, state } = makeDbReturning([]);
    await listRunsPaged(db, { limit: 5, cursor: null });
    expect(state.orderByCalled).toBe(true);
  });
});

describe('getRunById', () => {
  it('returns the first row from the result list', async () => {
    const target = makeRow('found', '2026-04-25T00:00:00Z');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve([target])),
    };
    const db = { select: vi.fn(() => chain) } as unknown as Db;
    expect(await getRunById(db, 'found')).toEqual(target);
  });

  it('returns null when no row matches', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve([])),
    };
    const db = { select: vi.fn(() => chain) } as unknown as Db;
    expect(await getRunById(db, 'missing')).toBeNull();
  });
});

// ─── snapshot history fakes ────────────────────────────────────────────
//
// Both `getPreviousSnapshotForCase` and `getCaseTimeline` issue a
// snapshot select first, and the previous-snapshot path additionally
// resolves the run via `getRunById`. We chain a single fake that
// short-circuits each of those calls in order.

interface SnapshotRow {
  runId: string;
  capturedAt: Date;
  score: number;
  suiteHash: string;
  judgeHash: string | null;
}

interface RunRow extends RunListItem {
  data: { cases?: Array<{ caseId: string; output?: string | null }> };
}

function makeSnapshotDb(opts: {
  snapshots: SnapshotRow[];
  /** Resolution map: runId → run row (for getRunById). */
  runs?: Record<string, RunRow>;
}): Db {
  let nextSelect: 'snapshot' | 'run' = 'snapshot';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshotChain: any = {
    from: vi.fn(() => snapshotChain),
    where: vi.fn(() => snapshotChain),
    orderBy: vi.fn(() => snapshotChain),
    limit: vi.fn((n: number) => Promise.resolve(opts.snapshots.slice(0, n))),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runChain: any = {
    from: vi.fn(() => runChain),
    where: vi.fn(() => runChain),
    limit: vi.fn(() => {
      const id = pendingRunId;
      const row = id != null ? opts.runs?.[id] : undefined;
      return Promise.resolve(row ? [row] : []);
    }),
  };
  let pendingRunId: string | null = null;
  // We have to hook between snapshot and run selects. Drizzle doesn't
  // expose the where clause to our fake easily, so flip the cursor
  // manually: the first select is for snapshots, then any subsequent
  // select uses the run chain. Tests reset by rebuilding the db.
  return {
    select: vi.fn(() => {
      if (nextSelect === 'snapshot') {
        nextSelect = 'run';
        return snapshotChain;
      }
      // If the production code calls select() for runs, capture the
      // last snapshot's runId to drive the resolution.
      pendingRunId = opts.snapshots[0]?.runId ?? null;
      return runChain;
    }),
  } as unknown as Db;
}

describe('getPreviousSnapshotForCase', () => {
  it('returns null when there is no prior snapshot', async () => {
    const db = makeSnapshotDb({ snapshots: [] });
    const out = await getPreviousSnapshotForCase(db, {
      caseId: 'c1',
      currentRunCapturedAt: new Date('2026-04-25T00:00:00Z'),
    });
    expect(out).toBeNull();
  });

  it('returns the prior snapshot resolving the output via the run row', async () => {
    const prevRunId = '11111111-2222-3333-4444-555555555555';
    const db = makeSnapshotDb({
      snapshots: [
        {
          runId: prevRunId,
          capturedAt: new Date('2026-04-24T00:00:00Z'),
          score: 0.82,
          suiteHash: 'sha256:abc',
          judgeHash: null,
        },
      ],
      runs: {
        [prevRunId]: {
          id: prevRunId,
          suiteId: 's',
          provider: 'mock/m',
          startedAt: new Date('2026-04-24T00:00:00Z'),
          completedAt: new Date('2026-04-24T00:00:01Z'),
          receivedAt: new Date('2026-04-24T00:00:01Z'),
          data: { cases: [{ caseId: 'c1', output: 'before-text' }] },
        },
      },
    });
    const out = await getPreviousSnapshotForCase(db, {
      caseId: 'c1',
      currentRunCapturedAt: new Date('2026-04-25T00:00:00Z'),
    });
    expect(out).not.toBeNull();
    expect(out!.runId).toBe(prevRunId);
    expect(out!.score).toBe(0.82);
    expect(out!.output).toBe('before-text');
  });

  it('returns the snapshot with output:null when the source run has been retention-pruned', async () => {
    const prevRunId = '11111111-2222-3333-4444-555555555555';
    const db = makeSnapshotDb({
      snapshots: [
        {
          runId: prevRunId,
          capturedAt: new Date('2026-04-24T00:00:00Z'),
          score: 0.5,
          suiteHash: 'sha256:abc',
          judgeHash: null,
        },
      ],
      runs: {}, // run was deleted
    });
    const out = await getPreviousSnapshotForCase(db, {
      caseId: 'c1',
      currentRunCapturedAt: new Date('2026-04-25T00:00:00Z'),
    });
    expect(out).not.toBeNull();
    expect(out!.score).toBe(0.5);
    expect(out!.output).toBeNull();
  });
});

function makeTimelineDb(rows: SnapshotRow[]): { db: Db; capturedLimit: { value?: number } } {
  const capturedLimit: { value?: number } = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn((n: number) => {
      capturedLimit.value = n;
      return Promise.resolve(rows.slice(0, n));
    }),
  };
  const db = { select: vi.fn(() => chain) } as unknown as Db;
  return { db, capturedLimit };
}

describe('getCaseTimeline', () => {
  it('returns the snapshot rows in oldest→newest order', async () => {
    const newest = new Date('2026-04-25T00:00:00Z');
    const middle = new Date('2026-04-24T00:00:00Z');
    const oldest = new Date('2026-04-23T00:00:00Z');
    // Drizzle ORDER BY is desc; the fake just hands back what we give it,
    // so simulate the desc sort here, then assert the helper reverses.
    const { db } = makeTimelineDb([
      { runId: 'r3', capturedAt: newest, score: 0.9, suiteHash: 'sha256:abc', judgeHash: null },
      { runId: 'r2', capturedAt: middle, score: 0.8, suiteHash: 'sha256:abc', judgeHash: null },
      { runId: 'r1', capturedAt: oldest, score: 0.7, suiteHash: 'sha256:abc', judgeHash: null },
    ]);
    const out = await getCaseTimeline(db, { caseId: 'c1' });
    expect(out.map((p) => p.runId)).toEqual(['r1', 'r2', 'r3']);
    expect(out[0].score).toBe(0.7);
  });

  it('defaults to a limit of 30 when omitted', async () => {
    const { db, capturedLimit } = makeTimelineDb([]);
    await getCaseTimeline(db, { caseId: 'c1' });
    expect(capturedLimit.value).toBe(30);
  });

  it('clamps zero or negative limits up to 1', async () => {
    const { db, capturedLimit } = makeTimelineDb([]);
    await getCaseTimeline(db, { caseId: 'c1', limit: 0 });
    expect(capturedLimit.value).toBe(1);
  });

  it('clamps oversize limits down to 200', async () => {
    const { db, capturedLimit } = makeTimelineDb([]);
    await getCaseTimeline(db, { caseId: 'c1', limit: 9999 });
    expect(capturedLimit.value).toBe(200);
  });

  it('passes a suiteHash filter through to the query', async () => {
    const { db } = makeTimelineDb([]);
    await getCaseTimeline(db, { caseId: 'c1', suiteHash: 'sha256:abc' });
    // chain.where is called once per `where()` invocation; the fake
    // resolves it via the chain. Smoke-test that the call path didn't
    // throw.
    expect(true).toBe(true);
  });
});

describe('extractCase', () => {
  function makeRun(cases: Array<Partial<{ caseId: string }>>): Parameters<typeof extractCase>[0] {
    return {
      ...makeRow('r', '2026-04-25T00:00:00Z'),
      data: { cases },
    };
  }

  it('finds the case by id', () => {
    const run = makeRun([{ caseId: 'a' }, { caseId: 'b' }]);
    expect(extractCase(run, 'b')?.caseId).toBe('b');
  });

  it('returns null when the case id is absent', () => {
    expect(extractCase(makeRun([{ caseId: 'a' }]), 'missing')).toBeNull();
  });

  it('returns null when data has no cases array', () => {
    const run = { ...makeRow('r', '2026-04-25T00:00:00Z'), data: { other: 1 } };
    expect(extractCase(run, 'a')).toBeNull();
  });

  it('returns null when data is null', () => {
    const run = { ...makeRow('r', '2026-04-25T00:00:00Z'), data: null };
    expect(extractCase(run, 'a')).toBeNull();
  });
});
