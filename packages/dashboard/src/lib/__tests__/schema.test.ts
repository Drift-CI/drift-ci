import { describe, it, expect } from 'vitest';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';

import { alertEvents, alertRules, baselineSnapshots, runs } from '../schema';

function cols(table: PgTable): Record<string, string> {
  const cfg = getTableConfig(table);
  return Object.fromEntries(
    cfg.columns.map((c) => [c.name, c.dataType]),
  );
}

describe('dashboard schema', () => {
  describe('runs', () => {
    it('is named exactly "runs" (matches the 0000_init.sql migration)', () => {
      expect(getTableConfig(runs).name).toBe('runs');
    });

    it('has the ingest columns expected by the M18 receiver', () => {
      const c = cols(runs);
      expect(c).toMatchObject({
        id: 'string',
        suite_id: 'string',
        provider: 'string',
        started_at: 'date',
        completed_at: 'date',
        received_at: 'date',
        retention_days: 'number',
        data: 'json',
      });
    });

    it('indexes suite_id and started_at for the UI queries', () => {
      const idx = getTableConfig(runs).indexes.map((i) => i.config.name);
      expect(idx).toEqual(expect.arrayContaining(['idx_runs_suite', 'idx_runs_started']));
    });
  });

  describe('baseline_snapshots', () => {
    it('is named exactly "baseline_snapshots"', () => {
      expect(getTableConfig(baselineSnapshots).name).toBe('baseline_snapshots');
    });

    it('carries the write-once ledger columns', () => {
      const c = cols(baselineSnapshots);
      expect(c).toMatchObject({
        case_id: 'string',
        run_id: 'string',
        suite_hash: 'string',
        judge_hash: 'string',
        score: 'number',
        redactions: 'json',
        captured_at: 'date',
      });
    });

    it('makes (case_id, run_id) the composite primary key', () => {
      const pks = getTableConfig(baselineSnapshots).primaryKeys;
      expect(pks.length).toBe(1);
      expect(pks[0].columns.map((c) => c.name).sort()).toEqual(['case_id', 'run_id']);
    });

    it('does NOT foreign-key run_id to runs (retention preserves snapshots)', () => {
      // baseline_snapshots outlives runs per arch §18 / v1.3 D3 / B14.
      const fks = getTableConfig(baselineSnapshots).foreignKeys;
      expect(fks).toEqual([]);
    });
  });

  describe('alert_rules (M26)', () => {
    it('is named exactly "alert_rules"', () => {
      expect(getTableConfig(alertRules).name).toBe('alert_rules');
    });

    it('carries the durable rule columns', () => {
      const c = cols(alertRules);
      expect(c).toMatchObject({
        id: 'string',
        name: 'string',
        suite_id: 'string',
        trigger: 'json',
        channels: 'json',
        enabled: 'boolean',
        cooldown_minutes: 'number',
        created_by: 'string',
        created_at: 'date',
        updated_at: 'date',
      });
    });

    it('indexes suite_id and enabled for the router lookup paths', () => {
      const idx = getTableConfig(alertRules).indexes.map((i) => i.config.name);
      expect(idx).toEqual(
        expect.arrayContaining(['idx_alert_rules_suite', 'idx_alert_rules_enabled']),
      );
    });

    it('SET NULLs created_by on user delete (rule outlives author)', () => {
      const fks = getTableConfig(alertRules).foreignKeys;
      const createdByFk = fks.find((fk) =>
        fk.reference().columns.some((c) => c.name === 'created_by'),
      );
      expect(createdByFk).toBeDefined();
      expect(createdByFk?.onDelete).toBe('set null');
    });
  });

  describe('alert_events (M26)', () => {
    it('is named exactly "alert_events"', () => {
      expect(getTableConfig(alertEvents).name).toBe('alert_events');
    });

    it('carries the per-fire ledger columns', () => {
      const c = cols(alertEvents);
      expect(c).toMatchObject({
        id: 'string',
        rule_id: 'string',
        run_id: 'string',
        reason: 'string',
        payload: 'json',
        deliveries: 'json',
        fired_at: 'date',
      });
    });

    it('cascades on rule delete (history dies with the rule)', () => {
      const fks = getTableConfig(alertEvents).foreignKeys;
      const ruleFk = fks.find((fk) =>
        fk.reference().columns.some((c) => c.name === 'rule_id'),
      );
      expect(ruleFk?.onDelete).toBe('cascade');
    });

    it('cascades on run delete (retention sweeps events with their runs — v1.3 B14)', () => {
      const fks = getTableConfig(alertEvents).foreignKeys;
      const runFk = fks.find((fk) =>
        fk.reference().columns.some((c) => c.name === 'run_id'),
      );
      expect(runFk?.onDelete).toBe('cascade');
    });

    it('uniquely constrains (rule_id, run_id) — the dedupe-key safety net', () => {
      const uniques = getTableConfig(alertEvents).uniqueConstraints;
      const ruleRunUq = uniques.find((u) => u.name === 'alert_events_rule_run_unique');
      expect(ruleRunUq).toBeDefined();
      expect(ruleRunUq?.columns.map((c) => c.name).sort()).toEqual(['rule_id', 'run_id']);
    });
  });
});
