import { describe, it, expect, vi } from 'vitest';
import {
  AUDIT_KINDS,
  auditKindLabel,
  listAuditEvents,
  recordAudit,
} from '../audit';
import type { Db } from '../db';
import type { AuditEvent } from '../schema';

interface InsertedRow {
  id: string;
  userId: string | null;
  tokenId: string | null;
  kind: string;
  target: string | null;
  data: Record<string, unknown>;
  occurredAt?: Date;
}

function makeInsertingDb(): { db: Db; rows: InsertedRow[] } {
  const rows: InsertedRow[] = [];
  const insert = vi.fn(() => ({
    values(row: InsertedRow): Promise<void> {
      rows.push(row);
      return Promise.resolve();
    },
  }));
  return { db: { insert } as unknown as Db, rows };
}

function makeFailingInsertingDb(): { db: Db } {
  const insert = vi.fn(() => ({
    values(): Promise<void> {
      return Promise.reject(new Error('audit table missing'));
    },
  }));
  return { db: { insert } as unknown as Db };
}

function makeListingDb(rows: AuditEvent[]): { db: Db; whereCalled: () => boolean } {
  let whereCalledFlag = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => {
      whereCalledFlag = true;
      return chain;
    }),
    orderBy: vi.fn(() => chain),
    limit: vi.fn((n: number) => Promise.resolve(rows.slice(0, n))),
  };
  const db = { select: vi.fn(() => chain) } as unknown as Db;
  return { db, whereCalled: () => whereCalledFlag };
}

describe('recordAudit', () => {
  it('inserts a row with sensible defaults for optional fields', async () => {
    const { db, rows } = makeInsertingDb();
    await recordAudit(db, {
      userId: 'u1',
      kind: AUDIT_KINDS.TOKEN_MINTED,
      target: 'tok-1',
      data: { name: 'demo' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'u1',
      kind: AUDIT_KINDS.TOKEN_MINTED,
      target: 'tok-1',
      data: { name: 'demo' },
    });
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets userId/tokenId/target to null when omitted', async () => {
    const { db, rows } = makeInsertingDb();
    await recordAudit(db, { kind: AUDIT_KINDS.AUTH_FAILED });
    expect(rows[0]).toMatchObject({
      userId: null,
      tokenId: null,
      target: null,
      data: {},
    });
  });

  it('swallows DB errors so audit failures do not cascade', async () => {
    const { db } = makeFailingInsertingDb();
    await expect(
      recordAudit(db, { kind: AUDIT_KINDS.AUTH_FAILED }),
    ).resolves.toBeUndefined();
  });
});

describe('listAuditEvents', () => {
  function makeRow(kind: string, occurredAt: Date): AuditEvent {
    return {
      id: `${kind}-${occurredAt.toISOString()}`,
      userId: null,
      tokenId: null,
      kind,
      target: null,
      data: {},
      occurredAt,
    };
  }

  it('returns rows in DB order (the helper expects desc-ordered)', async () => {
    const newest = makeRow(AUDIT_KINDS.RUN_INGESTED, new Date('2026-04-25T01:00:00Z'));
    const middle = makeRow(AUDIT_KINDS.USER_SIGNED_IN, new Date('2026-04-25T00:30:00Z'));
    const oldest = makeRow(AUDIT_KINDS.TOKEN_MINTED, new Date('2026-04-25T00:00:00Z'));
    const { db } = makeListingDb([newest, middle, oldest]);
    const out = await listAuditEvents(db, { limit: 10 });
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(newest);
  });

  it('filters by kind in JS after the query', async () => {
    const a = makeRow(AUDIT_KINDS.RUN_INGESTED, new Date('2026-04-25T01:00:00Z'));
    const b = makeRow(AUDIT_KINDS.AUTH_FAILED, new Date('2026-04-25T00:30:00Z'));
    const { db } = makeListingDb([a, b]);
    const out = await listAuditEvents(db, { kinds: [AUDIT_KINDS.AUTH_FAILED] });
    expect(out).toEqual([b]);
  });

  it('clamps limit to [1, 500]', async () => {
    const r = makeRow(AUDIT_KINDS.RUN_INGESTED, new Date());
    const { db } = makeListingDb([r]);
    await expect(listAuditEvents(db, { limit: 0 })).resolves.toEqual([r]);
    await expect(listAuditEvents(db, { limit: 9999 })).resolves.toEqual([r]);
  });

  it('returns an empty list when the DB has no rows', async () => {
    const { db } = makeListingDb([]);
    await expect(listAuditEvents(db, {})).resolves.toEqual([]);
  });
});

describe('auditKindLabel', () => {
  it('humanises every known kind', () => {
    for (const k of Object.values(AUDIT_KINDS)) {
      expect(auditKindLabel(k)).not.toBe(k);
    }
  });

  it('passes through unknown kinds unchanged', () => {
    expect(auditKindLabel('something.else')).toBe('something.else');
  });
});
