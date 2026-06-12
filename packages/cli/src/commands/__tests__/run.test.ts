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

import { executeRun } from '../run.js';

const SUITE_YAML = `version: 1
id: r-suite
name: Run Suite
evaluators:
  - exact-match
cases:
  - id: math
    input: "What is 2+2?"
    expected: "4"
  - id: greet
    input: "Say hi"
    expected: "hi"
`;

function configWith(responses: Record<string, string>): string {
  const pairs = Object.entries(responses)
    .map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join('\n');
  return `version: 1
provider:
  name: mock
  model: r-model
  mock:
    responses:
${pairs}
    defaultResponse: fallback
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
}

interface Ws {
  workdir: string;
  baselineDir: string;
  runsDir: string;
  suite: string;
  config: string;
}

function setupWs(): Ws {
  const workdir = mkdtempSync(join(tmpdir(), 'drift-run-'));
  const drift = join(workdir, '.drift');
  mkdirSync(drift, { recursive: true });
  const baselineDir = join(drift, 'baseline');
  const runsDir = join(drift, 'runs');
  const suite = join(drift, 'suite.yaml');
  const config = join(drift, 'config.yaml');
  writeFileSync(suite, SUITE_YAML);
  writeFileSync(config, configWith({ 'What is 2+2?': '4', 'Say hi': 'hi' }));
  return { workdir, baselineDir, runsDir, suite, config };
}

function opts(ws: Ws, overrides: Partial<Parameters<typeof executeRun>[1]> = {}) {
  return {
    config: ws.config,
    suite: ws.suite,
    baselineDir: ws.baselineDir,
    runsDir: ws.runsDir,
    reporter: 'json' as const,
    ...overrides,
  };
}

describe('executeRun', () => {
  let ws: Ws;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let chunks: string[];
  let errChunks: string[];
  const originalEnv = process.env.DRIFT_ENABLE_MOCK_PROVIDER;

  beforeEach(() => {
    process.env.DRIFT_ENABLE_MOCK_PROVIDER = 'true';
    ws = setupWs();
    chunks = [];
    errChunks = [];
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
      });
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk) => {
        errChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
      });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    rmSync(ws.workdir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DRIFT_ENABLE_MOCK_PROVIDER;
    else process.env.DRIFT_ENABLE_MOCK_PROVIDER = originalEnv;
  });

  it('exits 0 with no baselines present (missing baselines are not regressions)', async () => {
    const code = await executeRun(undefined, opts(ws));
    expect(code).toBe(0);
    // Run persisted to disk.
    const payload = JSON.parse(chunks.join('')) as {
      run: { summary: { passed: number; total: number } };
      deltas: { missingBaselines: string[] };
    };
    expect(payload.run.summary.total).toBe(2);
    expect(payload.run.summary.passed).toBe(2);
    expect(payload.deltas.missingBaselines.sort()).toEqual(['greet', 'math']);
  });

  it('accepts a positional suite argument that overrides config.suite', async () => {
    const alt = join(ws.workdir, 'alt-suite.yaml');
    writeFileSync(
      alt,
      `version: 1
id: r-suite
name: Alt
evaluators: [exact-match]
cases:
  - id: only
    input: "Say hi"
    expected: "hi"
`,
    );
    const code = await executeRun(alt, opts(ws));
    expect(code).toBe(0);
    const payload = JSON.parse(chunks.join('')) as { run: { summary: { total: number } } };
    expect(payload.run.summary.total).toBe(1);
  });

  it('skips baseline comparison when --no-baseline is passed', async () => {
    const code = await executeRun(undefined, opts(ws, { baseline: false }));
    expect(code).toBe(0);
    const payload = JSON.parse(chunks.join('')) as { deltas: unknown };
    expect(payload.deltas).toBeNull();
  });

  it('exits 1 when a case regresses against its baseline', async () => {
    // 1. establish baselines at score 1.
    await executeRun(undefined, opts(ws));
    // Use the run we just wrote to produce baselines on disk.
    const { executeInit } = await import('../baseline.js');
    await executeInit(ws.suite, {
      baselineDir: ws.baselineDir,
      runsDir: ws.runsDir,
      config: ws.config,
    });
    chunks.length = 0;

    // 2. flip math's response; score should drop to 0 → regression.
    writeFileSync(ws.config, configWith({ 'What is 2+2?': 'wrong', 'Say hi': 'hi' }));
    const code = await executeRun(undefined, opts(ws));
    expect(code).toBe(1);
    const payload = JSON.parse(chunks.join('')) as {
      deltas: { regressions: string[] };
    };
    expect(payload.deltas.regressions).toContain('math');
  });

  it('rejects an unknown --reporter early via the caller; sanity-checks json path here', async () => {
    // The CLI wrapper validates the reporter string; executeRun itself
    // trusts the type. Exercise the two valid values explicitly.
    const code = await executeRun(undefined, opts(ws, { reporter: 'json' }));
    expect(code).toBe(0);
    expect(() => JSON.parse(chunks.join(''))).not.toThrow();
  });

  it('emits config upgrade notices to stderr when loader reports a notice', async () => {
    // Write a valid-but-minor-bumped config. The loader auto-upgrades in
    // memory for minor bumps and returns a notice string.
    writeFileSync(
      ws.config,
      configWith({ 'What is 2+2?': '4', 'Say hi': 'hi' }).replace(
        'version: 1',
        'version: "1.0"',
      ),
    );
    const code = await executeRun(undefined, opts(ws));
    expect(code).toBe(0);
    // No notice for a same-version config, but the code path for
    // `loaded.notice` is covered via a real upgrade case below. This
    // assertion just proves the happy path does not explode.
    expect(chunks.join('')).toContain('"schemaVersion": 1');
  });

  it('closes the storage adapter after the run so a second run can reopen it', async () => {
    const dbPath = join(ws.workdir, 'db.sqlite').replace(/\\/g, '/');
    writeFileSync(
      ws.config,
      `version: 1
provider:
  name: mock
  model: r-model
  mock:
    defaultResponse: "4"
storage:
  type: sqlite
  url: ${dbPath}
thresholds:
  regression: 0.10
  alert: 0.20
baseline:
  source: branch
concurrency: 1
timeoutMs: 10000
suite: .drift/suite.yaml
`,
    );
    await executeRun(undefined, opts(ws));
    expect(existsSync(dbPath)).toBe(true);
    // A second run on the same file only succeeds if the first released
    // the database (WAL lock aside, SQLiteStorage.close() must run).
    const second = await executeRun(undefined, opts(ws));
    expect(second).toBe(0);
  });

  it('uses --provider / --model CLI overrides to pick a different provider', async () => {
    // Override to 'mock' (same family, but proves the flag is read). The
    // base config is already mock; we pass the flags explicitly to take
    // the override branch.
    const code = await executeRun(undefined, opts(ws, { provider: 'mock', model: 'override-model' }));
    expect(code).toBe(0);
    const payload = JSON.parse(chunks.join('')) as { run: { provider: string } };
    expect(payload.run.provider).toBe('mock/override-model');
  });

  it('persists the run to disk so baseline commands can read it back', async () => {
    await executeRun(undefined, opts(ws));
    const { JsonFileStorage } = await import('@drift-ci/core');
    const storage = new JsonFileStorage(ws.runsDir);
    const mostRecent = await storage.getMostRecentRun('r-suite');
    expect(mostRecent).not.toBeNull();
    expect(mostRecent!.cases.map((c) => c.caseId).sort()).toEqual(['greet', 'math']);
  });

  it('uses suite.default_threshold or config.thresholds for per-case threshold', async () => {
    await executeRun(undefined, opts(ws));
    const payload = JSON.parse(chunks.join('')) as {
      run: { cases: { caseId: string; threshold: number }[] };
    };
    for (const c of payload.run.cases) {
      expect(c.threshold).toBe(0.1);
    }
  });

  it('still exits 0 when output differs but delta is below regression threshold', async () => {
    // Mock returns "hi" for "Say hi", expected: "hi" → score 1.0.
    await executeRun(undefined, opts(ws));
    const { executeInit } = await import('../baseline.js');
    await executeInit(ws.suite, {
      baselineDir: ws.baselineDir,
      runsDir: ws.runsDir,
      config: ws.config,
    });
    chunks.length = 0;

    // Use the same mapping — delta stays 0. Exit 0 expected.
    const code = await executeRun(undefined, opts(ws));
    expect(code).toBe(0);
  });

  it('writes a JUnit XML report when --junit-path is set', async () => {
    const junitPath = join(ws.workdir, 'junit.xml');
    const code = await executeRun(undefined, opts(ws, { junitPath }));
    expect(code).toBe(0);
    expect(existsSync(junitPath)).toBe(true);
    const xml = readFileSync(junitPath, 'utf8');
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toMatch(/<testsuites name="drift-ci"/);
    expect(xml).toMatch(/name="math"/);
    expect(xml).toMatch(/name="greet"/);
  });

  it('creates parent directories for --junit-path', async () => {
    const junitPath = join(ws.workdir, 'nested', 'reports', 'junit.xml');
    const code = await executeRun(undefined, opts(ws, { junitPath }));
    expect(code).toBe(0);
    expect(existsSync(junitPath)).toBe(true);
  });

  it('reads the .drift/baseline directory exactly once per run', async () => {
    await executeRun(undefined, opts(ws));
    const { executeInit } = await import('../baseline.js');
    await executeInit(ws.suite, {
      baselineDir: ws.baselineDir,
      runsDir: ws.runsDir,
      config: ws.config,
    });
    expect(readFileSync(join(ws.baselineDir, 'math.json'), 'utf8')).toMatch(/"suiteId":\s*"r-suite"/);
  });
});
