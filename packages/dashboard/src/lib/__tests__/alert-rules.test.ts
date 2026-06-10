import { describe, it, expect, vi } from 'vitest';

import {
  createAlertRule,
  deleteAlertRule,
  getAlertRule,
  listAlertRules,
  toggleAlertRule,
} from '../alert-rules';
import type { Db } from '../db';
import type { AlertRule as DbAlertRule } from '../schema';

/**
 * Fake Drizzle that backs the alert_rules table by an in-memory
 * array. The shape mirrors the calls the production code makes
 * — `select().from(alertRules).orderBy()`,
 * `select().from(alertRules).where(eq(...)).limit(1)`,
 * `insert(alertRules).values(row)`,
 * `update(alertRules).set(...).where(eq(...))`,
 * `delete(alertRules).where(eq(...))`. Anything wider would over-
 * couple the test to Drizzle internals.
 */
function makeFakeDb(initial: DbAlertRule[] = []): {
  db: Db;
  rows: DbAlertRule[];
} {
  const rows: DbAlertRule[] = [...initial];

  // Where-predicate inspection: the production code only uses
  // `eq(alertRules.id, x)`. We capture the rhs at call time so the
  // fake can filter on it.
  let pendingWhereId: string | undefined;
  const captureEq = vi.fn((..._args: unknown[]) => {
    // The lib stores the right-hand side of `eq` in a tag the fake
    // can read. We approximate by tracking the most-recent eq via
    // module-level state; this is fine because Drizzle calls eq
    // synchronously before the chain method that uses it.
  });

  const select = vi.fn(() => {
    const chain = {
      from: () => chain,
      where: (predicate: unknown) => {
        // The production code passes the result of `eq(alertRules.id, x)`.
        // Our fake's `eq` captures the value via a side channel; here we
        // read whatever was last set.
        if (
          predicate &&
          typeof predicate === 'object' &&
          'id' in predicate
        ) {
          pendingWhereId = (predicate as { id: string }).id;
        }
        return chain;
      },
      orderBy: () => chain,
      limit: async (_n: number) => {
        if (pendingWhereId) {
          const result = rows.filter((r) => r.id === pendingWhereId);
          pendingWhereId = undefined;
          return result;
        }
        return rows;
      },
      then: (resolve: (value: DbAlertRule[]) => void) => resolve([...rows]),
    };
    return chain;
  });

  const insert = vi.fn(() => ({
    values(row: DbAlertRule): Promise<void> {
      rows.push(row);
      return Promise.resolve();
    },
  }));

  const update = vi.fn(() => ({
    set(patch: Partial<DbAlertRule>) {
      return {
        where(predicate: unknown): Promise<void> {
          if (
            predicate &&
            typeof predicate === 'object' &&
            'id' in predicate
          ) {
            const id = (predicate as { id: string }).id;
            const idx = rows.findIndex((r) => r.id === id);
            if (idx >= 0) {
              rows[idx] = { ...rows[idx], ...patch };
            }
          }
          return Promise.resolve();
        },
      };
    },
  }));

  const del = vi.fn(() => ({
    where(predicate: unknown): Promise<void> {
      if (
        predicate &&
        typeof predicate === 'object' &&
        'id' in predicate
      ) {
        const id = (predicate as { id: string }).id;
        const idx = rows.findIndex((r) => r.id === id);
        if (idx >= 0) rows.splice(idx, 1);
      }
      return Promise.resolve();
    },
  }));

  // Drizzle's `eq(column, value)` returns a sql tag; our fake returns
  // a marker object the chain methods can recognise. We patch
  // `drizzle-orm`'s `eq` at the test-helper boundary by intercepting
  // via the `where` predicate inspection above. To make production
  // code pass through the fake correctly, we replace `eq` calls
  // with a tagged object — see the patched-eq stub installed in
  // beforeEach below.
  return {
    db: {
      select,
      insert,
      update,
      delete: del,
    } as unknown as Db,
    rows,
  };
}

// Drizzle's `eq` is imported by alert-rules.ts. We don't try to mock
// the whole drizzle-orm module; instead we replace `eq` for the
// duration of these tests so it returns a `{ id }`-shaped marker
// the fake DB recognises.
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: (_col: unknown, value: unknown) => ({ id: value as string }),
  };
});

// ─── createAlertRule ────────────────────────────────────────────────────

