import { z } from 'zod';

/**
 * Alert types for Phase 4. (arch §14)
 *
 * The types defined here are the ground truth for both the dashboard
 * (which persists `AlertRule` rows and emits `AlertEvent` rows) and
 * the alert router (which consumes rules + run results and produces
 * `AlertPayload`s for senders).
 *
 * Schema-level invariants (enforced by Zod refinements below):
 *
 * - A `regression-threshold`, `avg-score-drop`, or
 *   `provider-divergence` trigger requires a `threshold` ∈ [0, 1].
 *   `schedule` triggers require a `cron` expression instead.
 * - Channel `config` shapes are schema-validated per channel `type`
 *   so a typo (e.g. `webhookUrl` vs `webhook_url`) fails at config
 *   load instead of silently producing 4xx during a regression.
 *
 * The router itself (M27) lives in `core/src/alerts/` and the senders
 * (M28+) live alongside it. This file is the type contract they all
 * share.
 */

// ─── triggers ───────────────────────────────────────────────────────────

export const ALERT_TRIGGER_TYPES = [
  'regression-threshold',
  'avg-score-drop',
  'provider-divergence',
  'schedule',
] as const;

export type AlertTriggerType = (typeof ALERT_TRIGGER_TYPES)[number];

const ThresholdTriggerSchema = z.object({
  type: z.enum(['regression-threshold', 'avg-score-drop', 'provider-divergence']),
  threshold: z.number().min(0).max(1),
  /** Optional case-id filter — null/absent matches any case. */
  caseId: z.string().min(1).optional(),
});

const ScheduleTriggerSchema = z.object({
  type: z.literal('schedule'),
  /**
   * Cron expression — five-field POSIX form. Validation is intentionally
   * minimal here; the router parses with a real cron library at runtime.
   * The router rejects malformed cron strings with a descriptive error.
   */
  cron: z.string().min(1),
});

export const AlertTriggerSchema = z.discriminatedUnion('type', [
  ThresholdTriggerSchema,
  ScheduleTriggerSchema,
]);

export type AlertTrigger = z.infer<typeof AlertTriggerSchema>;

// ─── channels ───────────────────────────────────────────────────────────
// Per-channel config schemas: a typo in a webhook URL or Slack token
// fails at config load with a clear path, not as a 4xx during a regression.

const SlackChannelSchema = z.object({
  type: z.literal('slack'),
  config: z.object({
    /** Incoming Webhook URL from a Slack app. Slack uses URL secrecy, no HMAC. */
    webhookUrl: z.string().url(),
  }),
});

const TeamsChannelSchema = z.object({
  type: z.literal('teams'),
  config: z.object({
    /** Microsoft Teams Incoming Webhook URL. */
    webhookUrl: z.string().url(),
  }),
});

const PagerDutyChannelSchema = z.object({
  type: z.literal('pagerduty'),
  config: z.object({
    /** PagerDuty Events API v2 routing/integration key. */
    routingKey: z.string().min(1),
    /** `critical` | `error` | `warning` | `info`. Defaults to `error`. */
    severity: z.enum(['critical', 'error', 'warning', 'info']).default('error'),
  }),
});

const WebhookChannelSchema = z.object({
  type: z.literal('webhook'),
  config: z.object({
    url: z.string().url(),
    /**
     * HMAC-SHA256 secret. When set, the sender adds
     * `X-Drift-Signature-256: sha256=<hex>` and `X-Drift-Timestamp`
     * to outbound requests. Receivers verify by recomputing
     * `HMAC-SHA256(secret, timestamp + "." + rawBody)`. (arch §14)
     */
    signingSecret: z.string().min(16).optional(),
  }),
});

const EmailChannelSchema = z.object({
  type: z.literal('email'),
  config: z.object({
    to: z.string().email(),
    /** Optional sender override; otherwise taken from server config. */
    from: z.string().email().optional(),
  }),
});

export const AlertChannelSchema = z.discriminatedUnion('type', [
  SlackChannelSchema,
  TeamsChannelSchema,
  PagerDutyChannelSchema,
  WebhookChannelSchema,
  EmailChannelSchema,
]);

export type AlertChannel = z.infer<typeof AlertChannelSchema>;

// ─── rules ──────────────────────────────────────────────────────────────

export const AlertRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  /**
   * Optional suite filter. `null` / absent means the rule applies to
   * every suite ingested into the dashboard.
   */
  suiteId: z.string().min(1).nullable().optional(),
  trigger: AlertTriggerSchema,
  channels: z.array(AlertChannelSchema).min(1),
  enabled: z.boolean().default(true),
  /**
   * Cooldown window in minutes after a fire. The router suppresses
   * subsequent fires for the same `(ruleId, suiteId)` until the window
   * elapses. Default 0 — disabled. The dedupe key remains
   * `(ruleId, runId)` regardless of cooldown (arch §14).
   */
  cooldownMinutes: z.number().int().min(0).max(7 * 24 * 60).default(0),
  createdBy: z.string().min(1).optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});

export type AlertRule = z.infer<typeof AlertRuleSchema>;

// ─── payload (what senders receive) ────────────────────────────────────

const RegressionDetailSchema = z.object({
  caseId: z.string(),
  score: z.number(),
  delta: z.number(),
  threshold: z.number().optional(),
});

export const AlertPayloadSchema = z.object({
  /** Schema version for the outbound payload. Bump on breaking change. */
  version: z.literal(1),
  ruleId: z.string(),
  ruleName: z.string(),
  reason: z.string(),
  runId: z.string(),
  runUrl: z.string().url().optional(),
  suiteId: z.string(),
  provider: z.string(),
  startedAt: z.coerce.date(),
  avgScore: z.number(),
  /** Cases that crossed the rule's regression threshold. */
  regressions: z.array(RegressionDetailSchema),
  /** ISO-8601 string for the moment the router decided to fire. */
  firedAt: z.coerce.date(),
});

export type AlertPayload = z.infer<typeof AlertPayloadSchema>;

// ─── events (router's per-fire record) ─────────────────────────────────

export const ALERT_EVENT_DELIVERY_STATUSES = [
  'pending',
  'delivered',
  'failed',
  'skipped',
] as const;
export type AlertEventDeliveryStatus = (typeof ALERT_EVENT_DELIVERY_STATUSES)[number];

const ChannelDeliverySchema = z.object({
  type: z.enum(['slack', 'teams', 'pagerduty', 'webhook', 'email']),
  status: z.enum(ALERT_EVENT_DELIVERY_STATUSES),
  /** Best-effort error string when status is `failed`. */
  error: z.string().optional(),
  /** Wall-clock ms the sender took. */
  durationMs: z.number().int().min(0).optional(),
});

export type AlertChannelDelivery = z.infer<typeof ChannelDeliverySchema>;

export const AlertEventSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  /** Run that triggered the alert. Cascade-deleted with the run (arch §18, v1.3 B14). */
  runId: z.string().min(1),
  reason: z.string(),
  payload: AlertPayloadSchema,
  /** Per-channel delivery outcomes — populated by the senders, immutable after first write. */
  deliveries: z.array(ChannelDeliverySchema),
  firedAt: z.coerce.date(),
});

export type AlertEvent = z.infer<typeof AlertEventSchema>;

// ─── helpers ────────────────────────────────────────────────────────────

/**
 * Dedupe key for `(rule, run)`. The router uses this to guarantee a
 * given rule fires at most once per run, even if multiple cases in the
 * run trip its predicate. (arch §14, §26)
 */
export function alertDedupeKey(ruleId: string, runId: string): string {
  return `${ruleId}::${runId}`;
}
