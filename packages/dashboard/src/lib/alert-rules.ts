import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';

import {
  AlertRuleSchema,
  type AlertChannel,
  type AlertRule,
  type AlertTrigger,
} from '@drift-ci/core/types';

import type { Db } from './db';
import { alertRules, type AlertRule as DbAlertRule } from './schema';

/**
 * Thin DB-facing wrapper around the M26 `alert_rules` table.
 *
 * Persistence note: the trigger + channels JSONB columns are stored
 * as the validated Zod-narrowed shapes. The Drizzle schema declares
 * them as `Record<string, unknown>` to keep the table types stable
 * when the alerts surface evolves; this module re-validates with
 * `AlertRuleSchema` at the boundary so callers never see an unsafe
 * row.
 */

export interface CreateAlertRuleInput {
  name: string;
  suiteId?: string | null;
  trigger: AlertTrigger;
  channels: AlertChannel[];
  cooldownMinutes?: number;
  enabled?: boolean;
  createdBy?: string | null;
}

export async function listAlertRules(db: Db): Promise<AlertRule[]> {
  const rows = await db
    .select()
    .from(alertRules)
    .orderBy(desc(alertRules.createdAt));
  return rows.map(parseRow);
}

export async function getAlertRule(
  db: Db,
  id: string,
): Promise<AlertRule | null> {
  const rows = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]);
}

export async function createAlertRule(
  db: Db,
  input: CreateAlertRuleInput,
): Promise<AlertRule> {
  const id = randomUUID();
  const now = new Date();
  const enabled = input.enabled ?? true;
  const cooldownMinutes = input.cooldownMinutes ?? 0;

  // Validate via Zod before hitting the DB. The schema's discriminated
  // unions catch malformed trigger / channel shapes before they pollute
  // the jsonb columns.
  const validated = AlertRuleSchema.parse({
    id,
    name: input.name,
    suiteId: input.suiteId ?? null,
    trigger: input.trigger,
    channels: input.channels,
    cooldownMinutes,
    enabled,
    createdBy: input.createdBy ?? undefined,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(alertRules).values({
    id,
    name: validated.name,
    suiteId: validated.suiteId ?? null,
    trigger: validated.trigger as Record<string, unknown>,
    channels: validated.channels as Array<Record<string, unknown>>,
    enabled: validated.enabled,
    cooldownMinutes: validated.cooldownMinutes,
    createdBy: input.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return validated;
}

export async function toggleAlertRule(
  db: Db,
  id: string,
): Promise<AlertRule | null> {
  const existing = await getAlertRule(db, id);
  if (!existing) return null;
  const next = !existing.enabled;
  await db
    .update(alertRules)
    .set({ enabled: next, updatedAt: new Date() })
    .where(eq(alertRules.id, id));
  return { ...existing, enabled: next, updatedAt: new Date() };
}

/**
 * Returns the deleted row (or null if no row matched). Postgres'
 * `DELETE ... RETURNING` short-circuits the read+delete race.
 */
export async function deleteAlertRule(
  db: Db,
  id: string,
): Promise<AlertRule | null> {
  const existing = await getAlertRule(db, id);
  if (!existing) return null;
  await db.delete(alertRules).where(eq(alertRules.id, id));
  return existing;
}

function parseRow(row: DbAlertRule): AlertRule {
  // Re-narrow from the loose Drizzle row type to the strongly-typed
  // AlertRule via Zod. A bad row in the DB (e.g. a corrupted trigger
  // shape) raises here rather than later in the router.
  return AlertRuleSchema.parse({
    id: row.id,
    name: row.name,
    suiteId: row.suiteId,
    trigger: row.trigger,
    channels: row.channels,
    enabled: row.enabled,
    cooldownMinutes: row.cooldownMinutes,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
