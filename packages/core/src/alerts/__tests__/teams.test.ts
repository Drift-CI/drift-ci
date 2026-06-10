import { describe, it, expect, vi } from 'vitest';

import { TeamsSender, buildTeamsBody } from '../teams.js';
import type { AlertChannel, AlertPayload } from '../../types/alerts.js';

function payload(overrides: Partial<AlertPayload> = {}): AlertPayload {
  return {
    version: 1,
    ruleId: 'r1',
    ruleName: 'Production regressions',
    reason: '2 case(s) regressed by >15.0%',
    runId: 'run-1',
    runUrl: 'https://drift.example.com/runs/run-1',
    suiteId: 'suite-a',
    provider: 'anthropic/claude-sonnet-4-5',
    startedAt: new Date('2026-04-25T11:55:00Z'),
    avgScore: 0.667,
    regressions: [
      { caseId: 'a', score: 0.5, delta: -0.3 },
      { caseId: 'b', score: 0.6, delta: -0.2 },
    ],
    firedAt: new Date('2026-04-25T12:00:00Z'),
    ...overrides,
  };
}

const teamsChannel: AlertChannel = {
  type: 'teams',
  config: { webhookUrl: 'https://outlook.office.com/webhook/abc/IncomingWebhook' },
};

function captureFetch(response = new Response(null, { status: 200 })) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

// ─── sender ─────────────────────────────────────────────────────────────

describe('TeamsSender', () => {
  it('throws when handed a non-teams channel', async () => {
    const sender = new TeamsSender({ fetch: captureFetch().fetch });
    await expect(
      sender.send({ type: 'slack', config: { webhookUrl: 'https://x' } }, payload()),
    ).rejects.toThrow(/non-teams channel/);
  });

  it('POSTs JSON to the configured webhookUrl', async () => {
    const { fetch, calls } = captureFetch();
    const sender = new TeamsSender({ fetch });
    await sender.send(teamsChannel, payload());
    expect(calls[0].url).toBe(teamsChannel.config.webhookUrl);
    expect(calls[0].init?.method).toBe('POST');
  });

  it('throws on non-2xx so the router records failed', async () => {
    const fail = captureFetch(new Response('throttle', { status: 429, statusText: 'Too Many Requests' }));
    const sender = new TeamsSender({ fetch: fail.fetch });
    await expect(sender.send(teamsChannel, payload())).rejects.toThrow(/429/);
  });
});

// ─── card builder ───────────────────────────────────────────────────────

describe('buildTeamsBody', () => {
  it('emits a MessageCard with the schema.org extension context', () => {
    const card = buildTeamsBody(payload());
    expect(card['@type']).toBe('MessageCard');
    expect(card['@context']).toBe('https://schema.org/extensions');
  });

  it('sets a red themeColor to flag a regression alert', () => {
    const card = buildTeamsBody(payload());
    // 6-hex color, no leading '#' (Teams convention).
    expect(card.themeColor).toMatch(/^[0-9A-F]{6}$/);
  });

  it('includes title, text, and summary keyed off rule name + reason', () => {
    const card = buildTeamsBody(payload());
    expect(card.title).toContain('Production regressions');
    expect(card.text).toContain('regressed');
    expect(card.summary).toContain('drift-ci alert');
  });

  it('includes a facts section with suite, provider, avg score, regression count', () => {
    const card = buildTeamsBody(payload());
    const facts = card.sections?.[0]?.facts ?? [];
    const flat = Object.fromEntries(facts.map((f) => [f.name, f.value]));
    expect(flat.Suite).toBe('suite-a');
    expect(flat.Provider).toBe('anthropic/claude-sonnet-4-5');
    expect(flat['Avg score']).toBe('0.667');
    expect(flat.Regressions).toBe('2');
  });

  it('lists per-case regressions in a follow-on section', () => {
    const card = buildTeamsBody(payload());
    const regressionSection = card.sections?.find((s) => s.title === 'Regressed cases');
    expect(regressionSection).toBeDefined();
    expect(regressionSection?.text).toContain('`a`');
    expect(regressionSection?.text).toContain('`b`');
    expect(regressionSection?.text).toMatch(/0\.500/);
    expect(regressionSection?.text).toMatch(/Δ.+-0\.300/);
  });

  it('truncates long regression lists with a "+N more" tail', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      caseId: `case-${i}`,
      score: 0.5,
      delta: -0.2,
    }));
    const card = buildTeamsBody(payload({ regressions: many }), 5);
    const text = card.sections?.find((s) => s.title === 'Regressed cases')?.text ?? '';
    expect(text).toMatch(/_…and 20 more_/);
  });

  it('appends a potentialAction OpenUri when runUrl is set', () => {
    const card = buildTeamsBody(payload());
    expect(card.potentialAction).toBeDefined();
    expect(card.potentialAction?.[0]['@type']).toBe('OpenUri');
    expect(card.potentialAction?.[0].targets[0].uri).toBe(
      'https://drift.example.com/runs/run-1',
    );
  });

  it('omits potentialAction when runUrl is missing', () => {
    const card = buildTeamsBody(payload({ runUrl: undefined }));
    expect(card.potentialAction).toBeUndefined();
  });

  it('omits the regression-list section when regressions are empty', () => {
    const card = buildTeamsBody(payload({ regressions: [] }));
    const hasRegressionSection = card.sections?.some((s) => s.title === 'Regressed cases');
    expect(hasRegressionSection ?? false).toBe(false);
  });
});
