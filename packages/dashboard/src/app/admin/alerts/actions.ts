'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import type { AlertChannel, AlertTrigger } from '@drift-ci/core/types';

import {
  createAlertRule,
  deleteAlertRule,
  toggleAlertRule,
} from '@/lib/alert-rules';
import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/require-session';

const PATH = '/admin/alerts';

/**
 * Create a rule from the `/admin/alerts` form. Form scope:
 *
 *  - `regression-threshold` trigger only (the most common). Other
 *    trigger types are addable via the API for now; the UI form
 *    keeps things tractable until M32b extends it.
 *  - One channel at a time. Multi-channel rules go through the API.
 *
 * The Zod schema in `lib/alert-rules.ts` does the heavy validation;
 * this action's job is to translate FormData into that schema's
 * shape and surface clear redirect-with-error states for bad input.
 */
export async function createRuleAction(formData: FormData): Promise<void> {
  const session = await requireSession({ targetPath: PATH, role: 'admin' });
  if (session.userId === 'bootstrap') {
    redirect(`${PATH}?error=bootstrap-no-create`);
  }

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name || name.length > 200) {
    redirect(`${PATH}?error=bad-name`);
  }

  const suiteIdRaw = (formData.get('suiteId') as string | null)?.trim() ?? '';
  const suiteId = suiteIdRaw === '' ? null : suiteIdRaw;

  const thresholdStr = (formData.get('threshold') as string | null) ?? '';
  const threshold = Number.parseFloat(thresholdStr);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    redirect(`${PATH}?error=bad-threshold`);
  }

  const cooldownStr = (formData.get('cooldownMinutes') as string | null) ?? '0';
  const cooldownMinutes = Number.parseInt(cooldownStr, 10);
  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 0) {
    redirect(`${PATH}?error=bad-cooldown`);
  }

  const trigger: AlertTrigger = {
    type: 'regression-threshold',
    threshold,
  };

  const channelType = (formData.get('channelType') as string | null) ?? '';
  const channel = parseChannel(channelType, formData);
  if (!channel) {
    redirect(`${PATH}?error=bad-channel`);
  }

  const db = getDb();
  let createdId: string;
  try {
    const rule = await createAlertRule(db, {
      name,
      suiteId,
      trigger,
      channels: [channel],
      cooldownMinutes,
      enabled: true,
      createdBy: session.userId,
    });
    createdId = rule.id;
  } catch {
    /* c8 ignore next 2 -- Zod errors get a generic redirect; logs surface the detail. */
    redirect(`${PATH}?error=invalid`);
  }

  await recordAudit(db, {
    userId: session.userId,
    kind: AUDIT_KINDS.ALERT_RULE_CREATED,
    target: createdId,
    data: {
      name,
      triggerType: 'regression-threshold',
      threshold,
      channelType: channel.type,
      via: 'admin-ui',
    },
  });

  revalidatePath(PATH);
  redirect(`${PATH}?created=${encodeURIComponent(name)}`);
}

export async function toggleRuleAction(formData: FormData): Promise<void> {
  const session = await requireSession({ targetPath: PATH, role: 'admin' });
  const id = (formData.get('id') as string | null) ?? '';
  if (!id) redirect(`${PATH}?error=bad-id`);

  const db = getDb();
  const updated = await toggleAlertRule(db, id);
  if (updated) {
    await recordAudit(db, {
      userId: session.userId,
      kind: AUDIT_KINDS.ALERT_RULE_TOGGLED,
      target: id,
      data: { enabled: updated.enabled, via: 'admin-ui' },
    });
  }

  revalidatePath(PATH);
  redirect(`${PATH}?toggled=${id}`);
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const session = await requireSession({ targetPath: PATH, role: 'admin' });
  const id = (formData.get('id') as string | null) ?? '';
  if (!id) redirect(`${PATH}?error=bad-id`);

  const db = getDb();
  const removed = await deleteAlertRule(db, id);
  if (removed) {
    await recordAudit(db, {
      userId: session.userId,
      kind: AUDIT_KINDS.ALERT_RULE_DELETED,
      target: id,
      data: { name: removed.name, via: 'admin-ui' },
    });
  }

  revalidatePath(PATH);
  redirect(`${PATH}?deleted=1`);
}

// ─── helpers ────────────────────────────────────────────────────────────

function parseChannel(
  type: string,
  formData: FormData,
): AlertChannel | null {
  const url = (formData.get('channelUrl') as string | null)?.trim() ?? '';
  switch (type) {
    case 'slack': {
      if (!url) return null;
      return { type: 'slack', config: { webhookUrl: url } };
    }
    case 'teams': {
      if (!url) return null;
      return { type: 'teams', config: { webhookUrl: url } };
    }
    case 'webhook': {
      if (!url) return null;
      const secret =
        (formData.get('signingSecret') as string | null)?.trim() || undefined;
      return {
        type: 'webhook',
        config: { url, ...(secret ? { signingSecret: secret } : {}) },
      };
    }
    case 'pagerduty': {
      const routingKey =
        (formData.get('routingKey') as string | null)?.trim() ?? '';
      if (!routingKey) return null;
      const severity =
        (formData.get('severity') as string | null)?.trim() ?? 'error';
      if (
        severity !== 'critical' &&
        severity !== 'error' &&
        severity !== 'warning' &&
        severity !== 'info'
      ) {
        return null;
      }
      return {
        type: 'pagerduty',
        config: { routingKey, severity },
      };
    }
    case 'email': {
      const to = (formData.get('emailTo') as string | null)?.trim() ?? '';
      if (!to) return null;
      return { type: 'email', config: { to } };
    }
    default:
      return null;
  }
}
