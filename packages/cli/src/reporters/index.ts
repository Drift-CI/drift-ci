import { InkReporter } from './ink.js';
import { JsonReporter } from './json.js';
import { TextReporter } from './text.js';
import type { Reporter, ReporterKind } from './interface.js';

export * from './interface.js';
export { TextReporter, renderSummary } from './text.js';
export { JsonReporter, buildPayload, JSON_REPORTER_SCHEMA_VERSION } from './json.js';
export { InkReporter } from './ink.js';

export interface CreateReporterOptions {
  kind: ReporterKind;
  stdoutIsTty?: boolean;
}

export function createReporter(opts: CreateReporterOptions): Reporter {
  if (opts.kind === 'json') {
    return new JsonReporter();
  }
  if (opts.stdoutIsTty) return new InkReporter();
  return new TextReporter();
}