describe('createAlertRule', () => {
  it('inserts a validated row and returns the created rule', async () => {
    const { db, rows } = makeFakeDb();
    const rule = await createAlertRule(db, {
      name: 'prod regressions',
      trigger: { type: 'regression-threshold', threshold: 0.15 },
      channels: [
        { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
      ],
    });
    expect(rule.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rule.name).toBe('prod regressions');
    expect(rule.enabled).toBe(true);
    expect(rule.cooldownMinutes).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('prod regressions');
  });

  it('rejects malformed trigger configs at the boundary (Zod parse)', async () => {
    const { db } = makeFakeDb();
    await expect(
      createAlertRule(db, {
        name: 'bad',
        // threshold > 1 violates AlertTriggerSchema
        trigger: { type: 'regression-threshold', threshold: 1.5 } as never,
        channels: [
          { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
        ],
      }),
    ).rejects.toThrow();
  });

  it('rejects rules with no channels', async () => {
    const { db } = makeFakeDb();
    await expect(
      createAlertRule(db, {
        name: 'orphan',
        trigger: { type: 'regression-threshold', threshold: 0.1 },
        channels: [],
      }),
    ).rejects.toThrow();
  });

  it('honours suiteId and explicit cooldown / enabled overrides', async () => {
    const { db, rows } = makeFakeDb();
    const rule = await createAlertRule(db, {
      name: 'scoped',
      suiteId: 'suite-a',
      trigger: { type: 'avg-score-drop', threshold: 0.05 },
      channels: [
        { type: 'webhook', config: { url: 'https://r.example.com/hook' } },
      ],
      cooldownMinutes: 60,
      enabled: false,
    });
    expect(rule.suiteId).toBe('suite-a');
    expect(rule.cooldownMinutes).toBe(60);
    expect(rule.enabled).toBe(false);
    expect(rows[0].cooldownMinutes).toBe(60);
    expect(rows[0].enabled).toBe(false);
  });

  it('captures createdBy on the row', async () => {
    const { db, rows } = makeFakeDb();
    await createAlertRule(db, {
      name: 'tracked',
      trigger: { type: 'regression-threshold', threshold: 0.1 },
      channels: [
        { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
      ],
      createdBy: 'user-uuid-123',
    });
    expect(rows[0].createdBy).toBe('user-uuid-123');
  });
});

// ─── listAlertRules / getAlertRule ──────────────────────────────────────

describe('listAlertRules', () => {
  it('returns an empty array when no rules exist', async () => {
    const { db } = makeFakeDb();
    const out = await listAlertRules(db);
    expect(out).toEqual([]);
  });

  it('round-trips inserted rules through the listing path', async () => {
    const { db } = makeFakeDb();
    await createAlertRule(db, {
      name: 'a',
      trigger: { type: 'regression-threshold', threshold: 0.1 },
      channels: [
        { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
      ],
    });
    await createAlertRule(db, {
      name: 'b',
      trigger: { type: 'avg-score-drop', threshold: 0.2 },
      channels: [
        { type: 'webhook', config: { url: 'https://r.example.com/hook' } },
      ],
    });
    const out = await listAlertRules(db);
    expect(out.map((r) => r.name).sort()).toEqual(['a', 'b']);
  });
});

describe('getAlertRule', () => {
  it('returns null for an unknown id', async () => {
    const { db } = makeFakeDb();
    const out = await getAlertRule(db, 'unknown');
    expect(out).toBeNull();
  });

  it('returns the rule when it exists', async () => {
    const { db } = makeFakeDb();
    const created = await createAlertRule(db, {
      name: 'find-me',
      trigger: { type: 'regression-threshold', threshold: 0.1 },
      channels: [
        { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
      ],
    });
    const found = await getAlertRule(db, created.id);
    expect(found?.name).toBe('find-me');
  });
});

// ─── toggleAlertRule ────────────────────────────────────────────────────

describe('toggleAlertRule', () => {
  it('flips enabled true → false → true', async () => {
    const { db } = makeFakeDb();
    const created = await createAlertRule(db, {
      name: 'toggle-me',
      trigger: { type: 'regression-threshold', threshold: 0.1 },
      channels: [
        { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
      ],
    });
    expect(created.enabled).toBe(true);

    const after1 = await toggleAlertRule(db, created.id);
    expect(after1?.enabled).toBe(false);

    const after2 = await toggleAlertRule(db, created.id);
    expect(after2?.enabled).toBe(true);
  });

  it('returns null for an unknown id', async () => {
    const { db } = makeFakeDb();
    const out = await toggleAlertRule(db, 'never-existed');
    expect(out).toBeNull();
  });
});

// ─── deleteAlertRule ────────────────────────────────────────────────────

describe('deleteAlertRule', () => {
  it('removes the row and returns the deleted rule', async () => {
    const { db, rows } = makeFakeDb();
    const created = await createAlertRule(db, {
      name: 'delete-me',
      trigger: { type: 'regression-threshold', threshold: 0.1 },
      channels: [
        { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
      ],
    });
    expect(rows).toHaveLength(1);

    const removed = await deleteAlertRule(db, created.id);
    expect(removed?.name).toBe('delete-me');
    expect(rows).toHaveLength(0);
  });

  it('returns null for an unknown id (no-op)', async () => {
    const { db } = makeFakeDb();
    const out = await deleteAlertRule(db, 'never-existed');
    expect(out).toBeNull();
  });
});
