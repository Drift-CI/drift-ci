import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseSuite } from '../suite.js';
import { parseConfig } from '../config.js';

// Every suite and config shipped under examples/ must load, so copy-paste users never start from a broken file.
const EXAMPLES = fileURLToPath(new URL('../../../../../examples', import.meta.url));

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'workflows' || name === 'baseline' ? [] : yamlFiles(p);
    return name.endsWith('.yaml') ? [p] : [];
  });
}

const files = yamlFiles(EXAMPLES);

describe('examples/', () => {
  it('finds the example files', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(files.filter((f) => !f.endsWith('config.yaml')))('suite %s parses', (file) => {
    expect(() => parseSuite(readFileSync(file, 'utf8'))).not.toThrow();
  });

  it.each(files.filter((f) => f.endsWith('config.yaml')))('config %s parses', (file) => {
    expect(() => parseConfig(readFileSync(file, 'utf8'))).not.toThrow();
  });
});
