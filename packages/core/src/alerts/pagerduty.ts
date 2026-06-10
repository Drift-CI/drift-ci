import type { AlertChannel, AlertPayload } from '../types/alerts.js';
import { alertDedupeKey } from '../types/alerts.js';
import type { AlertSender } from './base.js';

/**
 * PagerDuty Events API v2 sender.
 *
 * Wire format: `POST https://events.pagerduty.com/v2/enqueue`
 *   { routing_key, event_action, dedup_key, payload: {...}, links: [...] }
 * PagerDuty returns 202 Accepted on success — anything else is an error.
 *
 * Auth = `routing_key` (an integration key from the PagerDuty service).
 * No HMAC, no Bearer — same URL-secrecy model as Slack/Teams. The
 * routing key is the credential.
 *
 * `dedup_key` is the alert dedupe tuple from arch §14
 * (`${ruleId}::${runId}`). PagerDuty itself dedupes on this key, so
 * even if drift-ci's own dedupe slipped, PagerDuty would suppress
 * the second event — defence in depth.
 */

export const PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';
const PAGERDUTY_SOURCE = 'drift-ci';

export interface PagerDutySenderOptions {
  /** Override `globalThis.fetch` for tests / custom HTTP clients. */
  fetch?: typeof globalThis.fetch;
  /** Override the events endpoint (e.g. EU instance: `events.eu.pagerduty.com`). */
  eventsUrl?: string;
}

export class PagerDutySender implements AlertSender {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly eventsUrl: string;

  constructor(opts: PagerDutySenderOptions = {}) {
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.eventsUrl = opts.eventsUrl ?? PAGERDUTY_EVENTS_URL;
  }

  async send(channel: AlertChannel, payload: AlertPayload): Promise<void> {
    if (channel.type !== 'pagerduty') {
      throw new Error(
        `PagerDutySender received non-pagerduty channel type "${channel.type}"`,
      );
    }
    const body = buildPagerDutyEvent(channel.config.routingKey, channel.config.severity, payload);
    const res = await this.fetcher(this.eventsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // PagerDuty returns 202 Accepted; treat the whole 2xx range as success
    // so a future API change doesn't break the sender silently.
    if (!res.ok) {
      throw new Error(`pagerduty POST failed: ${res.status} ${res.statusText}`);
    }
  }
}

/**
 * Pure event builder, exported for tests. The shape matches the
 * PagerDuty Events API v2 reference verbatim — fields not listed
 * here are explicitly omitted to keep the payload minimal.
 */
export function buildPagerDutyEvent(
  routingKey: string,
  severity: 'critical' | 'error' | 'warning' | 'info',
  payload: AlertPayload,
): PagerDutyEvent {
  const summary = `drift-ci: ${payload.ruleName} — ${payload.reason}`;
  const event: PagerDutyEvent = {
    routing_key: routingKey,
    event_action: 'trigger',
    dedup_key: alertDedupeKey(payload.ruleId, payload.runId),
    payload: {
      // PagerDuty caps summary at 1024 chars. Truncate with an ellipsis
      // rather than risk a 4xx for a long reason string.
      summary: summary.length > 1024 ? `${summary.slice(0, 1021)}...` : summary,
      source: PAGERDUTY_SOURCE,
      severity,
      component: payload.suiteId,
      group: payload.provider,
      class: 'regression',
      custom_details: {
        ruleId: payload.ruleId,
        ruleName: payload.ruleName,
        runId: payload.runId,
        suiteId: payload.suiteId,
        provider: payload.provider,
        avgScore: payload.avgScore,
        regressions: payload.regressions,
        firedAt: payload.firedAt.toISOString(),
        startedAt: payload.startedAt.toISOString(),
      },
    },
  };
  if (payload.runUrl) {
    event.links = [{ href: payload.runUrl, text: 'View run' }];
  }
  return event;
}

// ─── PagerDuty Events API v2 wire shape (subset we use) ─────────────────

export interface PagerDutyEvent {
  routing_key: string;
  event_action: 'trigger' | 'acknowledge' | 'resolve';
  dedup_key?: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    component?: string;
    group?: string;
    class?: string;
    custom_details?: Record<string, unknown>;
  };
  links?: Array<{ href: string; text: string }>;
}
