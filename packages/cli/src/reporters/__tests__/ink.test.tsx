import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import type { Instance } from 'ink';
import { render as inkTestingRender } from 'ink-testing-library';
import type { CaseResult, RunResult, Suite } from '@drift-ci/core';
import { PassThrough } from 'node:stream';

import { InkReporter, statusColor, type InkRenderFn } from '../ink.js';

function makeSuite(caseCount: number): Suite {
  return {
    version: 1,
    id: 's',
    name: 'S',
    cases: Array.from({ length: caseCount }, (_, i) => ({
      id: `c${i}`,
      input: `q${i}`,
      expected: `a${i}`,
    })),
  };
}

function makeResult(id: string, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: id,
    runId: 'r',
    output: 'out',
    score: 1,
    threshold: 0.1,
    latencyMs: 42,
    status: 'pass',
    ...overrides,
  };
}

function makeRun(cases: CaseResult[]): RunResult {
  return {
    id: 'r',
    suiteId: 's',
    provider: 'mock/m',
    startedAt: new Date('2026-04-23T00:00:00Z'),
    completedAt: new Date('2026-04-23T00:00:01Z'),
    cases,
    summary: {
      total: cases.length,
      passed: cases.filter((c) => c.status === 'pass').length,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore: 1,
      avgLatencyMs: 42,
    },
  };
}

function fakeStream(): NodeJS.WriteStream & { captured: string[] } {
  const pt = new PassThrough() as PassThrough & {
    captured: string[];
    columns: number;
    rows: number;
    isTTY: boolean;
  };
  pt.captured = [];
  pt.columns = 80;
  pt.rows = 24;
  pt.isTTY = false;
  const originalWrite = pt.write.bind(pt);
  (pt as unknown as { write: (chunk: unknown) => boolean }).write = (
    chunk: unknown,
  ): boolean => {
    pt.captured.push(
      typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8'),
    );
    return originalWrite(chunk as Buffer | string);
  };
  return pt as unknown as NodeJS.WriteStream & { captured: string[] };
}

function fakeInstance(): Instance & { unmount: ReturnType<typeof vi.fn>; waitUntilExit: ReturnType<typeof vi.fn> } {
  const unmount = vi.fn();
  const waitUntilExit = vi.fn().mockResolvedValue(undefined);
  return {
    unmount,
    waitUntilExit,
    rerender: vi.fn(),
    clear: vi.fn(),
    cleanup: vi.fn(),
  } as unknown as Instance & {
    unmount: ReturnType<typeof vi.fn>;
    waitUntilExit: ReturnType<typeof vi.fn>;
  };
}

describe('statusColor', () => {
  it('maps pass to green', () => {
    expect(statusColor('pass')).toBe('green');
  });

  it('maps evaluator-error to yellow', () => {
    expect(statusColor('evaluator-error')).toBe('yellow');
  });

  it('maps transient network family to cyan', () => {
    expect(statusColor('provider-rate-limit')).toBe('cyan');
    expect(statusColor('provider-network')).toBe('cyan');
    expect(statusColor('timeout')).toBe('cyan');
  });

  it('maps provider-auth to red', () => {
    expect(statusColor('provider-auth')).toBe('red');
  });

  it('falls back to white for unknown statuses', () => {
    expect(
      statusColor('something-else' as unknown as CaseResult['status']),
    ).toBe('white');
  });
});

describe('InkReporter', () => {
  it('writes the run-start header to its stream', async () => {
    const out = fakeStream();
    const instance = fakeInstance();
    const renderFn = vi.fn(() => instance) as unknown as InkRenderFn;
    const reporter = new InkReporter({ out, render: renderFn });
    reporter.onRunStart({ suite: makeSuite(2), provider: 'mock/m' });
    expect(out.captured.join('')).toMatch(/running 2 case\(s\) against mock\/m/);
    expect(renderFn).toHaveBeenCalledTimes(1);
    await reporter.onRunEnd({
      suite: makeSuite(2),
      run: makeRun([makeResult('c0'), makeResult('c1')]),
      deltas: null,
      loaded: { config: {} as never, notice: undefined },
    });
    expect(instance.unmount).toHaveBeenCalled();
    expect(instance.waitUntilExit).toHaveBeenCalled();
  });

  it('delegates final summary writing to renderSummary', async () => {
    const out = fakeStream();
    const reporter = new InkReporter({ out, render: vi.fn(() => fakeInstance()) as unknown as InkRenderFn });
    const suite = makeSuite(2);
    reporter.onRunStart({ suite, provider: 'mock/m' });
    const c0 = makeResult('c0');
    const c1 = makeResult('c1', { status: 'evaluator-error', score: Number.NaN });
    reporter.onCaseComplete(c0);
    reporter.onCaseComplete(c1);

    await reporter.onRunEnd({
      suite,
      run: makeRun([c0, c1]),
      deltas: null,
      loaded: { config: {} as never, notice: undefined },
    });

    const captured = out.captured.join('');
    expect(captured).toMatch(/Suite:/);
    expect(captured).toMatch(/Cases:/);
  });

  it('swallows waitUntilExit rejection', async () => {
    const instance = fakeInstance();
    instance.waitUntilExit.mockRejectedValueOnce(new Error('boom'));
    const reporter = new InkReporter({
      out: fakeStream(),
      render: vi.fn(() => instance) as unknown as InkRenderFn,
    });
    reporter.onRunStart({ suite: makeSuite(1), provider: 'mock/m' });
    await expect(
      reporter.onRunEnd({
        suite: makeSuite(1),
        run: makeRun([makeResult('c0')]),
        deltas: null,
        loaded: { config: {} as never, notice: undefined },
      }),
    ).resolves.toBeUndefined();
  });

  it('onCaseComplete after onRunEnd is a safe no-op', async () => {
    const reporter = new InkReporter({
      out: fakeStream(),
      render: vi.fn(() => fakeInstance()) as unknown as InkRenderFn,
    });
    reporter.onRunStart({ suite: makeSuite(1), provider: 'mock/m' });
    await reporter.onRunEnd({
      suite: makeSuite(1),
      run: makeRun([makeResult('c0')]),
      deltas: null,
      loaded: { config: {} as never, notice: undefined },
    });
    expect(() => reporter.onCaseComplete(makeResult('late'))).not.toThrow();
  });

  it('defaults to process.stdout when no stream is provided', () => {
    const reporter = new InkReporter({ render: vi.fn(() => fakeInstance()) as unknown as InkRenderFn });
    // Invoke onRunStart with suite of size 0 so we only check stream selection.
    // Writing to stdout during tests is captured by vitest's stdout spy
    // mechanism; we just ensure it doesn't throw.
    expect(() =>
      reporter.onRunStart({ suite: makeSuite(0), provider: 'mock/m' }),
    ).not.toThrow();
  });
});

