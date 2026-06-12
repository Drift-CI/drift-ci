import type { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { load as yamlLoad } from 'js-yaml';

import {
  CURRENT_CONFIG_VERSION,
  formatVersion,
  parseVersion,
  type ConfigVersion,
} from '@drift-ci/core';

interface MigrateOptions {
  config: string;
  dryRun?: boolean;
}

/* c8 ignore start -- Commander wiring; covered by the CLI E2E in a subprocess. */
export function registerConfigCommand(program: Command): void {
  const cfg = program
    .command('config')
    .description('manage drift-ci configuration');

  cfg
    .command('migrate')
    .description('rewrite .drift/config.yaml to the current config version')
    .option('--config <path>', 'drift-ci config path', '.drift/config.yaml')
    .option('--dry-run', 'report what would change without writing')
    .action(async (opts: MigrateOptions) => {
      const exitCode = await executeMigrate(opts);
      if (exitCode !== 0) process.exit(exitCode);
    });
}
/* c8 ignore stop */

export async function executeMigrate(opts: MigrateOptions): Promise<number> {
  // Read directly and handle ENOENT, rather than existsSync-then-read, to
  // avoid an existsSync→readFileSync TOCTOU race (CodeQL js/file-system-race).
  let original: string;
  try {
    original = readFileSync(opts.config, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(
        `drift-ci: config not found at ${opts.config}. Run 'drift-ci init' to scaffold one.`,
      );
      return 1;
    }
    throw err;
  }
  let rawVersion: unknown;
  try {
    const parsed = yamlLoad(original) as Record<string, unknown> | null;
    rawVersion = parsed?.version;
  } catch (err) {
    console.error(`drift-ci: cannot parse ${opts.config}: ${(err as Error).message}`);
    return 1;
  }

  if (rawVersion === undefined || rawVersion === null) {
    console.error(
      `drift-ci: ${opts.config} has no 'version' field. ` +
        `Add 'version: ${formatVersion(CURRENT_CONFIG_VERSION)}' and try again.`,
    );
    return 1;
  }
  if (typeof rawVersion !== 'number' && typeof rawVersion !== 'string') {
    console.error(`drift-ci: version field must be a number or string in MAJOR or MAJOR.MINOR form.`);
    return 1;
  }

  const requested = parseVersion(rawVersion);
  const current = CURRENT_CONFIG_VERSION;

  if (requested.major === current.major && requested.minor === current.minor) {
    console.log(
      `drift-ci: ${opts.config} is already at version ${formatVersion(current)}. Nothing to do.`,
    );
    return 0;
  }

  const isNewer =
    requested.major > current.major ||
    (requested.major === current.major && requested.minor > current.minor);
  if (isNewer) {
    console.error(
      `drift-ci: ${opts.config} declares version ${formatVersion(requested)}, ` +
        `but this binary only supports up to ${formatVersion(current)}. ` +
        `Upgrade drift-ci instead of migrating.`,
    );
    return 1;
  }

  const rewritten = rewriteVersionLine(original, current);
  if (rewritten === original) {
    console.error(
      `drift-ci: could not locate a top-level 'version:' line to rewrite in ${opts.config}.`,
    );
    return 1;
  }

  if (opts.dryRun) {
    console.log(
      `drift-ci: would migrate ${opts.config} from ${formatVersion(requested)} to ${formatVersion(current)} (dry run).`,
    );
    return 0;
  }

  writeFileSync(opts.config, rewritten, 'utf8');
  console.log(
    `drift-ci: migrated ${opts.config} from ${formatVersion(requested)} to ${formatVersion(current)}.`,
  );
  return 0;
}

const VERSION_LINE = /^(version\s*:\s*)(["']?)([\d]+(?:\.\d+)?)(\2)([ \t]*(?:#.*)?)$/m;

export function rewriteVersionLine(
  yaml: string,
  target: ConfigVersion,
): string {
  return yaml.replace(VERSION_LINE, (_match, prefix, quote, _old, _close, trailer) => {
    return `${prefix}${quote}${formatVersion(target)}${quote}${trailer}`;
  });
}
