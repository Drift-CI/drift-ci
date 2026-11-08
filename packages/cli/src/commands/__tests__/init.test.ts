import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';

import { executeInit } from '../init.js';

function makeOpts(dir: string, overrides: Partial<Parameters<typeof executeInit>[0]> = {}) {
  return {
    dir,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    force: false,
    ...overrides,
  };
}

describe('executeInit', () => {
  let workdir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'drift-init-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(workdir, { recursive: true, force: true });
  });

  it('scaffolds config.yaml, suite.yaml, and .gitignore into the target directory', () => {
    const dir = join(workdir, '.drift');
    executeInit(makeOpts(dir));

    expect(existsSync(join(dir, 'config.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'suite.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
    expect(existsSync(join(dir, 'baseline'))).toBe(true);
  });

  it('interpolates provider and model into the config template', () => {
    const dir = join(workdir, '.drift');
    executeInit(makeOpts(dir, { provider: 'ollama', model: 'llama3.2' }));

    const cfg = readFileSync(join(dir, 'config.yaml'), 'utf8');
    expect(cfg).toMatch(/name: ollama/);
    expect(cfg).toMatch(/model: llama3\.2/);
  });

  it('writes a valid suite.yaml shell', () => {
    const dir = join(workdir, '.drift');
    executeInit(makeOpts(dir));
    const suite = readFileSync(join(dir, 'suite.yaml'), 'utf8');
    expect(suite).toMatch(/version: 1/);
    expect(suite).toMatch(/id: example/);
    expect(suite).toMatch(/evaluators:/);
    expect(suite).toMatch(/- exact-match/);
  });

  it('skips existing files by default', () => {
    const dir = join(workdir, '.drift');
    executeInit(makeOpts(dir));
    writeFileSync(join(dir, 'config.yaml'), 'PRESERVED');

    executeInit(makeOpts(dir));
    expect(readFileSync(join(dir, 'config.yaml'), 'utf8')).toBe('PRESERVED');

    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).toMatch(/skipped/);
    expect(logs).toMatch(/--force/);
  });

  it('overwrites existing files when --force is set', () => {
    const dir = join(workdir, '.drift');
    executeInit(makeOpts(dir));
    writeFileSync(join(dir, 'config.yaml'), 'PRESERVED');

    executeInit(makeOpts(dir, { force: true }));
    expect(readFileSync(join(dir, 'config.yaml'), 'utf8')).not.toBe('PRESERVED');
  });

  it('creates nested dir when target does not yet exist', () => {
    const dir = join(workdir, 'nested', 'deeper', '.drift');
    executeInit(makeOpts(dir));
    expect(existsSync(join(dir, 'config.yaml'))).toBe(true);
  });

  it('prints a next-steps list after scaffolding', () => {
    executeInit(makeOpts(join(workdir, '.drift')));
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toMatch(/Next steps/);
    expect(out).toMatch(/npx @drift-ci\/cli run/);
    expect(out).toMatch(/npx @drift-ci\/cli baseline init \S*suite\.yaml/);
    expect(out).not.toMatch(/ drift-ci baseline init/);
  });

  it('uses the scaffolded suite path (respecting --dir) in the baseline init hint', () => {
    executeInit(makeOpts(join(workdir, 'custom dir')));
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const suitePath = join(workdir, 'custom dir', 'suite.yaml').replace(/\\/g, '/');
    expect(out).toContain(`npx @drift-ci/cli baseline init '${suitePath}'`);
  });

  it('points the config at the scaffolded suite when --dir is not .drift', () => {
    const dir = join(workdir, 'evals');
    executeInit(makeOpts(dir));
    const cfg = load(readFileSync(join(dir, 'config.yaml'), 'utf8')) as { suite: string };
    expect(cfg.suite).toBe(join(dir, 'suite.yaml').replace(/\\/g, '/'));
  });

  it('writes a suite path that YAML parses back exactly, even with special characters', () => {
    const dir = join(workdir, 'my #evals'); // " #" starts a YAML comment if left unquoted
    executeInit(makeOpts(dir));
    const cfg = load(readFileSync(join(dir, 'config.yaml'), 'utf8')) as { suite: string };
    expect(cfg.suite).toBe(`${dir.replace(/\\/g, '/')}/suite.yaml`);
  });

  it('keeps the default config suite path for the default directory', () => {
    const cwd = process.cwd();
    process.chdir(workdir);
    try {
      executeInit(makeOpts('.drift'));
      expect(readFileSync(join(workdir, '.drift', 'config.yaml'), 'utf8')).toContain('suite: .drift/suite.yaml');
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('Edit .drift/suite.yaml');
      expect(out).toMatch(/npx @drift-ci\/cli run$/m);
      expect(out).not.toContain('--config');
    } finally {
      process.chdir(cwd);
    }
  });

  it('tells you to pass --config/--baseline-dir/--runs-dir when --dir is custom', () => {
    const cwd = process.cwd();
    process.chdir(workdir);
    try {
      executeInit(makeOpts('evals'));
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('Edit evals/suite.yaml');
      const flags = '--config evals/config.yaml --baseline-dir evals/baseline --runs-dir evals/runs';
      expect(out).toContain(`npx @drift-ci/cli run ${flags}`);
      expect(out).toContain(`npx @drift-ci/cli baseline init evals/suite.yaml ${flags}`);
      expect(out).toContain('git add evals/baseline');
      expect(readFileSync(join(workdir, 'evals', '.gitignore'), 'utf8')).toContain('evals/baseline/');
    } finally {
      process.chdir(cwd);
    }
  });
});
