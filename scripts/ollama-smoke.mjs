#!/usr/bin/env node
// Ollama smoke-test for drift-ci. Runs init -> run -> baseline init -> run
// against a live Ollama endpoint (local by default) and reports timings.
//
// Usage:
//   node scripts/ollama-smoke.mjs
//   OLLAMA_MODEL=llama3.2 node scripts/ollama-smoke.mjs
//   OLLAMA_BASE_URL=https://ollama.com OLLAMA_API_KEY=xxx \
//     OLLAMA_MODEL=gpt-oss:120b node scripts/ollama-smoke.mjs
//
// Requires: `pnpm -r build` to have run first, and Ollama to be reachable
// at OLLAMA_BASE_URL (default http://localhost:11434).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';
const API_KEY = process.env.OLLAMA_API_KEY ?? '';

const SCRIPT_DIR = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const CLI_PATH = join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');

function run(label, args, cwd) {
  const start = Date.now();
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      OLLAMA_API_KEY: API_KEY,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  });
  const ms = Date.now() - start;
  const ok = res.status === 0;
  console.log(`\n--- ${label} (exit ${res.status}, ${ms} ms) ---`);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return { ok, status: res.status, ms };
}

async function pingOllama() {
  try {
    const res = await fetch(`${BASE_URL.replace(/\/+$/, '')}/api/tags`, {
      headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
    });
    if (!res.ok) {
      console.error(
        `drift-ci: Ollama ping to ${BASE_URL}/api/tags returned ${res.status}.`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `drift-ci: cannot reach Ollama at ${BASE_URL} — ${(err instanceof Error ? err.message : String(err))}`,
    );
    return false;
  }
}

const reachable = await pingOllama();
if (!reachable) {
  console.error(
    '\nStart Ollama locally (`ollama serve`) or set OLLAMA_BASE_URL/OLLAMA_API_KEY for a cloud endpoint.',
  );
  process.exit(2);
}

const workdir = mkdtempSync(join(tmpdir(), 'drift-ollama-smoke-'));
console.log(`drift-ci: ollama smoke workdir = ${workdir}`);
console.log(`drift-ci: base=${BASE_URL}, model=${MODEL}, apiKey=${API_KEY ? '<set>' : '<unset>'}`);

try {
  const init = run('drift-ci init', ['init', '--provider', 'ollama', '--model', MODEL], workdir);
  if (!init.ok) process.exit(init.status ?? 1);

  // Overwrite the scaffolded config to point at the requested endpoint and
  // (optionally) lift concurrency down — Ollama local is single-threaded.
  const cfg = `version: 1
provider:
  name: ollama
  model: ${MODEL}
  baseUrl: ${BASE_URL}

storage:
  type: json-file

thresholds:
  regression: 0.15
  alert: 0.25

baseline:
  source: branch

concurrency: 1
timeoutMs: 120000

suite: .drift/suite.yaml
`;
  writeFileSync(join(workdir, '.drift', 'config.yaml'), cfg);

  // A tiny exact-match suite where we mostly care about the round-trip,
  // not the evaluator score. Real LLMs won't exact-match "4", so expect
  // score 0 — we're smoking the provider path, not behaviour quality.
  const suite = `version: 1
id: ollama-smoke
name: Ollama smoke
evaluators:
  - exact-match
cases:
  - id: math
    input: "Answer with a single digit. What is 2+2?"
    expected: "4"
  - id: greet
    input: "Reply with only the word: hi"
    expected: "hi"
`;
  writeFileSync(join(workdir, '.drift', 'suite.yaml'), suite);

  const r1 = run('drift-ci run (no baseline)', ['run'], workdir);
  if (!r1.ok) process.exit(r1.status ?? 1);

  const bi = run(
    'drift-ci baseline init',
    ['baseline', 'init', '.drift/suite.yaml'],
    workdir,
  );
  if (!bi.ok) process.exit(bi.status ?? 1);

  const r2 = run('drift-ci run (against baseline)', ['run'], workdir);
  if (!r2.ok) process.exit(r2.status ?? 1);

  const total = [init, r1, bi, r2].reduce((a, b) => a + b.ms, 0);
  console.log(`\n=== Ollama smoke green — total ${total} ms across 4 commands ===`);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
