import { describe, it, expect, vi } from 'vitest';

import {
  EmailSender,
  buildEmailMessage,
  type EmailMessage,
  type EmailTransport,
} from '../email.js';
import type { AlertChannel, AlertPayload } from '../../types/alerts.js';

function payload(overrides: Partial<AlertPayload> = {}): AlertPayload {
  return {
    version: 1,
    ruleId: 'rule-1',
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

const emailChannel: AlertChannel = {
  type: 'email',
  config: { to: 'oncall@example.com' },
};

class CapturingTransport implements EmailTransport {
  messages: EmailMessage[] = [];
  send = vi.fn(async (m: EmailMessage) => {
    this.messages.push(m);
  });
}

class FailingTransport implements EmailTransport {
  send = vi.fn(async () => {
    throw new Error('SMTP connection refused');
  });
}

// ─── sender ─────────────────────────────────────────────────────────────

describe('EmailSender', () => {
  it('throws when handed a non-email channel', async () => {
    const sender = new EmailSender({ transport: new CapturingTransport() });
    await expect(
      sender.send({ type: 'slack', config: { webhookUrl: 'https://x' } }, payload()),
    ).rejects.toThrow(/non-email channel/);
  });

  it('throws with a useful message when no transport is configured', async () => {
    const sender = new EmailSender();
    await expect(sender.send(emailChannel, payload())).rejects.toThrow(/no transport configured/);
  });

  it('hands a fully-formed EmailMessage to the transport', async () => {
    const transport = new CapturingTransport();
    const sender = new EmailSender({ transport });
    await sender.send(emailChannel, payload());
    expect(transport.messages).toHaveLength(1);
    const m = transport.messages[0];
    expect(m.to).toBe('oncall@example.com');
    expect(m.subject).toContain('drift-ci');
    expect(m.text).toContain('Production regressions');
    expect(m.html).toContain('Production regressions');
  });

  it('uses defaultFrom when channel.config.from is unset', async () => {
    const transport = new CapturingTransport();
    const sender = new EmailSender({
      transport,
      defaultFrom: 'drift-ci <alerts@drift.example.com>',
    });
    await sender.send(emailChannel, payload());
    expect(transport.messages[0].from).toBe('drift-ci <alerts@drift.example.com>');
  });

  it('honours channel.config.from over defaultFrom', async () => {
    const transport = new CapturingTransport();
    const sender = new EmailSender({
      transport,
      defaultFrom: 'fallback@example.com',
    });
    await sender.send(
      {
        type: 'email',
        config: { to: 'oncall@example.com', from: 'specific@example.com' },
      },
      payload(),
    );
    expect(transport.messages[0].from).toBe('specific@example.com');
  });

  it('propagates transport failures so the router records failed', async () => {
    const sender = new EmailSender({ transport: new FailingTransport() });
    await expect(sender.send(emailChannel, payload())).rejects.toThrow(/SMTP connection refused/);
  });
});

// ─── message builder ────────────────────────────────────────────────────

describe('buildEmailMessage', () => {
  it('builds a concise subject keyed off rule name + reason', () => {
    const m = buildEmailMessage(payload(), 'oncall@example.com', undefined);
    expect(m.subject).toBe('[drift-ci] Production regressions: 2 case(s) regressed by >15.0%');
  });

  it('always emits both text and html bodies', () => {
    const m = buildEmailMessage(payload(), 'oncall@example.com', undefined);
    expect(m.text.length).toBeGreaterThan(0);
    expect(m.html?.length).toBeGreaterThan(0);
  });

  it('text body includes the suite/provider/avg/regression-count facts', () => {
    const m = buildEmailMessage(payload(), 'oncall@example.com', undefined);
    expect(m.text).toContain('Suite:');
    expect(m.text).toContain('suite-a');
    expect(m.text).toContain('Provider:');
    expect(m.text).toContain('anthropic/claude-sonnet-4-5');
    expect(m.text).toContain('Avg score:');
    expect(m.text).toContain('0.667');
    expect(m.text).toContain('Regressions:');
  });

  it('text body lists each regression with caseId, score, delta', () => {
    const m = buildEmailMessage(payload(), 'oncall@example.com', undefined);
    expect(m.text).toMatch(/^ {2}- a: 0\.500 \(Δ -0\.300\)$/m);
    expect(m.text).toMatch(/^ {2}- b: 0\.600 \(Δ -0\.200\)$/m);
  });

  it('truncates long regression lists with a "+N more" tail', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      caseId: `case-${i}`,
      score: 0.5,
      delta: -0.2,
    }));
    const m = buildEmailMessage(payload({ regressions: many }), 'x@example.com', undefined, 5);
    expect(m.text).toMatch(/…and 55 more/);
  });

  it('includes the run URL footer when set', () => {
    const m = buildEmailMessage(payload(), 'oncall@example.com', undefined);
    expect(m.text).toContain('View run: https://drift.example.com/runs/run-1');
    expect(m.html).toContain('href="https://drift.example.com/runs/run-1"');
  });

  it('omits the run URL footer when missing', () => {
    const m = buildEmailMessage(payload({ runUrl: undefined }), 'oncall@example.com', undefined);
    expect(m.text).not.toContain('View run:');
    expect(m.html ?? '').not.toContain('View run');
  });

  it('escapes HTML-significant characters in user-controlled fields', () => {
    const m = buildEmailMessage(
      payload({
        ruleName: 'Inj <script>alert(1)</script>',
        reason: 'A & B',
        regressions: [{ caseId: '<x>', score: 0.5, delta: -0.3 }],
      }),
      'x@example.com',
      undefined,
    );
    expect(m.html).not.toContain('<script>alert');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('A &amp; B');
    expect(m.html).toContain('&lt;x&gt;');
  });
});
