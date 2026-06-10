import type { DeltaReport } from '../engine/baseline.js';
import type { RunResult } from '../types/result.js';
import type {
  AlertChannel,
  AlertChannelDelivery,
  AlertPayload,
  AlertRule,
  AlertTrigger,
} from '../types/alerts.js';
import type { AlertSender } from './base.js';

/**
 * Router for the Phase 4 alert pipeline. Pure as far as practical:
 * the router takes in a fully-realised `RunResult` + `DeltaReport`
 * and a list of rules, and returns a `RouterResult` describing
 * what would (or did) fire. Persistence — writing `alert_events`
 * rows, recording `lastFiredAt`, etc. — is the caller's job.
 *
 * The router enforces two correctness invariants:
 *
 * 1. **Dedupe.** Within one `evaluate()` call each rule yields at most
 *    one decision. Across calls, the DB-level UNIQUE constraint on
 *    `alert_events (rule_id, run_id)` is the authoritative dedupe (M26).
 *    The router cannot guarantee this on its own — a caller invoking
 *    `evaluate()` twice with the same run is a bug, but the DB will
 *    catch it.
 *
 * 2. **Cooldown.** Caller passes `lastFiredAt: Map<ruleId, Date>` —
 *    pulled from `alert_events` for the rules involved. Rules whose
 *    last fire was within `cooldownMinutes` are skipped with the
 *    `cooldown` outcome. A 0-minute cooldown disables the check.
 *
 * `provider-divergence` and `schedule` triggers are intentionally
 *  skipped here — both require inputs beyond a single `RunResult`.
 *  Schedule alerts fire from a cron path (Phase 4 M29 weekly digest);
 *  provider-divergence fires from the `compare` CLI command (M33).
 */

const MS_PER_MINUTE = 60_000;
const PAYLOAD_VERSION = 1 as const;

// ─── public types ───────────────────────────────────────────────────────

export type RouterOutcome =
  | 'fire'
  | 'disabled'
  | 'suite-mismatch'
  | 'cooldown'
  | 'no-match'
  | 'unsupported-trigger';

export interface RouterDecision {
  ruleId: string;
  outcome: RouterOutcome;
  /** Free-text explanation. For `fire`: the trigger reason that goes onto the payload. */
  reason?: string;
  /** Populated only when outcome === 'fire'. */
  payload?: AlertPayload;
  /** Per-channel delivery outcomes. Populated only when outcome === 'fire'. */
  deliveries?: AlertChannelDelivery[];
}

export interface RouterResult {
  /** One entry per rule fed in, regardless of outcome. */
  decisions: RouterDecision[];
  /** Convenience: just the decisions whose outcome is `fire`. */
  fired: RouterDecision[];
}

export interface RouterEvaluateInput {
  run: RunResult;
  deltas: DeltaReport;
  rules: AlertRule[];
  /** Most-recent fire time per ruleId (for cooldown). Caller pulls from alert_events. */
  lastFiredAt?: Map<string, Date>;
  /** Override for "now". Defaults to `new Date()` at call time. */
  now?: Date;
  /**
   * Optional builder for the `runUrl` field on the payload — typically
   * `(run) => `${dashboardBase}/runs/${run.id}``. Senders use this to
   * link back to the dashboard.
   */
  runUrlBuilder?: (run: RunResult) => string;
}

// ─── router ─────────────────────────────────────────────────────────────

export class AlertRouter {
  /**
   * @param senders Map keyed by `AlertChannel.type`. Channels whose type
   *                has no registered sender record a `skipped` delivery
   *                with `error: 'no-sender'` rather than throwing —
   *                desired so a partial channel registry (e.g. Slack
   *                works, PagerDuty key not yet configured) doesn't
   *                drop the channels that DO work.
   */
  constructor(private readonly senders: Map<string, AlertSender>) {}

  async evaluate(input: RouterEvaluateInput): Promise<RouterResult> {
    const now = input.now ?? new Date();
    const decisions: RouterDecision[] = [];

    for (const rule of input.rules) {
      decisions.push(await this.evaluateRule(rule, input, now));
    }

    return {
      decisions,
      fired: decisions.filter((d) => d.outcome === 'fire'),
    };
  }

  private async evaluateRule(
    rule: AlertRule,
    input: RouterEvaluateInput,
    now: Date,
  ): Promise<RouterDecision> {
    if (!rule.enabled) {
      return { ruleId: rule.id, outcome: 'disabled' };
    }
    if (rule.suiteId && rule.suiteId !== input.run.suiteId) {
      return {
        ruleId: rule.id,
        outcome: 'suite-mismatch',
        reason: `rule scoped to suite ${rule.suiteId}, run is for ${input.run.suiteId}`,
      };
    }

    const cooldown = checkCooldown(rule, input.lastFiredAt, now);
    if (cooldown) return cooldown;

    const reason = checkTrigger(rule.trigger, input);
    if (reason === null) {
      return { ruleId: rule.id, outcome: 'no-match' };
    }
    if ('unsupported' in reason) {
      return {
        ruleId: rule.id,
        outcome: 'unsupported-trigger',
        reason: reason.unsupported,
      };
    }

    const payload = buildPayload(rule, input, reason.matched, now);
    const deliveries = await this.dispatch(rule.channels, payload);

    return {
      ruleId: rule.id,
      outcome: 'fire',
      reason: reason.matched,
      payload,
      deliveries,
    };
  }

