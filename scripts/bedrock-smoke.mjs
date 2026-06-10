#!/usr/bin/env node
// AWS Bedrock smoke test for drift-ci. Uses the standard AWS credential
// chain — set AWS_REGION plus either AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
// or rely on a profile / IAM role.
//
// Usage:
//   AWS_REGION=us-east-1 \
//   BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-5-20260101-v1:0 \
//     node scripts/bedrock-smoke.mjs
//
// Requires: `pnpm -r build` to have run first.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
const MODEL_ID = process.env.BEDROCK_MODEL_ID;

const missing = [];
if (!REGION) missing.push('AWS_REGION');
if (!MODEL_ID) missing.push('BEDROCK_MODEL_ID');
if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
  missing.push('AWS credentials (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY, or AWS_PROFILE, or an IAM role)');
}

if (missing.length > 0) {
  console.error(`drift-ci: Bedrock smoke requires ${missing.join(', ')}. Skipping.`);
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

const workdir = mkdtempSync(join(tmpdir(), 'drift-bedrock-smoke-'));
console.log(`drift-ci: bedrock smoke workdir = ${workdir}`);
console.log(`drift-ci: region=${REGION}, modelId=${MODEL_ID}`);

try {
  const init = run(
    'drift-ci init',
    ['init', '--provider', 'bedrock', '--model', MODEL_ID],
    workdir,
  );
  if (!init.ok) process.exit(init.status ?? 1);

  const cfg = `version: 1
provider:
  name: bedrock
  model: ${MODEL_ID}
  bedrock:
    modelId: ${MODEL_ID}
    region: ${REGION}

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
id: bedrock-smoke
name: Bedrock smoke
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
  console.log(`\n=== Bedrock smoke green — total ${total} ms across 4 commands ===`);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
