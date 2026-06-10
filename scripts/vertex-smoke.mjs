#!/usr/bin/env node
// Vertex AI smoke test for drift-ci. Uses Google Cloud application-default
// credentials — run `gcloud auth application-default login` first, or set
// GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file.
//
// Usage:
//   GOOGLE_CLOUD_PROJECT=my-proj \
//   GOOGLE_CLOUD_LOCATION=us-central1 \
//     node scripts/vertex-smoke.mjs
//
// Requires: `pnpm -r build` to have run first.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT;
const LOCATION =
  process.env.GOOGLE_CLOUD_LOCATION ?? process.env.GCP_LOCATION;
const MODEL = process.env.VERTEX_MODEL ?? 'gemini-2.5-flash';

const missing = [];
if (!PROJECT) missing.push('GOOGLE_CLOUD_PROJECT');
if (!LOCATION) missing.push('GOOGLE_CLOUD_LOCATION');
if (
  !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
  !process.env.GCLOUD_PROJECT &&
  !process.env.CLOUDSDK_CORE_PROJECT
) {
  // Heuristic — gcloud ADC writes a well-known file but doesn't export an env
  // var. Skip the credential check rather than guess wrong; the SDK will
  // surface a clear error if creds are absent at request time.
}

if (missing.length > 0) {
  console.error(`drift-ci: Vertex smoke requires ${missing.join(', ')}. Skipping.`);
  console.error('Run: gcloud auth application-default login');
  process.exit(0);
}

const SCRIPT_DIR = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const CLI_PATH = join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');

function run(label, args, cwd) {
  const start = Date.now();
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  const ms = Date.now() - start;
  console.log(`\n--- ${label} (exit ${res.status}, ${ms} ms) ---`);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return { ok: res.status === 0, status: res.status, ms };
}

const workdir = mkdtempSync(join(tmpdir(), 'drift-vertex-smoke-'));
console.log(`drift-ci: vertex smoke workdir = ${workdir}`);
console.log(`drift-ci: project=${PROJECT}, location=${LOCATION}, model=${MODEL}`);

try {
  const init = run('drift-ci init', ['init', '--provider', 'vertex', '--model', MODEL], workdir);
  if (!init.ok) process.exit(init.status ?? 1);

  const cfg = `version: 1
provider:
  name: vertex
  model: ${MODEL}

storage:
  type: json-file

thresholds:
  regression: 0.15
  alert: 0.25

baseline:
  source: branch

concurrency: 2
timeoutMs: 120000

suite: .drift/suite.yaml
`;
  writeFileSync(join(workdir, '.drift', 'config.yaml'), cfg);

  const suite = `version: 1
id: vertex-smoke
name: Vertex smoke
evaluators:
  - exact-match
cases:
  - id: math
    input: "Answer with a single digit. What is 2+2?"
    expected: "4"
`;
  writeFileSync(join(workdir, '.drift', 'suite.yaml'), suite);

  const r1 = run('drift-ci run (no baseline)', ['run'], workdir);
  if (!r1.ok) process.exit(r1.status ?? 1);

  const bi = run('drift-ci baseline init', ['baseline', 'init', '.drift/suite.yaml'], workdir);
  if (!bi.ok) process.exit(bi.status ?? 1);

  const r2 = run('drift-ci run (against baseline)', ['run'], workdir);
  if (!r2.ok) process.exit(r2.status ?? 1);

  const total = [init, r1, bi, r2].reduce((a, b) => a + b.ms, 0);
  console.log(`\n=== Vertex smoke green — total ${total} ms across 4 commands ===`);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
