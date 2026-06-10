import type { AlertChannel, AlertPayload } from '../types/alerts.js';
import type { AlertSender } from './base.js';

/**
 * Email sender. Email is a deployment concern — every team has its
 * own SMTP relay / SES role / Postmark account. Rather than ship a
 * mail-library dependency in `@drift-ci/core`, we accept an
 * injectable {@link EmailTransport}.
 *
 * Operators wire one of these on the dashboard side:
 *
 * ```ts
 * import nodemailer from 'nodemailer';
 * const transport: EmailTransport = {
 *   send: async (m) => { await mailer.sendMail(m); }
 * };
 * const senders = buildDefaultSenders({ email: { transport } });
 * ```
 *
 * Without a transport, the sender throws on send — desired so a
 * misconfigured email channel surfaces as a `failed` delivery on the
 * alert event rather than silently dropping.
 */

export interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export interface EmailSenderOptions {
  transport?: EmailTransport;
  /**
   * Default `from` when the channel doesn't set one. Typical:
   * `"drift-ci <alerts@drift.example.com>"`.
   */
  defaultFrom?: string;
  /** Cap on regression rows in the body. Default 25 (longer than chat — emails are scrollable). */
  maxRegressions?: number;
}

const DEFAULT_MAX_REGRESSIONS = 25;

export class EmailSender implements AlertSender {
  private readonly transport: EmailTransport | undefined;
  private readonly defaultFrom: string | undefined;
  private readonly maxRegressions: number;

  constructor(opts: EmailSenderOptions = {}) {
    this.transport = opts.transport;
    this.defaultFrom = opts.defaultFrom;
    this.maxRegressions = opts.maxRegressions ?? DEFAULT_MAX_REGRESSIONS;
  }

  async send(channel: AlertChannel, payload: AlertPayload): Promise<void> {
    if (channel.type !== 'email') {
      throw new Error(
        `EmailSender received non-email channel type "${channel.type}"`,
      );
    }
    if (!this.transport) {
      throw new Error(
        'EmailSender: no transport configured. Wire one via buildDefaultSenders({ email: { transport } }).',
      );
    }
    const message = buildEmailMessage(
      payload,
      channel.config.to,
      channel.config.from ?? this.defaultFrom,
      this.maxRegressions,
    );
    await this.transport.send(message);
  }
}

/**
 * Pure builder, exported for tests. Renders both a plain-text body
 * (fallback) and an HTML body — most modern mail clients pick HTML
 * but the plain-text version stays human-readable.
 */
export function buildEmailMessage(
  payload: AlertPayload,
  to: string,
  from: string | undefined,
  maxRegressions = DEFAULT_MAX_REGRESSIONS,
): EmailMessage {
  const visible = payload.regressions.slice(0, maxRegressions);
  const overflow = payload.regressions.length - visible.length;

  const subject = `[drift-ci] ${payload.ruleName}: ${payload.reason}`;

  const textLines = [
    `drift-ci alert: ${payload.ruleName}`,
    payload.reason,
    '',
    `Suite:        ${payload.suiteId}`,
    `Provider:     ${payload.provider}`,
    `Avg score:    ${payload.avgScore.toFixed(3)}`,
    `Regressions:  ${payload.regressions.length}`,
  ];
  if (visible.length > 0) {
    textLines.push('', 'Regressed cases:');
    for (const r of visible) {
      textLines.push(`  - ${r.caseId}: ${r.score.toFixed(3)} (Δ ${r.delta.toFixed(3)})`);
    }
    if (overflow > 0) {
      textLines.push(`  …and ${overflow} more`);
    }
  }
  if (payload.runUrl) {
    textLines.push('', `View run: ${payload.runUrl}`);
  }
  const text = textLines.join('\n');

  const htmlRows = visible
    .map(
      (r) =>
        `<tr><td style="font-family:monospace">${escapeHtml(r.caseId)}</td>` +
        `<td>${r.score.toFixed(3)}</td>` +
        `<td>Δ ${r.delta.toFixed(3)}</td></tr>`,
    )
    .join('');
  const html = [
    `<h2 style="margin:0 0 8px 0">drift-ci: ${escapeHtml(payload.ruleName)}</h2>`,
    `<p>${escapeHtml(payload.reason)}</p>`,
    `<table><tbody>`,
    `<tr><td><b>Suite</b></td><td><code>${escapeHtml(payload.suiteId)}</code></td></tr>`,
    `<tr><td><b>Provider</b></td><td><code>${escapeHtml(payload.provider)}</code></td></tr>`,
    `<tr><td><b>Avg score</b></td><td>${payload.avgScore.toFixed(3)}</td></tr>`,
    `<tr><td><b>Regressions</b></td><td>${payload.regressions.length}</td></tr>`,
    `</tbody></table>`,
    visible.length > 0
      ? `<h3>Regressed cases</h3><table><tbody>${htmlRows}</tbody></table>`
      : '',
    overflow > 0 ? `<p><em>…and ${overflow} more</em></p>` : '',
    payload.runUrl
      ? `<p><a href="${escapeHtml(payload.runUrl)}">View run</a></p>`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { to, from, subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
