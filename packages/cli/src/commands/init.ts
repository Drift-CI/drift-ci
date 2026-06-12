import type { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InitOptions {
  dir: string;
  provider: string;
  model: string;
  force?: boolean;
}

const CONFIG_TEMPLATE = (provider: string, model: string) => `version: 1
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

suite: .drift/suite.yaml
`;

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

const GITIGNORE_TEMPLATE = `# drift-ci ephemeral state — baselines at .drift/baseline/ ARE committed.
runs/
`;

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

  const files: { path: string; content: string }[] = [
    { path: join(opts.dir, 'config.yaml'), content: CONFIG_TEMPLATE(opts.provider, opts.model) },
    { path: join(opts.dir, 'suite.yaml'), content: SUITE_TEMPLATE },
    { path: join(opts.dir, '.gitignore'), content: GITIGNORE_TEMPLATE },
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

  console.log('\nNext steps:');
  console.log('  1. Edit .drift/suite.yaml with your own cases.');
  console.log('  2. Set ANTHROPIC_API_KEY (or your provider equivalent).');
  console.log('  3. drift-ci run');
  console.log('  4. drift-ci baseline init   # once scores look right');
  console.log('  5. git add .drift/baseline && git commit');
}
