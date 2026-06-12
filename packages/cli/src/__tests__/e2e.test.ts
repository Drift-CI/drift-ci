import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_PATH = resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
  'dist',
  'index.js',
);

interface RunOutcome {
  stdout: string;
  stderr: string;
  status: number;
}

function runCli(args: string[], cwd: string): RunOutcome {
  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [CLI_PATH, ...args],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        DRIFT_ENABLE_MOCK_PROVIDER: 'true',
        // Force non-TTY so the reporter defaults to the static text reporter,
        // not Ink — much easier to assert against in CI.
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    },
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

function writeConfig(
  path: string,
  responses: Record<string, string>,
  opts: { regressionThreshold?: number } = {},
): void {
  const pairs = Object.entries(responses)
    .map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join('\n');
  const threshold = opts.regressionThreshold ?? 0.1;
  const yaml = `version: 1
provider:
  name: mock
  model: e2e-model
  mock:
    responses:
${pairs}
    defaultResponse: fallback

storage:
  type: json-file

thresholds:
  regression: ${threshold}
  alert: 0.20

baseline:
  source: branch

concurrency: 2
timeoutMs: 10000

suite: .drift/suite.yaml
`;
  writeFileSync(path, yaml);
}

const SUITE_YAML = `version: 1
id: e2e-suite
name: E2E Suite
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

describe('CLI end-to-end (mock provider)', () => {
  let workdir: string;

  beforeAll(() => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(
        `E2E prerequisite missing: ${CLI_PATH}. Run 'pnpm --filter drift-ci build' first.`,
      );
    }
  });

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'drift-e2e-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('completes init → run → baseline init → run → regress → accept → run', () => {
    // 1. init scaffolds the .drift/ directory
    const initOut = runCli(
      ['init', '--provider', 'mock', '--model', 'e2e-model'],
      workdir,
    );
    expect(initOut.status, initOut.stderr).toBe(0);
    expect(existsSync(join(workdir, '.drift/config.yaml'))).toBe(true);
    expect(existsSync(join(workdir, '.drift/suite.yaml'))).toBe(true);

    // 2. Overwrite config + suite with the mock-backed fixtures.
    writeConfig(join(workdir, '.drift/config.yaml'), {
      'What is 2+2?': '4',
      'Say hi': 'hi',
    });
    writeFileSync(join(workdir, '.drift/suite.yaml'), SUITE_YAML);

    // 3. First run: no baselines yet, so missingBaselines reported but no
    //    regressions — exit 0.
    const firstRun = runCli(['run'], workdir);
    expect(firstRun.status, firstRun.stdout + firstRun.stderr).toBe(0);
    expect(firstRun.stdout).toMatch(/math/);
    expect(firstRun.stdout).toMatch(/greet/);

    // 4. Capture baselines from that run.
    const baseInit = runCli(
      ['baseline', 'init', '.drift/suite.yaml'],
      workdir,
    );
    expect(baseInit.status, baseInit.stderr).toBe(0);
    expect(baseInit.stdout).toMatch(/Baseline init: 2 written/);
    expect(
      existsSync(join(workdir, '.drift/baseline/math.json')),
    ).toBe(true);
    expect(
      existsSync(join(workdir, '.drift/baseline/greet.json')),
    ).toBe(true);

    // 5. Re-run against the captured baselines — no drift, exit 0.
    const cleanRun = runCli(['run'], workdir);
    expect(cleanRun.status, cleanRun.stdout + cleanRun.stderr).toBe(0);

    // 6. Regress the `math` case by swapping its mock response. `greet`
    //    stays put.
    writeConfig(join(workdir, '.drift/config.yaml'), {
      'What is 2+2?': 'five',
      'Say hi': 'hi',
    });

    const regressRun = runCli(['run'], workdir);
    expect(regressRun.status).toBe(1);
    expect(regressRun.stdout + regressRun.stderr).toMatch(/math/i);

    // 7. Accept the regression as the new baseline.
    const accept = runCli(
      ['baseline', 'accept', '.drift/suite.yaml', '--cases', 'math'],
      workdir,
    );
    expect(accept.status, accept.stderr).toBe(0);
    expect(accept.stdout).toMatch(/Baseline accept/);

    // 8. Final run is clean again.
    const finalRun = runCli(['run'], workdir);
    expect(finalRun.status, finalRun.stdout + finalRun.stderr).toBe(0);

    // Sanity: the accepted baseline now reflects the new (mismatching)
    // output, which `exact-match` scores 0 because 'five' !== '4'.
    const mathBaseline = JSON.parse(
      readFileSync(join(workdir, '.drift/baseline/math.json'), 'utf8'),
    ) as { score: number; output: string };
    expect(mathBaseline.score).toBe(0);
    expect(mathBaseline.output).toBe('five');
  }, 60_000);

  it('honors --no-baseline through real CLI parsing (skips the comparison)', () => {
    const initOut = runCli(
      ['init', '--provider', 'mock', '--model', 'e2e-model'],
      workdir,
    );
    expect(initOut.status, initOut.stderr).toBe(0);
    writeConfig(join(workdir, '.drift/config.yaml'), {
      'What is 2+2?': '4',
      'Say hi': 'hi',
    });
    writeFileSync(join(workdir, '.drift/suite.yaml'), SUITE_YAML);

    // Establish baselines so a comparison would otherwise have something to do.
    runCli(['run'], workdir);
    const baseInit = runCli(['baseline', 'init', '.drift/suite.yaml'], workdir);
    expect(baseInit.status, baseInit.stderr).toBe(0);

    // Control: a normal json run with baselines present reports deltas.
    const withBaseline = runCli(['run', '--reporter', 'json'], workdir);
    expect(withBaseline.status, withBaseline.stderr).toBe(0);
    const withPayload = JSON.parse(withBaseline.stdout) as { deltas: unknown };
    expect(withPayload.deltas).not.toBeNull();

    // `--no-baseline` (a lone negated commander flag → stored under `baseline`)
    // must skip the comparison entirely, so deltas is null. A regression here
    // means the flag is being read from the wrong option attribute.
    const noBaseline = runCli(
      ['run', '--no-baseline', '--reporter', 'json'],
      workdir,
    );
    expect(noBaseline.status, noBaseline.stderr).toBe(0);
    const noPayload = JSON.parse(noBaseline.stdout) as { deltas: unknown };
    expect(noPayload.deltas).toBeNull();
  }, 60_000);

  it('baseline doctor reports missing and stale baselines', () => {
    // `init` creates .drift/ and placeholder files we'll overwrite.
    const initOut = runCli(
      ['init', '--provider', 'mock', '--model', 'e2e-model'],
      workdir,
    );
    expect(initOut.status, initOut.stderr).toBe(0);
    writeConfig(join(workdir, '.drift/config.yaml'), {
      'What is 2+2?': '4',
      'Say hi': 'hi',
    });
    writeFileSync(join(workdir, '.drift/suite.yaml'), SUITE_YAML);

    const doctor = runCli(
      ['baseline', 'doctor', '.drift/suite.yaml'],
      workdir,
    );
    expect(doctor.status, doctor.stderr).toBe(0);
    expect(doctor.stdout).toMatch(/Missing baselines:\s+2/);
    expect(doctor.stdout).toMatch(/math/);
    expect(doctor.stdout).toMatch(/greet/);
  }, 30_000);
});
