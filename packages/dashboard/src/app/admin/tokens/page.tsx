import { desc, eq } from 'drizzle-orm';
import type { JSX } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageShell } from '@/components/page-shell';
import { getDb } from '@/lib/db';
import { formatDateTime, formatRelative } from '@/lib/format';
import { requireSession } from '@/lib/require-session';
import { apiTokens, users } from '@/lib/schema';

import { mintTokenAction, revokeTokenAction } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    minted?: string;
    name?: string;
    revoked?: string;
    error?: string;
  }>;
}

const ALL_SCOPES = [
  { value: 'runs:read', label: 'runs:read', help: 'List runs and view diffs' },
  { value: 'runs:write', label: 'runs:write', help: 'Ingest runs from CLI / Action' },
  { value: 'tokens:manage', label: 'tokens:manage', help: 'Mint and revoke tokens' },
  { value: 'audit:read', label: 'audit:read', help: 'Read the audit log (M21)' },
] as const;

export default async function TokensPage({
  searchParams,
}: PageProps): Promise<JSX.Element> {
  const session = await requireSession({
    targetPath: '/admin/tokens',
    role: 'admin',
  });
  const params = await searchParams;
  const banner = pickBanner(params);

  const db = getDb();
  const rows = await db
    .select({
      id: apiTokens.id,
      userEmail: users.email,
      userRole: users.role,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .orderBy(desc(apiTokens.createdAt));

  return (
    <PageShell
      session={{ email: session.email, role: session.role }}
      title="API tokens"
      subtitle="Mint, list, and revoke tokens used by the CLI / GitHub Action / dashboard sync."
    >
      {banner ? (
        <div
          role={banner.tone === 'error' ? 'alert' : undefined}
          className={`rounded-md border p-3 text-sm ${
            banner.tone === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'
              : banner.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
                : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
          }`}
        >
          {banner.body}
        </div>
      ) : null}

      <section className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-base font-medium">Mint a token</h2>
        <form action={mintTokenAction} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Name
            </span>
            <input
              name="name"
              required
              maxLength={80}
              placeholder="e.g. github-action / cli-laptop"
              className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Scopes
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ALL_SCOPES.map((s) => (
                <label
                  key={s.value}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600"
                >
                  <input
                    type="checkbox"
                    name="scopes"
                    value={s.value}
                    defaultChecked={s.value === 'runs:read' || s.value === 'runs:write'}
                  />
                  <span>
                    <span className="font-mono text-xs">{s.label}</span>{' '}
                    <span className="text-neutral-500 dark:text-neutral-400">
                      — {s.help}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Expires (optional)
            </span>
            <input
              type="datetime-local"
              name="expiresAt"
              className="block rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Mint token
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Existing tokens
        </h2>
        {rows.length === 0 ? (
          <EmptyState title="No tokens yet" hint="Mint one above to get started." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">User</th>
                  <th className="px-4 py-2 text-left">Prefix</th>
                  <th className="px-4 py-2 text-left">Scopes</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2 text-left">Last used</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                      <span className="font-mono text-xs">{r.userEmail}</span>{' '}
                      <span className="text-xs text-neutral-400 dark:text-neutral-500">
                        ({r.userRole})
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {r.prefix}…
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {(r.scopes as string[]).join(', ')}
                    </td>
                    <td
                      className="px-4 py-2 text-neutral-600 dark:text-neutral-400"
                      title={formatDateTime(r.createdAt)}
                    >
                      {formatRelative(r.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                      {r.lastUsedAt ? (
                        <span title={formatDateTime(r.lastUsedAt)}>
                          {formatRelative(r.lastUsedAt)}
                        </span>
                      ) : (
                        <span className="italic">never</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {r.revokedAt ? (
                        <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          revoked
                        </span>
                      ) : r.expiresAt && r.expiresAt < new Date() ? (
                        <span className="rounded bg-amber-200 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                          expired
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.revokedAt ? null : (
                        <form action={revokeTokenAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="text-xs text-rose-600 hover:underline dark:text-rose-400"
                          >
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}

function pickBanner(params: {
  minted?: string;
  name?: string;
  revoked?: string;
  error?: string;
}): { tone: 'success' | 'error' | 'warn'; body: JSX.Element } | null {
  if (params.minted) {
    return {
      tone: 'success',
      body: (
        <div>
          <strong>Token “{params.name ?? 'new'}” minted.</strong> Copy it now —
          the dashboard will not show it again:
          <pre className="mt-2 overflow-auto rounded bg-neutral-900 p-3 font-mono text-xs text-emerald-300">
            {params.minted}
          </pre>
        </div>
      ),
    };
  }
  if (params.revoked === '1') {
    return { tone: 'success', body: <>Token revoked.</> };
  }
  if (params.error) {
    return {
      tone: 'error',
      body: <>Couldn&apos;t mint or revoke: <code className="font-mono text-xs">{params.error}</code></>,
    };
  }
  return null;
}
