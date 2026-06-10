#!/usr/bin/env node
// Bundles packages/action/src/index.ts into dist/index.js via @vercel/ncc.
// Run via `pnpm --filter @drift-ci/action build`. The CI job
// `check-action-bundle` re-runs this and fails if dist/ drifts from source,
// so we never ship an action whose compiled artifact lags the TS.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import nccDefault from '@vercel/ncc';

// @vercel/ncc historically exports default + named — be tolerant.
const ncc = nccDefault && typeof nccDefault !== 'function' && 'default' in nccDefault
  ? /** @type {(entry: string, options?: object) => Promise<{code: string; assets?: Record<string, { source: string | Buffer }>}>} */ (nccDefault.default)
  : /** @type {(entry: string, options?: object) => Promise<{code: string; assets?: Record<string, { source: string | Buffer }>}>} */ (nccDefault);

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, '..');
const entry = join(packageDir, 'src', 'index.ts');
const outDir = join(packageDir, 'dist');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const result = await ncc(entry, {
  cache: false,
  // better-sqlite3 is a native module: optional peer of core, CLI-only.
  // Marking it external keeps the bundle architecture-agnostic.
  externals: ['better-sqlite3'],
  minify: false,
  sourceMap: false,
  target: 'es2022',
  license: 'licenses.txt',
  quiet: true,
});

writeFileSync(join(outDir, 'index.js'), result.code + '\n');

// Skip TypeScript declaration noise — actions only need .js + license + chunk files.
function isRuntimeAsset(name) {
  return !name.endsWith('.d.ts') && !name.endsWith('.d.ts.map') && !name.endsWith('.js.map');
}

let extraAssetCount = 0;
for (const [name, asset] of Object.entries(result.assets ?? {})) {
  if (!isRuntimeAsset(name)) continue;
  const abs = join(outDir, name);
  mkdirSync(dirname(abs), { recursive: true });
  const body = typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source);
  writeFileSync(abs, body);
  extraAssetCount += 1;
}

const relOut = outDir.split(sep).slice(-2).join('/');
const sizeKb = (result.code.length / 1024).toFixed(1);
console.log(
  `drift-ci action: wrote ${extraAssetCount + 1} file(s) to ${relOut} (bundle ${sizeKb} kB).`,
);
