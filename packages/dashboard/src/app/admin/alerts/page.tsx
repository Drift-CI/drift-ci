import type { JSX } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageShell } from '@/components/page-shell';
import { listAlertRules } from '@/lib/alert-rules';
import { getDb } from '@/lib/db';
import { formatDateTime, formatRelative } from '@/lib/format';
import { requireSession } from '@/lib/require-session';

import { createRuleAction, deleteRuleAction, toggleRuleAction } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    created?: string;
    toggled?: string;
    deleted?: string;
    error?: string;
  }>;
}

const CHANNEL_TYPES = [
  { value: 'slack', label: 'Slack', urlPlaceholder: 'https://hooks.slack.com/services/T/B/X' },
  { value: 'teams', label: 'Microsoft Teams', urlPlaceholder: 'https://outlook.office.com/webhook/...' },
  { value: 'webhook', label: 'Generic webhook (HMAC)', urlPlaceholder: 'https://receiver.example.com/hook' },
  { value: 'pagerduty', label: 'PagerDuty', urlPlaceholder: '' },
  { value: 'email', label: 'Email', urlPlaceholder: '' },
] as const;

export default async function AlertsPage({
  searchParams,
}: PageProps): Promise<JSX.Element> {
  const session = await requireSession({
    targetPath: '/admin/alerts',
    role: 'admin',
  });
  const params = await searchParams;
  const banner = pickBanner(params);

  const db = getDb();
  const rules = await listAlertRules(db);

  return (
    <PageShell
      session={{ email: session.email, role: session.role }}
      title="Alert rules"
      subtitle="Wire regression alerts into Slack, Teams, PagerDuty, custom webhooks, or email."
    >
      {banner ? (
        <div
          role={banner.tone === 'error' ? 'alert' : undefined}
          className={`rounded-md border p-3 text-sm ${
            banner.tone === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
          }`}
        >
          {banner.body}
        </div>
      ) : null}

      <section className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-base font-medium">Create a rule</h2>
        <form action={createRuleAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Name
              </span>
              <input
                name="name"
                required
                maxLength={200}
                placeholder="Production regressions"
                className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Suite filter (optional)
              </span>
              <input
                name="suiteId"
                placeholder="empty = all suites"
                className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Regression threshold (0–1)
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                name="threshold"
                defaultValue="0.15"
                required
                className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Cooldown (minutes)
              </span>
              <input
                type="number"
                step="1"
                min="0"
                max="10080"
                name="cooldownMinutes"
                defaultValue="0"
                className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
          </div>

          <fieldset className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
            <legend className="px-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Channel
            </legend>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Type
              </span>
              <select
                name="channelType"
                defaultValue="slack"
                className="block rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              >
                {CHANNEL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Webhook URL (Slack / Teams / Generic)
              </span>
              <input
                name="channelUrl"
                placeholder="https://..."
                className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Generic-webhook signing secret (optional)
              </span>
              <input
                name="signingSecret"
                placeholder="≥16 chars; HMAC-SHA256 over body+timestamp"
                className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  PagerDuty routing key
                </span>
                <input
                  name="routingKey"
                  className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  PagerDuty severity
                </span>
                <select
                  name="severity"
                  defaultValue="error"
                  className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                >
                  <option value="critical">critical</option>
                  <option value="error">error</option>
                  <option value="warning">warning</option>
                  <option value="info">info</option>
                </select>
              </label>
            </div>

            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Email recipient
              </span>
              <input
                type="email"
                name="emailTo"
                placeholder="oncall@example.com"
                className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
          </fieldset>

          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Create rule
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Existing rules
        </h2>
        {rules.length === 0 ? (
          <EmptyState title="No alert rules yet" hint="Create one above to wire regression notifications." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Suite</th>
                  <th className="px-4 py-2 text-left">Trigger</th>
                  <th className="px-4 py-2 text-left">Channels</th>
                  <th className="px-4 py-2 text-left">Cooldown</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                      {r.suiteId ? (
                        <span className="font-mono text-xs">{r.suiteId}</span>
                      ) : (
                        <span className="italic text-neutral-400">all suites</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {summariseTrigger(r.trigger)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {r.channels.map((c) => c.type).join(', ')}
                    </td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                      {r.cooldownMinutes > 0 ? `${r.cooldownMinutes}m` : <span className="italic">none</span>}
                    </td>
                    <td
                      className="px-4 py-2 text-neutral-600 dark:text-neutral-400"
                      title={r.createdAt ? formatDateTime(r.createdAt) : ''}
                    >
                      {r.createdAt ? formatRelative(r.createdAt) : '-'}
                    </td>
                    <td className="px-4 py-2">
                      {r.enabled ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          enabled
                        </span>
                      ) : (
                        <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          disabled
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-3">
                        <form action={toggleRuleAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="text-xs text-sky-600 hover:underline dark:text-sky-400"
                          >
                            {r.enabled ? 'Disable' : 'Enable'}
                          </button>
                        </form>
                        <form action={deleteRuleAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="text-xs text-rose-600 hover:underline dark:text-rose-400"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
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

function summariseTrigger(trigger: { type: string; threshold?: number; cron?: string }): string {
  switch (trigger.type) {
    case 'regression-threshold':
      return `regression > ${(trigger.threshold ?? 0) * 100}%`;
    case 'avg-score-drop':
      return `avg drop > ${(trigger.threshold ?? 0) * 100}%`;
    case 'provider-divergence':
      return `divergence > ${(trigger.threshold ?? 0) * 100}%`;
    case 'schedule':
      return `schedule ${trigger.cron ?? ''}`;
    default:
      return trigger.type;
  }
}

function pickBanner(params: {
  created?: string;
  toggled?: string;
  deleted?: string;
  error?: string;
}): { tone: 'success' | 'error'; body: JSX.Element } | null {
  if (params.created) {
    return {
      tone: 'success',
      body: <>Rule <strong>“{params.created}”</strong> created.</>,
    };
  }
  if (params.toggled) {
    return { tone: 'success', body: <>Rule status updated.</> };
  }
  if (params.deleted === '1') {
    return { tone: 'success', body: <>Rule deleted.</> };
  }
  if (params.error) {
    return {
      tone: 'error',
      body: (
        <>
          Couldn&apos;t apply change: <code className="font-mono text-xs">{params.error}</code>
        </>
      ),
    };
  }
  return null;
}
