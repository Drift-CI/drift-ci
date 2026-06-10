import React, { useEffect, useState } from 'react';
import { Box, Static, Text, render, type Instance } from 'ink';
import type { CaseResult } from '@drift-ci/core';

import type {
  Reporter,
  RunEndContext,
  RunStartContext,
} from './interface.js';
import { renderSummary } from './text.js';

type Subscribe = (cb: (result: CaseResult) => void) => () => void;

interface LiveViewProps {
  total: number;
  subscribe: Subscribe;
}

export function statusColor(status: CaseResult['status']): string {
  switch (status) {
    case 'pass':
      return 'green';
    case 'evaluator-error':
      return 'yellow';
    case 'provider-rate-limit':
    case 'provider-network':
    case 'timeout':
      return 'cyan';
    case 'provider-auth':
      return 'red';
    default:
      return 'white';
  }
}

function CaseRow({ result }: { result: CaseResult }): React.ReactElement {
  const marker = result.status === 'pass' ? '\u2713' : '\u2717';
  const score = Number.isNaN(result.score) ? '\u2014' : result.score.toFixed(3);
  return (
    <Box>
      <Text color={statusColor(result.status)}>{marker} </Text>
      <Text>{result.caseId.padEnd(24)} </Text>
      <Text color="gray">{result.status.padEnd(20)} </Text>
      <Text>score={score}  </Text>
      <Text color="gray">{result.latencyMs}ms</Text>
    </Box>
  );
}

function LiveView({ total, subscribe }: LiveViewProps): React.ReactElement {
  const [completed, setCompleted] = useState<CaseResult[]>([]);
  useEffect(
    () =>
      subscribe((cr) => setCompleted((prev) => [...prev, cr])),
    [subscribe],
  );
  const remaining = total - completed.length;
  return (
    <Box flexDirection="column">
      <Static items={completed}>
        {(cr) => <CaseRow key={cr.caseId} result={cr} />}
      </Static>
      {remaining > 0 && (
        <Box>
          <Text color="gray">
            {'  \u22EF '}
            {completed.length}/{total} complete...
          </Text>
        </Box>
      )}
    </Box>
  );
}

export type InkRenderFn = (
  element: React.ReactElement,
  options: { stdout: NodeJS.WriteStream },
) => Instance;

export interface InkReporterOptions {
  out?: NodeJS.WriteStream;
  render?: InkRenderFn;
}

export class InkReporter implements Reporter {
  private instance?: Instance;
  private readonly listeners: Array<(cr: CaseResult) => void> = [];
  private readonly stream: NodeJS.WriteStream;
  private readonly renderFn: InkRenderFn;

  constructor(opts: InkReporterOptions = {}) {
    this.stream = opts.out ?? process.stdout;
    this.renderFn = opts.render ?? render;
  }

  onRunStart(ctx: RunStartContext): void {
    this.stream.write(
      `drift-ci: running ${ctx.suite.cases.length} case(s) against ${ctx.provider}\n`,
    );
    const subscribe: Subscribe = (cb) => {
      this.listeners.push(cb);
      return () => {
        const i = this.listeners.indexOf(cb);
        if (i >= 0) this.listeners.splice(i, 1);
      };
    };
    this.instance = this.renderFn(
      <LiveView total={ctx.suite.cases.length} subscribe={subscribe} />,
      { stdout: this.stream },
    );
  }

  onCaseComplete(result: CaseResult): void {
    for (const listener of this.listeners) listener(result);
  }

  async onRunEnd(ctx: RunEndContext): Promise<void> {
    if (this.instance) {
      this.instance.unmount();
      await this.instance.waitUntilExit().catch(() => undefined);
      this.instance = undefined;
    }
    renderSummary(ctx, (line) => this.stream.write(line + '\n'));
  }
}
