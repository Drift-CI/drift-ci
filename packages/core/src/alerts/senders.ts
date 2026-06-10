import type { AlertSender } from './base.js';
import { EmailSender } from './email.js';
import { PagerDutySender } from './pagerduty.js';
import { SlackSender } from './slack.js';
import { TeamsSender } from './teams.js';
import { WebhookSender } from './webhook.js';

/**
 * Default sender registry — webhook + Slack + Teams + PagerDuty +
 * Email. The Email sender requires a transport (no SMTP lib in core
 * by design — see {@link EmailSender}); when none is supplied, the
 * email channel is omitted from the registry rather than throwing
 * at construction time. The router will then record
 * `skipped:no-sender` for any email channel, surfacing the
 * misconfiguration as a delivery outcome on the alert event instead
 * of a 500 at evaluate time.
 *
 * Tests can pass through their own option overrides — usually an
 * injected `fetch` — without rebuilding the registry by hand.
 */
export interface BuildSenderOptions {
  /** Single fetch override applied to all HTTP-based senders. Tests usually want this. */
  fetch?: typeof globalThis.fetch;
  /** Per-sender option overrides. */
  webhook?: ConstructorParameters<typeof WebhookSender>[0];
  slack?: ConstructorParameters<typeof SlackSender>[0];
  teams?: ConstructorParameters<typeof TeamsSender>[0];
  pagerduty?: ConstructorParameters<typeof PagerDutySender>[0];
  email?: ConstructorParameters<typeof EmailSender>[0];
}

export function buildDefaultSenders(
  opts: BuildSenderOptions = {},
): Map<string, AlertSender> {
  const senders = new Map<string, AlertSender>([
    ['webhook', new WebhookSender({ fetch: opts.fetch, ...opts.webhook })],
    ['slack', new SlackSender({ fetch: opts.fetch, ...opts.slack })],
    ['teams', new TeamsSender({ fetch: opts.fetch, ...opts.teams })],
    ['pagerduty', new PagerDutySender({ fetch: opts.fetch, ...opts.pagerduty })],
  ]);
  // Email is gated on a transport — operators inject one (nodemailer /
  // SES / Postmark / etc.). Without a transport the channel is omitted;
  // the router's `skipped:no-sender` path then makes the absence visible
  // on the alert event rather than at sender-construction time.
  if (opts.email?.transport) {
    senders.set('email', new EmailSender(opts.email));
  }
  return senders;
}
