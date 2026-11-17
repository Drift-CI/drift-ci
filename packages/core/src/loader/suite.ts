import { readFileSync } from 'node:fs';
import { parseSuite } from './parse-suite.js';
import type { Suite } from '../types/index.js';

export { parseSuite, resolveSuiteTools } from './parse-suite.js';

export function loadSuiteFromFile(path: string): Suite {
  const text = readFileSync(path, 'utf8');
  return parseSuite(text);
}
