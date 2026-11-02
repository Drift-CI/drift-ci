import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

// GitHub refuses to load an action whose action.yml isn't valid YAML, which breaks every
// workflow on the floating tag (1.3.0 shipped an unquoted "key: value" inside a description).
const manifestPath = fileURLToPath(new URL('../../../../action.yml', import.meta.url));

describe('action.yml', () => {
  it('parses as YAML with the expected shape', () => {
    const manifest = load(readFileSync(manifestPath, 'utf8')) as Record<string, any>;
    expect(manifest.name).toBeTruthy();
    expect(manifest.runs?.using).toMatch(/^node\d+$/);
    expect(typeof manifest.inputs).toBe('object');
    for (const [name, input] of Object.entries<any>(manifest.inputs)) {
      expect(typeof input.description, `inputs.${name}.description`).toBe('string');
    }
    expect(manifest.inputs['dashboard-token'].description).toContain('id-token: write');
  });
});
