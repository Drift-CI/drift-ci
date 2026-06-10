import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConfigVersionError,
  loadConfigFromFile,
  parseConfig,
  parseVersion,
} from '../config.js';

function configYaml(extras = ''): string {
  return `version: 1\nprovider:\n  name: anthropic\n  model: claude-sonnet-4-5\n${extras}`;
}

describe('parseVersion', () => {
  it('maps a bare integer to MAJOR.0', () => {
    expect(parseVersion(1)).toEqual({ major: 1, minor: 0 });
    expect(parseVersion(2)).toEqual({ major: 2, minor: 0 });
  });

  it('parses MAJOR.MINOR strings', () => {
    expect(parseVersion('1.1')).toEqual({ major: 1, minor: 1 });
    expect(parseVersion('1.23')).toEqual({ major: 1, minor: 23 });
    expect(parseVersion('2.0')).toEqual({ major: 2, minor: 0 });
  });
});

describe('parseConfig — version gate', () => {
  it('accepts version 1 as a no-op (current MAJOR.MINOR)', () => {
    const result = parseConfig(configYaml());
    expect(result.upgradedInMemory).toBe(false);
    expect(result.notice).toBeUndefined();
    expect(result.config.provider.name).toBe('anthropic');
  });

  it('treats the bare integer 1 as equivalent to "1.0"', () => {
    const res = parseConfig(configYaml());
    expect(res.requestedVersion).toEqual({ major: 1, minor: 0 });
  });

  it('errors on a newer major version with an upgrade hint', () => {
    expect(() => parseConfig('version: 2\nprovider:\n  name: anthropic\n  model: m\n'))
      .toThrowError(/Upgrade drift-ci/);
    try {
      parseConfig('version: 2\nprovider:\n  name: anthropic\n  model: m\n');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigVersionError);
      expect((e as ConfigVersionError).kind).toBe('newer-major');
    }
  });

  it('errors on a newer minor version', () => {
    try {
      parseConfig('version: "1.99"\nprovider:\n  name: anthropic\n  model: m\n');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigVersionError);
      expect((e as ConfigVersionError).kind).toBe('newer-minor');
    }
  });

  it('fills in default sections when omitted', () => {
    const res = parseConfig(configYaml());
    expect(res.config.storage.type).toBe('json-file');
    expect(res.config.thresholds.regression).toBe(0.1);
    expect(res.config.baseline.source).toBe('branch');
    expect(res.config.telemetry.enabled).toBe(false);
    expect(res.config.concurrency).toBe(5);
    expect(res.config.timeoutMs).toBe(30_000);
    expect(res.config.suite).toBe('.drift/suite.yaml');
  });

  it('validates provider name enum', () => {
    expect(() =>
      parseConfig('version: 1\nprovider:\n  name: mystery\n  model: m\n'),
    ).toThrow();
  });

  it('validates redact-pattern names are lowercase-hyphen-alphanumeric', () => {
    expect(() =>
      parseConfig(
        `version: 1\nprovider:\n  name: anthropic\n  model: m\nbaseline:\n  redactPatterns:\n    - name: Bad_Name\n      pattern: "x"\n`,
      ),
    ).toThrow();
  });
});

describe('loadConfigFromFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drift-cfg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws a helpful error when the file is missing', () => {
    expect(() => loadConfigFromFile(join(dir, 'missing.yaml'))).toThrowError(
      /drift-ci init/,
    );
  });

  it('parses a file from disk', () => {
    const p = join(dir, 'config.yaml');
    writeFileSync(p, configYaml());
    const res = loadConfigFromFile(p);
    expect(res.config.provider.model).toBe('claude-sonnet-4-5');
  });
});
