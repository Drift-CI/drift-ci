import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  executeInit as executeBaselineInit,
  executeAccept,
  executeDoctor,
  executePrune,
} from '../baseline.js';
import {
  JsonFileStorage,
  type CaseResult,
  type RunResult,
} from '@drift-ci/core';

const SUITE_YAML = `version: 1
id: b-suite
name: Baseline Suite
evaluators:
  - exact-match
cases:
  - id: c1
    input: "q1"
    expected: "a1"
  - id: c2
    input: "q2"
    expected: "a2"
`;

const CONFIG_YAML = `version: 1
provider:
  name: mock
  model: b-model
storage:
  type: json-file
thresholds:
  regression: 0.10
  alert: 0.20
baseline:
  source: branch
concurrency: 2
timeoutMs: 10000
suite: .drift/suite.yaml
`;

interface WorkspacePaths {
  workdir: string;
  runsDir: string;
  baselineDir: string;
  suite: string;
  config: string;
}

function makeCase(id: string, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: id,
    runId: 'run-1',
    output: `a${id.slice(-1)}`,
    score: 1,
    threshold: 0.1,
    latencyMs: 5,
    status: 'pass',
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: 'run-1',
    suiteId: 'b-suite',
    provider: 'mock/b-model',
    startedAt: new Date('2026-04-23T00:00:00Z'),
    completedAt: new Date('2026-04-23T00:00:01Z'),
    cases: [makeCase('c1'), makeCase('c2')],
    summary: {
      total: 2,
      passed: 2,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore: 1,
      avgLatencyMs: 5,
    },
    ...overrides,
  };
}

async function setupWorkspace(run: RunResult = makeRun()): Promise<WorkspacePaths> {
  const workdir = mkdtempSync(join(tmpdir(), 'drift-baseline-'));
  const drift = join(workdir, '.drift');
  mkdirSync(drift, { recursive: true });
  const runsDir = join(drift, 'runs');
  const baselineDir = join(drift, 'baseline');
  const suite = join(drift, 'suite.yaml');
  const config = join(drift, 'config.yaml');
  writeFileSync(suite, SUITE_YAML);
  writeFileSync(config, CONFIG_YAML);
  await new JsonFileStorage(runsDir).saveRun(run);
  return { workdir, runsDir, baselineDir, suite, config };
}

