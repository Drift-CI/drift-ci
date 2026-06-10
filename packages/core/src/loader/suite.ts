import { readFileSync } from 'node:fs';
import { load as yamlLoad } from 'js-yaml';
import { SuiteSchema, type Suite } from '../types/index.js';

export function parseSuite(yamlText: string): Suite {
  const raw = yamlLoad(yamlText);
  return SuiteSchema.parse(raw);
}

export function loadSuiteFromFile(path: string): Suite {
  const text = readFileSync(path, 'utf8');
  return parseSuite(text);
}
