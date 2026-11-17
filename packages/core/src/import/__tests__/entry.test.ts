import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `@drift-ci/core/import` is used by drift-hosted's Cloudflare worker, so its
// import graph must stay free of provider SDKs, the embedding model and other heavy packages.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWED_BARE = new Set(['zod', 'node:crypto']);

function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?[^;]*?\s+from\s+['"]([^'"]+)['"]/gms;
  for (const m of text.matchAll(re)) {
    if (m[2]) continue; // type-only imports are erased
    out.push(m[3]);
  }
  for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]);
  return out;
}

function walk(entry: string): Set<string> {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiers(file)) {
      if (spec.startsWith('.')) stack.push(join(dirname(file), spec.replace(/\.js$/, '.ts')));
      else bare.add(spec);
    }
  }
  return bare;
}

describe('@drift-ci/core/import entry', () => {
  it('is exported from package.json', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      exports: Record<string, { import: string; types: string }>;
    };
    expect(pkg.exports['./import']).toEqual({
      import: './dist/import/index.js',
      types: './dist/import/index.d.ts',
    });
  });

  it('only reaches zod and node:crypto', () => {
    const bare = walk(join(SRC, 'import', 'index.ts'));
    expect([...bare].filter((s) => !ALLOWED_BARE.has(s))).toEqual([]);
    expect(bare.has('zod')).toBe(true);
  });
});
