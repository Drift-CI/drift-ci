import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeMigrate, rewriteVersionLine } from '../config.js';

describe('rewriteVersionLine', () => {
  it('rewrites a bare integer version', () => {
    const yaml = [
      'version: 1',
      'provider:',
      '  name: mock',
    ].join('\n');
    expect(rewriteVersionLine(yaml, { major: 1, minor: 2 })).toContain(
      'version: 1.2',
    );
  });

  it('preserves double-quoted quoting', () => {
    const yaml = 'version: "1.0"\nprovider:\n';
    expect(rewriteVersionLine(yaml, { major: 1, minor: 3 })).toBe(
      'version: "1.3"\nprovider:\n',
    );
  });

  it('preserves single-quoted quoting', () => {
    const yaml = "version: '1'\n";
    expect(rewriteVersionLine(yaml, { major: 1, minor: 2 })).toBe(
      "version: '1.2'\n",
    );
  });

  it('preserves trailing comment on the version line', () => {
    const yaml = 'version: 1  # pinned\nprovider:\n';
    expect(rewriteVersionLine(yaml, { major: 1, minor: 1 })).toBe(
      'version: 1.1  # pinned\nprovider:\n',
    );
  });

  it('only rewrites the top-level version field, not nested keys', () => {
    const yaml = [
      'version: 1',
      'provider:',
      '  name: mock',
      '  version: other',
    ].join('\n');
    const rewritten = rewriteVersionLine(yaml, { major: 1, minor: 4 });
    expect(rewritten).toContain('version: 1.4');
    expect(rewritten).toContain('  version: other');
  });

  it('returns input unchanged when no version line is found', () => {
    const yaml = 'provider:\n  name: mock\n';
    expect(rewriteVersionLine(yaml, { major: 1, minor: 2 })).toBe(yaml);
  });
});

describe('executeMigrate', () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drift-migrate-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('returns 1 with a useful hint when the config file is missing', async () => {
    const code = await executeMigrate({ config: join(dir, 'missing.yaml') });
    expect(code).toBe(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain('config not found');
  });

  it('returns 0 and leaves the file unchanged when already at current version', async () => {
    const path = join(dir, 'config.yaml');
    writeFileSync(path, 'version: 1\nprovider:\n  name: mock\n');
    const code = await executeMigrate({ config: path });
    expect(code).toBe(0);
    expect(logSpy.mock.calls[0]?.[0]).toContain('already at version');
    expect(readFileSync(path, 'utf8')).toBe(
      'version: 1\nprovider:\n  name: mock\n',
    );
  });

  it('rejects configs whose version is newer than this binary supports', async () => {
    const path = join(dir, 'config.yaml');
    writeFileSync(path, 'version: "2.0"\nprovider:\n  name: mock\n');
    const code = await executeMigrate({ config: path });
    expect(code).toBe(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain('Upgrade drift-ci');
  });

  it('rejects configs with no version field', async () => {
    const path = join(dir, 'config.yaml');
    writeFileSync(path, 'provider:\n  name: mock\n');
    const code = await executeMigrate({ config: path });
    expect(code).toBe(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain("no 'version' field");
  });

  it('reports a parse error when the YAML is malformed', async () => {
    const path = join(dir, 'config.yaml');
    writeFileSync(path, 'version: 1\n  bad: [unclosed\n');
    const code = await executeMigrate({ config: path });
    expect(code).toBe(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain('cannot parse');
  });

  it('dry-run reports a planned bump but does not write the file', async () => {
    const path = join(dir, 'config.yaml');
    const original = 'version: 0\nprovider:\n  name: mock\n';
    writeFileSync(path, original);
    const code = await executeMigrate({ config: path, dryRun: true });
    expect(code).toBe(0);
    expect(logSpy.mock.calls[0]?.[0]).toContain('would migrate');
    expect(readFileSync(path, 'utf8')).toBe(original);
  });
});
