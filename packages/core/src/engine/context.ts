import type { MessageParam, TestCase } from '../types/index.js';

/** A case's context as a list of passages, or undefined when it has none. */
export function contextPassages(tc: Pick<TestCase, 'context'>): string[] | undefined {
  if (tc.context === undefined) return undefined;
  return typeof tc.context === 'string' ? [tc.context] : tc.context;
}

/** The fixed block placed before the final user turn. Documented in the README. */
export function formatContext(passages: string[]): string {
  const numbered = passages.map((p, i) => `[${i + 1}] ${p}`).join('\n');
  return `Answer using the context below.\n\n<context>\n${numbered}\n</context>\n\n`;
}

/** The provider input for a case: its input or messages, with any context prefixed to the last user turn. */
export function withContext(tc: TestCase): string | MessageParam[] {
  const base = tc.messages ?? tc.input;
  if (base === undefined) {
    throw new Error(`Case ${tc.id}: schema guarantees input XOR messages — one must be present`);
  }
  const passages = contextPassages(tc);
  if (!passages) return base;
  const prefix = formatContext(passages);
  if (typeof base === 'string') return prefix + base;
  const lastUser = base.map((m) => m.role).lastIndexOf('user');
  return base.map((m, i) => (i === lastUser ? { ...m, content: prefix + m.content } : m));
}