describe('LiveView (via ink-testing-library)', () => {
  function renderCapturedTree(total: number): {
    element: React.ReactElement;
    subscribe: (cb: (r: CaseResult) => void) => () => void;
    listeners: ((r: CaseResult) => void)[];
  } {
    const listeners: ((r: CaseResult) => void)[] = [];
    const subscribe = (cb: (r: CaseResult) => void): (() => void) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    };
    let captured: React.ReactElement | null = null;
    const renderFn: InkRenderFn = (element) => {
      captured = element;
      return fakeInstance();
    };
    const reporter = new InkReporter({ out: fakeStream(), render: renderFn });
    // Overwrite the private subscribe path by hijacking onRunStart: we
    // call render() ourselves with a controllable subscribe.
    reporter.onRunStart({ suite: makeSuite(total), provider: 'mock/m' });
    return { element: captured!, subscribe, listeners };
  }

  it('shows the progress counter on initial render', () => {
    const { element } = renderCapturedTree(3);
    const { lastFrame, unmount } = inkTestingRender(element);
    try {
      expect(lastFrame()).toMatch(/0\/3 complete/);
    } finally {
      unmount();
    }
  });

  it('streams case rows as the subscribe callback fires', async () => {
    const listeners: ((r: CaseResult) => void)[] = [];
    const subscribe = (cb: (r: CaseResult) => void): (() => void) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    };
    // Build the LiveView element by capturing from InkReporter, then
    // swap its subscribe prop. Simpler: render a fresh element where
    // we pick the subscribe directly. Grab the component from the tree.
    let captured: React.ReactElement | null = null;
    const renderFn: InkRenderFn = (element) => {
      captured = element;
      return fakeInstance();
    };
    const reporter = new InkReporter({ out: fakeStream(), render: renderFn });
    reporter.onRunStart({ suite: makeSuite(2), provider: 'mock/m' });
    const Element = captured!;
    // Replace the captured element's subscribe prop with our controllable one.
    const props = { ...(Element.props as object), subscribe };
    const replaced = React.cloneElement(Element, props);

    const { lastFrame, rerender, unmount } = inkTestingRender(replaced);
    try {
      // useEffect fires on the microtask queue after mount — give it a tick.
      await new Promise((r) => setImmediate(r));
      expect(listeners).toHaveLength(1);
      expect(lastFrame()).toMatch(/0\/2 complete/);
      listeners[0](makeResult('c0'));
      rerender(replaced);
      await new Promise((r) => setImmediate(r));
      expect(lastFrame()).toMatch(/c0/);
      listeners[0](
        makeResult('c1', { status: 'provider-rate-limit', score: Number.NaN }),
      );
      rerender(replaced);
      await new Promise((r) => setImmediate(r));
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/c1/);
      // Score Number.NaN renders as the em-dash fallback.
      expect(frame).toMatch(/—/);
    } finally {
      unmount();
    }
  });

  it('unsubscribes listener cleanup when LiveView unmounts', async () => {
    const listeners: ((r: CaseResult) => void)[] = [];
    const subscribe = (cb: (r: CaseResult) => void): (() => void) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    };
    let captured: React.ReactElement | null = null;
    const renderFn: InkRenderFn = (element) => {
      captured = element;
      return fakeInstance();
    };
    const reporter = new InkReporter({ out: fakeStream(), render: renderFn });
    reporter.onRunStart({ suite: makeSuite(1), provider: 'mock/m' });
    const element = React.cloneElement(captured!, {
      ...(captured!.props as object),
      subscribe,
    });
    const { unmount } = inkTestingRender(element);
    await new Promise((r) => setImmediate(r));
    expect(listeners).toHaveLength(1);
    unmount();
    await new Promise((r) => setImmediate(r));
    expect(listeners).toHaveLength(0);
  });
});
