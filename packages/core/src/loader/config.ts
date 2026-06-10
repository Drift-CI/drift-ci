import { existsSync, readFileSync } from 'node:fs';
import { load as yamlLoad } from 'js-yaml';

import {
  CURRENT_CONFIG_VERSION,
  DriftConfigSchema,
  type ConfigVersion,
  type DriftConfig,
} from '../types/config.js';

export interface ConfigLoadResult {
  config: DriftConfig;
  requestedVersion: ConfigVersion;
  upgradedInMemory: boolean;
  notice?: string;
}

export class ConfigVersionError extends Error {
  code = 'CONFIG_VERSION';
  constructor(
    public kind: 'older-major' | 'newer-major' | 'newer-minor',
    public requestedVersion: ConfigVersion,
    public currentVersion: ConfigVersion,
  ) {
    super(messageFor(kind, requestedVersion, currentVersion));
    this.name = 'ConfigVersionError';
  }
}

function messageFor(
  kind: 'older-major' | 'newer-major' | 'newer-minor',
  requested: ConfigVersion,
  current: ConfigVersion,
): string {
  const req = formatVersion(requested);
  const cur = formatVersion(current);
  switch (kind) {
    case 'older-major':
      return (
        `drift-ci: config declares version ${req}, but this binary supports ${cur}. ` +
        `Run 'drift-ci config migrate' to upgrade the config.`
      );
    case 'newer-major':
      return (
        `drift-ci: config declares version ${req}, but this binary only supports ${cur}. ` +
        `Upgrade drift-ci to a version that understands config v${requested.major}.`
      );
    case 'newer-minor':
      return (
        `drift-ci: config declares version ${req}, but this binary only supports ${cur}. ` +
        `Upgrade drift-ci to pick up the new minor-version features.`
      );
  }
}

export function parseConfig(yamlText: string): ConfigLoadResult {
  const raw = yamlLoad(yamlText);
  return applyVersionGate(DriftConfigSchema.parse(raw));
}

export function loadConfigFromFile(path: string): ConfigLoadResult {
  if (!existsSync(path)) {
    throw new Error(
      `drift-ci: config not found at ${path}. Run 'drift-ci init' to scaffold one.`,
    );
  }
  return parseConfig(readFileSync(path, 'utf8'));
}

export function parseVersion(raw: number | string): ConfigVersion {
  if (typeof raw === 'number') {
    return { major: raw, minor: 0 };
  }
  const [majorStr, minorStr] = raw.split('.');
  return {
    major: Number.parseInt(majorStr, 10),
    minor: minorStr ? Number.parseInt(minorStr, 10) : 0,
  };
}

export function formatVersion(v: ConfigVersion): string {
  return `${v.major}.${v.minor}`;
}

function applyVersionGate(config: DriftConfig): ConfigLoadResult {
  const requested = parseVersion(config.version);
  const current = CURRENT_CONFIG_VERSION;

  if (requested.major < current.major) {
    throw new ConfigVersionError('older-major', requested, current);
  }
  if (requested.major > current.major) {
    throw new ConfigVersionError('newer-major', requested, current);
  }
  if (requested.minor > current.minor) {
    throw new ConfigVersionError('newer-minor', requested, current);
  }

  if (requested.minor === current.minor) {
    return {
      config,
      requestedVersion: requested,
      upgradedInMemory: false,
    };
  }

  return {
    config,
    requestedVersion: requested,
    upgradedInMemory: true,
    notice:
      `drift-ci: config is version ${formatVersion(requested)}, auto-upgraded in ` +
      `memory to ${formatVersion(current)}. Update the 'version:' field to ` +
      `persist and silence this notice.`,
  };
}
