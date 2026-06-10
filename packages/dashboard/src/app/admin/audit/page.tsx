import Link from 'next/link';
import type { JSX } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageShell } from '@/components/page-shell';
import { auditKindLabel, AUDIT_KINDS, listAuditEvents } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { formatDateTime, formatRelative } from '@/lib/format';
import { requireSession } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    kind?: string;
    limit?: string;
  }>;
}

const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: AUDIT_KINDS.USER_SIGNED_IN, label: 'Signed in' },
  { value: AUDIT_KINDS.USER_SIGNED_OUT, label: 'Signed out' },
  { value: AUDIT_KINDS.AUTH_FAILED, label: 'Auth failures' },
  { value: AUDIT_KINDS.TOKEN_MINTED, label: 'Tokens minted' },
  { value: AUDIT_KINDS.TOKEN_REVOKED, label: 'Tokens revoked' },
  { value: AUDIT_KINDS.RUN_INGESTED, label: 'Runs ingested' },
];

export default async function AuditPage({
  searchParams,
}: PageProps): Promise<JSX.Element> {
  const session = await requireSession({
    targetPath: '/admin/audit',
    role: 'admin',
  });
  const params = await searchParams;
  const kind = params.kind ?? '';
  const limit = clampLimit(params.limit);

  const events = await listAuditEvents(getDb(), {
    kinds: kind ? [kind] : undefined,
    limit,
  });

  return (
    <PageShell
      session={{ email: session.email, role: session.role }}
      title="Audit log"
      subtitle={`${events.length} most-recent ${kind ? `${auditKindLabel(kind)} ` : ''}event(s).`}
    >
      <nav className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/admin/audit${f.value ? `?kind=${encodeURIComponent(f.value)}` : ''}`}
            className={`rounded-md border px-3 py-1 text-xs ${
              kind === f.value
                ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-600'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {events.length === 0 ? (
        <EmptyState
          title="No events match"
          hint={
            kind
              ? 'Try “All” to see every kind.'
              : 'Sign in or mint a token to see your first event.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Kind</th>
                <th className="px-4 py-2 text-left">Target</th>
                <th className="px-4 py-2 text-left">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {events.map((e) => (
                <tr key={e.id}>
                  <td
                    className="px-4 py-2 text-neutral-600 dark:text-neutral-400"
                    title={formatDateTime(e.occurredAt)}
                  >
                    {formatRelative(e.occurredAt)}
                  </td>
                  <td className="px-4 py-2">
                    <KindBadge kind={e.kind} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {e.target ?? <span className="italic text-neutral-400">—</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400">
                    {Object.keys(e.data ?? {}).length > 0 ? (
                      <pre className="whitespace-pre-wrap break-words">
                        {JSON.stringify(e.data, null, 0)}
                      </pre>
                    ) : (
                      <span className="italic text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}

function clampLimit(raw: string | undefined): number {
  if (!raw) return 50;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, 500);
}

function KindBadge({ kind }: { kind: string }): JSX.Element {
  const tone =
    kind === AUDIT_KINDS.AUTH_FAILED
      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
      : kind === AUDIT_KINDS.TOKEN_REVOKED
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        : kind === AUDIT_KINDS.TOKEN_MINTED || kind === AUDIT_KINDS.USER_SIGNED_IN
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${tone}`}
    >
      {auditKindLabel(kind)}
    </span>
  );
}
