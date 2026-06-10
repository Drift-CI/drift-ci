import { describe, it, expect, vi } from 'vitest';
import { seedFirstAdmin } from '../seed';
import { TOKEN_PATTERN } from '../tokens';
import type { Db } from '../db';

interface FakeDbState {
  users: Array<Record<string, unknown>>;
  apiTokens: Array<Record<string, unknown>>;
}

function makeFakeDb(initialUsers: Array<{ id: string }> = []): {
  db: Db;
  state: FakeDbState;
} {
  const state: FakeDbState = {
    users: initialUsers.map((u) => ({ ...u })),
    apiTokens: [],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usersChain: any = {
    from: vi.fn(() => usersChain),
    limit: vi.fn(() => Promise.resolve(state.users.map((u) => ({ id: u.id })))),
  };
  const select = vi.fn(() => usersChain);
  const insert = vi.fn((table: { _: { name?: string } } | unknown) => {
    // Drizzle exposes table metadata under `_` — but our simple fake
    // can route on the call order: first insert → users, second → tokens.
    // (Order is enforced by seedFirstAdmin's implementation.)
    return {
      values(row: Record<string, unknown>) {
        const target = state.users.length === 0 ? 'users' : 'apiTokens';
        if (target === 'users') {
          state.users.push(row);
        } else {
          state.apiTokens.push(row);
        }
        return Promise.resolve();
      },
    };
  });
  const db = { select, insert } as unknown as Db;
  return { db, state };
}

describe('seedFirstAdmin', () => {
  it('returns no-admin-email when DRIFT_ADMIN_EMAIL is not set', async () => {
    const { db, state } = makeFakeDb();
    const out = await seedFirstAdmin(db, { email: undefined });
    expect(out.status).toBe('no-admin-email');
    expect(state.users).toHaveLength(0);
  });

  it('returns existing-users when the DB already has at least one user', async () => {
    const { db, state } = makeFakeDb([{ id: 'u1' }]);
    const out = await seedFirstAdmin(db, { email: 'admin@example.com' });
    expect(out.status).toBe('existing-users');
    expect(state.apiTokens).toHaveLength(0);
  });

  it('creates an admin + bootstrap token on a fresh DB', async () => {
    const { db, state } = makeFakeDb();
    const out = await seedFirstAdmin(db, { email: 'admin@example.com' });
    expect(out.status).toBe('created');
    expect(out.email).toBe('admin@example.com');
    expect(out.tokenPlaintext).toMatch(TOKEN_PATTERN);
    expect(state.users).toHaveLength(1);
    expect(state.users[0].email).toBe('admin@example.com');
    expect(state.users[0].role).toBe('admin');
    expect(state.apiTokens).toHaveLength(1);
    expect(state.apiTokens[0].name).toBe('bootstrap');
    // The token row should reference the admin we just inserted.
    expect(state.apiTokens[0].userId).toBe(state.users[0].id);
  });

  it('grants admin scopes to the bootstrap token', async () => {
    const { db, state } = makeFakeDb();
    await seedFirstAdmin(db, { email: 'admin@example.com' });
    expect(state.apiTokens[0].scopes).toEqual([
      'runs:read',
      'runs:write',
      'tokens:manage',
      'audit:read',
    ]);
  });
});
