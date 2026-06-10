import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeCompare, parseProviderList } from '../compare.js';

// ─── parseProviderList ─────────────────────────────────────────────────

describe('parseProviderList', () => {
  it('splits comma-separated `name:model` entries', () => {
    const out = parseProviderList(
      'anthropic:claude-sonnet-4-5,openai:gpt-4o-mini',
    );
    expect(out).toEqual([
      { name: 'anthropic', model: 'claude-sonnet-4-5' },
      { name: 'openai', model: 'gpt-4o-mini' },
    ]);
  });

  it('trims whitespace around entries', () => {
    const out = parseProviderList(' anthropic:m ,  openai:n ');
    expect(out).toEqual([
      { name: 'anthropic', model: 'm' },
      { name: 'openai', model: 'n' },
    ]);
  });

  it('drops empty entries (e.g. trailing commas)', () => {
    const out = parseProviderList('anthropic:m,,openai:n,');
    expect(out).toHaveLength(2);
  });

  it('throws on entries missing the colon', () => {
    expect(() => parseProviderList('anthropic-no-colon')).toThrow(/name:model/);
  });

  it('throws when name is empty', () => {
    expect(() => parseProviderList(':model-only')).toThrow(/required/);
  });

  it('throws when model is empty', () => {
    expect(() => parseProviderList('anthropic:')).toThrow(/required/);
  });

  it('preserves colons inside the model field (only the FIRST colon splits)', () => {
    const out = parseProviderList('bedrock:anthropic.claude-sonnet-4-5:v1');
    expect(out).toEqual([
      { name: 'bedrock', model: 'anthropic.claude-sonnet-4-5:v1' },
    ]);
  });
});

// ─── executeCompare end-to-end (mock provider) ─────────────────────────

describe('executeCompare', () => {
  let workdir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'drift-compare-'));
    mkdirSync(join(workdir, '.drift'));
    process.env.DRIFT_ENABLE_MOCK_PROVIDER = 'true';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
    delete process.env.DRIFT_ENABLE_MOCK_PROVIDER;
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    errSpy.mockRestore();
  });

  function writeConfig(extras = ''): string {
    // Use an absolute `suite:` path so the test isn't sensitive to CWD —
    // the loader treats relative paths as relative to the process CWD,
    // which is the `packages/cli` package root in vitest.
    const suitePath = join(workdir, '.drift/suite.yaml').replace(/\\/g, '/');
    const cfg = `version: 1
provider:
  name: mock
  model: m
storage:
  type: memory
thresholds:
  regression: 0.1
  alert: 0.2
suite: "${suitePath}"
${extras}
`;
    const path = join(workdir, '.drift/config.yaml');
    writeFileSync(path, cfg);
    return path;
  }

  function writeSuite(): string {
    const yaml = `version: 1
id: compare-test
name: Compare Test
evaluators: [exact-match]
cases:
  - id: hello
    input: Say hi
    expected: hi
  - id: math
    input: 2+2
    expected: '4'
`;
    const path = join(workdir, '.drift/suite.yaml');
    writeFileSync(path, yaml);
    return path;
  }

  it('rejects --providers with fewer than 2 entries', async () => {
    writeConfig();
    writeSuite();
    const code = await executeCompare({
      config: join(workdir, '.drift/config.yaml'),
      providers: 'mock:m1',
      output: 'table',
    });
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('at least 2 entries'),
    );
  });

  it('runs each provider, writes a side-by-side table to stdout', async () => {
    writeConfig();
    writeSuite();
    const code = await executeCompare({
      config: join(workdir, '.drift/config.yaml'),
      providers: 'mock:m1,mock:m2',
      output: 'table',
    });
    expect(code).toBe(0);
    const written = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('Suite: Compare Test');
    expect(written).toContain('hello');
    expect(written).toContain('math');
    expect(written).toContain('Average');
  });

  it('emits valid JSON when --output json is set', async () => {
    writeConfig();
    writeSuite();
    const code = await executeCompare({
      config: join(workdir, '.drift/config.yaml'),
      providers: 'mock:m1,mock:m2',
      output: 'json',
    });
    expect(code).toBe(0);
    const written = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(written);
    expect(parsed.suiteId).toBe('compare-test');
    expect(parsed.providers).toHaveLength(2);
    expect(parsed.rows).toHaveLength(2);
  });

  it('honours an explicit --suite override over the config default', async () => {
    writeConfig();
    const altSuite = `version: 1
id: alt
name: Alt
evaluators: [exact-match]
cases:
  - id: only
    input: x
    expected: y
`;
    const altPath = join(workdir, 'alt.yaml');
    writeFileSync(altPath, altSuite);
    writeSuite(); // also write the default

    const code = await executeCompare({
      config: join(workdir, '.drift/config.yaml'),
      suite: altPath,
      providers: 'mock:m1,mock:m2',
      output: 'table',
    });
    expect(code).toBe(0);
    const written = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('Alt');
    expect(written).toContain('only');
  });
});
