import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    expect(out).toMatch(/drift-ci run/);
    expect(out).toMatch(/baseline init/);
  });
});
