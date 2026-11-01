import {
  buildDeltaContext,
  buildIngestContext,
  type DeltaReport,
  type IngestContext,
  type Suite,
} from '@drift-ci/core';

/** The ingest context the action uploads: suite/judge hashes plus the regression verdicts. */
export function actionIngestContext(
  suite: Suite,
  judgeHash: string | undefined,
  deltas: DeltaReport,
): IngestContext {
  return { ...buildIngestContext(suite, judgeHash), delta: buildDeltaContext(deltas) };
}
