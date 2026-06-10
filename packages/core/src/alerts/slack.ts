import type { AlertChannel, AlertPayload } from '../types/alerts.js';
import type { AlertSender } from './base.js';

/**
 * Slack Incoming Webhook sender. (arch §14)
 *
 * Slack auth = URL secrecy (the Incoming Webhook URL is the credential).
 * No HMAC, no Bearer header — that's why this lives apart from
 * `WebhookSender`. The router dispatches by `channel.type`, so a typo'd
 * webhook URL surfaces as a sender failure (recorded as `failed` on
 * the alert event), not as routing-layer confusion.
 *
 * The message uses Slack Block Kit. A single fallback `text` is set
 * for screen readers / mobile previews; the visual structure lives in
 * `blocks`. The "View Run" action button is omitted entirely when
 * `payload.runUrl` is missing — Slack rejects buttons with empty URLs.
 */

export interface SlackSenderOptions {
  /** Override `globalThis.fetch` for tests. */
  fetch?: typeof globalThis.fetch;
  /**
   * Cap the regression list rendered in the message. Slack messages
   * are capped at 40k chars; over-long lists also tank readability.
   * Default 10 — beyond that the message gets a "+N more" tail.
   */
  maxRegressions?: number;
}

const DEFAULT_MAX_REGRESSIONS = 10;

export class SlackSender implements AlertSender {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly maxRegressions: number;

  constructor(opts: SlackSenderOptions = {}) {
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRegressions = opts.maxRegressions ?? DEFAULT_MAX_REGRESSIONS;
  }

  async send(channel: AlertChannel, payload: AlertPayload): Promise<void> {
    if (channel.type !== 'slack') {
      throw new Error(
        `SlackSender received non-slack channel type "${channel.type}"`,
      );
    }
    const body = buildSlackBody(payload, this.maxRegressions);
    const res = await this.fetcher(channel.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`slack POST failed: ${res.status} ${res.statusText}`);
    }
  }
}

/**
 * Pure body-builder, exported for tests. The router doesn't care about
 * the Slack JSON shape, but snapshot-style tests over the body do.
 */
export function buildSlackBody(
  payload: AlertPayload,
  maxRegressions = DEFAULT_MAX_REGRESSIONS,
): SlackMessage {
  const visible = payload.regressions.slice(0, maxRegressions);
  const overflow = payload.regressions.length - visible.length;

  const regressionLines = visible
    .map((r) => `• \`${r.caseId}\`: ${r.score.toFixed(3)} (Δ ${r.delta.toFixed(3)})`)
    .join('\n');
  const regressionText = overflow > 0
    ? `${regressionLines}\n_…and ${overflow} more_`
    : regressionLines;

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🔴 drift-ci: ${payload.ruleName}*\n${payload.reason}`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Suite:*\n\`${payload.suiteId}\`` },
        { type: 'mrkdwn', text: `*Provider:*\n\`${payload.provider}\`` },
        { type: 'mrkdwn', text: `*Avg score:*\n${payload.avgScore.toFixed(3)}` },
        { type: 'mrkdwn', text: `*Regressions:*\n${payload.regressions.length}` },
      ],
    },
  ];

  if (regressionText) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Regressed cases:*\n${regressionText}` },
    });
  }

  if (payload.runUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📊 View run' },
          url: payload.runUrl,
        },
      ],
    });
  }

  return {
    text: `🔴 drift-ci alert: ${payload.ruleName} — ${payload.reason}`,
    blocks,
  };
}

// ─── Slack Block Kit shape (subset we use) ─────────────────────────────

export interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

export type SlackBlock =
  | {
      type: 'section';
      text?: SlackText;
      fields?: SlackText[];
    }
  | {
      type: 'actions';
      elements: SlackButton[];
    };

export interface SlackText {
  type: 'mrkdwn' | 'plain_text';
  text: string;
}

export interface SlackButton {
  type: 'button';
  text: SlackText;
  url: string;
}