describe('baseline commands', () => {
  let ws: WorkspacePaths;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (ws?.workdir) rmSync(ws.workdir, { recursive: true, force: true });
  });

  describe('executeInit', () => {
    it('writes baseline files for every scoreable case', async () => {
      ws = await setupWorkspace();
      await executeBaselineInit(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
      });
      expect(existsSync(join(ws.baselineDir, 'c1.json'))).toBe(true);
      expect(existsSync(join(ws.baselineDir, 'c2.json'))).toBe(true);
    });

    it('skips cases that already have a baseline unless --force', async () => {
      ws = await setupWorkspace();
      await executeBaselineInit(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
      });
      const firstSnapshot = readFileSync(join(ws.baselineDir, 'c1.json'), 'utf8');
      // Mutate the file so we can tell if it was overwritten.
      writeFileSync(join(ws.baselineDir, 'c1.json'), firstSnapshot.replace(
        /"score":\s*1/,
        '"score": 0.5',
      ));
      await executeBaselineInit(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
      });
      const afterNoForce = readFileSync(join(ws.baselineDir, 'c1.json'), 'utf8');
      expect(afterNoForce).toMatch(/"score":\s*0\.5/);

      await executeBaselineInit(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        force: true,
      });
      const afterForce = readFileSync(join(ws.baselineDir, 'c1.json'), 'utf8');
      expect(afterForce).toMatch(/"score":\s*1/);
    });

    it('skips cases not in the suite and unscored cases', async () => {
      ws = await setupWorkspace(
        makeRun({
          cases: [
            makeCase('c1'),
            makeCase('c2', { score: Number.NaN, status: 'evaluator-error' }),
            makeCase('not-in-suite'),
          ],
        }),
      );
      await executeBaselineInit(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
      });
      expect(existsSync(join(ws.baselineDir, 'c1.json'))).toBe(true);
      expect(existsSync(join(ws.baselineDir, 'c2.json'))).toBe(false);
      expect(existsSync(join(ws.baselineDir, 'not-in-suite.json'))).toBe(false);
    });

    it('throws when there is no prior run', async () => {
      ws = await setupWorkspace();
      rmSync(ws.runsDir, { recursive: true, force: true });
      await expect(
        executeBaselineInit(ws.suite, {
          baselineDir: ws.baselineDir,
          runsDir: ws.runsDir,
          config: ws.config,
        }),
      ).rejects.toThrow(/No runs found/);
    });
  });

  describe('executeAccept', () => {
    it('refuses to run without --all or --cases', async () => {
      ws = await setupWorkspace();
      await expect(
        executeAccept(ws.suite, {
          baselineDir: ws.baselineDir,
          runsDir: ws.runsDir,
          config: ws.config,
        }),
      ).rejects.toThrow(/--all or --cases/);
    });

    it('accepts all cases when --all is set', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        all: true,
      });
      expect(existsSync(join(ws.baselineDir, 'c1.json'))).toBe(true);
      expect(existsSync(join(ws.baselineDir, 'c2.json'))).toBe(true);
    });

    it('accepts only the named cases when --cases is set', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        cases: 'c1',
      });
      expect(existsSync(join(ws.baselineDir, 'c1.json'))).toBe(true);
      expect(existsSync(join(ws.baselineDir, 'c2.json'))).toBe(false);
    });

    it('dry-run reports outcomes without touching disk', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        all: true,
        dryRun: true,
      });
      expect(existsSync(join(ws.baselineDir, 'c1.json'))).toBe(false);
      const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).toMatch(/dry run/);
    });

    it('second accept on the same run is idempotent (unchanged)', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        all: true,
      });
      logSpy.mockClear();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        all: true,
      });
      const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).toMatch(/unchanged/);
    });

    it('reports cases in the selection that are not in the run', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        cases: 'c1,ghost',
      });
      const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).toMatch(/not-in-run\s+ghost/);
    });

    it('empty selection with --cases throws', async () => {
      ws = await setupWorkspace();
      await expect(
        executeAccept(ws.suite, {
          baselineDir: ws.baselineDir,
          runsDir: ws.runsDir,
          config: ws.config,
          cases: '  ,  ',
        }),
      ).rejects.toThrow(/No cases selected/);
    });
  });

  describe('executeDoctor', () => {
    it('reports missing baselines for a fresh workspace', async () => {
      ws = await setupWorkspace();
      await executeDoctor(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
      });
      const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).toMatch(/Missing baselines:\s+2/);
      expect(logs).toMatch(/\bc1\b/);
      expect(logs).toMatch(/\bc2\b/);
    });

    it('reports orphan baselines for cases no longer in the suite', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        all: true,
      });
      // Remove c2 from the suite so the on-disk c2.json is an orphan.
      writeFileSync(ws.suite, `version: 1
id: b-suite
name: Baseline Suite
evaluators:
  - exact-match
cases:
  - id: c1
    input: "q1"
    expected: "a1"
`);
      logSpy.mockClear();
      await executeDoctor(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
      });
      const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).toMatch(/Orphan baselines:\s+1/);
    });

    it('reports stale baselines when the suite hash changes', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        all: true,
      });
      writeFileSync(ws.suite, SUITE_YAML.replace('expected: "a1"', 'expected: "different"'));
      logSpy.mockClear();
      await executeDoctor(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
      });
      const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).toMatch(/Stale baselines:\s+1/);
    });
  });

  describe('executePrune', () => {
    it('deletes orphan baseline files', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        all: true,
      });
      writeFileSync(ws.suite, `version: 1
id: b-suite
name: Baseline Suite
evaluators:
  - exact-match
cases:
  - id: c1
    input: "q1"
    expected: "a1"
`);
      await executePrune(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
      });
      expect(existsSync(join(ws.baselineDir, 'c1.json'))).toBe(true);
      expect(existsSync(join(ws.baselineDir, 'c2.json'))).toBe(false);
    });

    it('dry-run leaves orphans on disk', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        all: true,
      });
      writeFileSync(ws.suite, `version: 1
id: b-suite
name: Baseline Suite
evaluators:
  - exact-match
cases:
  - id: c1
    input: "q1"
    expected: "a1"
`);
      await executePrune(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        dryRun: true,
      });
      expect(existsSync(join(ws.baselineDir, 'c2.json'))).toBe(true);
      const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).toMatch(/would delete\s+c2/);
    });

    it('reports zero orphans when every baseline has a case', async () => {
      ws = await setupWorkspace();
      await executeAccept(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
        all: true,
      });
      logSpy.mockClear();
      await executePrune(ws.suite, {
        baselineDir: ws.baselineDir,
        runsDir: ws.runsDir,
        config: ws.config,
      });
      const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).toMatch(/0 orphan/);
    });
  });
});
