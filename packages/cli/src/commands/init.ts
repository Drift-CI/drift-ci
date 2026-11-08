import type { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InitOptions {
  dir: string;
  provider: string;
  model: string;
  force?: boolean;
}

const CONFIG_TEMPLATE = (provider: string, model: string, suitePath: string) => `version: 1
provider:
  name: ${provider}
  model: ${model}

storage:
  type: json-file

thresholds:
  regression: 0.10
  alert: 0.20

baseline:
  source: branch

concurrency: 5
timeoutMs: 30000

suite: ${yamlString(suitePath)}
`;

/** Plain YAML scalar for ordinary paths; a JSON (= YAML double-quoted) string when plain would misparse. */
function yamlString(s: string): string {
  return /^[\w./-][\w ./-]*$/.test(s) && !s.endsWith(' ') ? s : JSON.stringify(s);
}

const SUITE_TEMPLATE = `version: 1
id: example
name: Example suite
description: Starter suite. Replace with your own cases.
evaluators:
  - exact-match
cases:
  - id: example-case
    input: Say hello
    expected: Hello
`;

const GITIGNORE_TEMPLATE = (dir: string) => `# drift-ci ephemeral state — baselines at ${dir}/baseline/ ARE committed.
runs/
`;

const DEFAULT_DIR = '.drift';

/** Forward-slash path, quoted for a POSIX shell only when it needs it. */
function shellArg(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : "'" + path.replace(/'/g, "'\\''") + "'";
}

/* c8 ignore start -- Commander wiring; covered by the CLI E2E in a subprocess. */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Scaffold .drift/ with config, example suite, and .gitignore')
    .option('--dir <path>', 'drift-ci directory', '.drift')
    .option('--provider <name>', 'default provider', 'anthropic')
    .option(
      '--model <name>',
      'default model',
      'claude-sonnet-4-5',
    )
    .option('--force', 'overwrite existing files', false)
    .action(async (opts: InitOptions) => {
      executeInit(opts);
    });
}
/* c8 ignore stop */

export function executeInit(opts: InitOptions): void {
  mkdirSync(opts.dir, { recursive: true });
  mkdirSync(join(opts.dir, 'baseline'), { recursive: true });

  // Paths as the user typed them, with forward slashes: they go into config.yaml and shell hints.
  const dir = opts.dir.replace(/\\/g, '/').replace(/\/+$/, '') || '.';
  const suitePath = `${dir}/suite.yaml`;

  const files: { path: string; content: string }[] = [
    { path: join(opts.dir, 'config.yaml'), content: CONFIG_TEMPLATE(opts.provider, opts.model, suitePath) },
    { path: join(opts.dir, 'suite.yaml'), content: SUITE_TEMPLATE },
    { path: join(opts.dir, '.gitignore'), content: GITIGNORE_TEMPLATE(dir) },
  ];

  const written: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    try {
      // 'wx' fails atomically if the file already exists, eliminating the
      // existsSync→writeFileSync TOCTOU race (CodeQL js/file-system-race).
      // --force overwrites unconditionally with 'w'.
      writeFileSync(f.path, f.content, { flag: opts.force ? 'w' : 'wx' });
      written.push(f.path);
    } catch (err) {
      if (!opts.force && (err as NodeJS.ErrnoException).code === 'EEXIST') {
        skipped.push(f.path);
        continue;
      }
      throw err;
    }
  }

  for (const p of written) console.log(`  wrote   ${p}`);
  for (const p of skipped) console.log(`  skipped ${p} (already exists; pass --force to overwrite)`);

  // run/baseline default to .drift/*, so a custom --dir must be passed explicitly.
  const flags =
    dir === DEFAULT_DIR
      ? ''
      : ` --config ${shellArg(`${dir}/config.yaml`)} --baseline-dir ${shellArg(`${dir}/baseline`)} --runs-dir ${shellArg(`${dir}/runs`)}`;

  console.log('\nNext steps:');
  console.log(`  1. Edit ${suitePath} with your own cases.`);
  console.log('  2. Set ANTHROPIC_API_KEY (or your provider equivalent).');
  console.log(`  3. npx @drift-ci/cli run${flags}`);
  console.log(`  4. npx @drift-ci/cli baseline init ${shellArg(suitePath)}${flags}   # once scores look right`);
  console.log(`  5. git add ${shellArg(`${dir}/baseline`)} && git commit`);
}