  private async dispatch(
    channels: AlertChannel[],
    payload: AlertPayload,
  ): Promise<AlertChannelDelivery[]> {
    return Promise.all(
      channels.map(async (channel): Promise<AlertChannelDelivery> => {
        const sender = this.senders.get(channel.type);
        if (!sender) {
          return { type: channel.type, status: 'skipped', error: 'no-sender' };
        }
        const start = Date.now();
        try {
          await sender.send(channel, payload);
          return {
            type: channel.type,
            status: 'delivered',
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            type: channel.type,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - start,
          };
        }
      }),
    );
  }
}

// ─── private helpers (exported for tests where useful) ──────────────────

function checkCooldown(
  rule: AlertRule,
  lastFiredAt: Map<string, Date> | undefined,
  now: Date,
): RouterDecision | null {
  if (rule.cooldownMinutes <= 0) return null;
  const last = lastFiredAt?.get(rule.id);
  if (!last) return null;
  const elapsedMs = now.getTime() - last.getTime();
  const windowMs = rule.cooldownMinutes * MS_PER_MINUTE;
  if (elapsedMs >= windowMs) return null;
  const remainingSec = Math.ceil((windowMs - elapsedMs) / 1000);
  return {
    ruleId: rule.id,
    outcome: 'cooldown',
    reason: `cooldown ${rule.cooldownMinutes}m active; ${remainingSec}s remaining`,
  };
}

type TriggerVerdict =
  | { matched: string; unsupported?: never }
  | { matched?: never; unsupported: string };

function checkTrigger(
  trigger: AlertTrigger,
  input: RouterEvaluateInput,
): TriggerVerdict | null {
  switch (trigger.type) {
    case 'regression-threshold': {
      const matches = regressionsBelow(input.deltas, trigger.threshold, trigger.caseId);
      if (matches.length === 0) return null;
      const pct = (trigger.threshold * 100).toFixed(1);
      const scope = trigger.caseId ? ` for case ${trigger.caseId}` : '';
      return {
        matched: `${matches.length} case(s) regressed by >${pct}%${scope}`,
      };
    }

    case 'avg-score-drop': {
      const baselineAvg = baselineAvgFromDeltas(input.run, input.deltas);
      if (baselineAvg === null) return null;
      const drop = baselineAvg - input.run.summary.avgScore;
      if (drop <= trigger.threshold) return null;
      return {
        matched: `Average score dropped by ${(drop * 100).toFixed(1)}% (${baselineAvg.toFixed(3)} → ${input.run.summary.avgScore.toFixed(3)})`,
      };
    }

    case 'provider-divergence':
      return {
        unsupported:
          'provider-divergence trigger requires the `compare` CLI; not evaluated for single-run alerts',
      };

    case 'schedule':
      return {
        unsupported:
          'schedule trigger fires from the cron path, not from per-run evaluation',
      };
  }
}

/**
 * Cases whose `delta < -threshold` and that have a real baseline. Cases
 * marked NaN ("noScore") or missing baselines are excluded — evaluator
 * errors must never surface as alerts (arch §6).
 */
function regressionsBelow(
  deltas: DeltaReport,
  threshold: number,
  caseFilter: string | undefined,
): Array<{ caseId: string; delta: number }> {
  const excluded = new Set([
    ...deltas.noScore,
    ...deltas.missingBaselines,
    ...deltas.staleBaselines,
  ]);
  return Object.entries(deltas.deltas)
    .filter(([caseId, delta]) => {
      if (caseFilter && caseId !== caseFilter) return false;
      if (excluded.has(caseId)) return false;
      return -delta > threshold;
    })
    .map(([caseId, delta]) => ({ caseId, delta }));
}

/**
 * Derive `baselineAvgScore` from the run + deltas without reaching
 * into the baseline store. For cases with a baseline,
 * `baselineScore = currentScore - delta`. We average across only the
 * cases that have one — `noScore` and `missingBaselines` are excluded.
 * Returns `null` when no case has a baseline (whole-suite no-baselines
 * means the avg-score-drop trigger has nothing to compare against).
 */
function baselineAvgFromDeltas(
  run: RunResult,
  deltas: DeltaReport,
): number | null {
  const skip = new Set([...deltas.noScore, ...deltas.missingBaselines]);
  const baselined: number[] = [];
  for (const c of run.cases) {
    if (skip.has(c.caseId)) continue;
    const delta = deltas.deltas[c.caseId];
    if (delta === undefined || Number.isNaN(c.score)) continue;
    baselined.push(c.score - delta);
  }
  if (baselined.length === 0) return null;
  return baselined.reduce((s, v) => s + v, 0) / baselined.length;
}

function buildPayload(
  rule: AlertRule,
  input: RouterEvaluateInput,
  reason: string,
  now: Date,
): AlertPayload {
  const trigger = rule.trigger;
  const threshold = trigger.type === 'schedule' ? undefined : trigger.threshold;
  const regressionDetails = Object.entries(input.deltas.deltas)
    .filter(([caseId, delta]) => {
      if (input.deltas.noScore.includes(caseId)) return false;
      if (input.deltas.missingBaselines.includes(caseId)) return false;
      if (input.deltas.staleBaselines.includes(caseId)) return false;
      return threshold !== undefined ? -delta > threshold : false;
    })
    .map(([caseId, delta]) => {
      const c = input.run.cases.find((x) => x.caseId === caseId);
      return {
        caseId,
        score: c?.score ?? 0,
        delta,
        threshold,
      };
    });

  return {
    version: PAYLOAD_VERSION,
    ruleId: rule.id,
    ruleName: rule.name,
    reason,
    runId: input.run.id,
    runUrl: input.runUrlBuilder?.(input.run),
    suiteId: input.run.suiteId,
    provider: input.run.provider,
    startedAt: input.run.startedAt,
    avgScore: input.run.summary.avgScore,
    regressions: regressionDetails,
    firedAt: now,
  };
}
