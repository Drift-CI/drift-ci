import { readFileSync } from 'node:fs';
import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';
import { SuiteSchema, type Suite, type TestCase } from '../types/index.js';

/**
 * Merges the suite's `tools` into every case. A case's effective tools are the suite tools in
 * suite order, each replaced by a same-named case tool, followed by the case-only tools in case
 * order. A case with no effective tools has no `tools` field.
 */
export function resolveSuiteTools(suite: Suite): Suite {
  const shared = suite.tools ?? [];
  return {
    ...suite,
    cases: suite.cases.map((tc) => {
      const own = tc.tools ?? [];
      const sharedNames = new Set(shared.map((t) => t.name));
      const merged = [
        ...shared.map((t) => own.find((o) => o.name === t.name) ?? t),
        ...own.filter((o) => !sharedNames.has(o.name)),
      ];
      const { tools: _ignored, ...rest } = tc;
      void _ignored;
      return merged.length > 0 ? { ...rest, tools: merged } : rest;
    }),
  };
}

const usesEvaluator = (tc: TestCase, name: string): boolean =>
  tc.evaluators?.some((e) => (typeof e === 'string' ? e : e.name) === name) ?? false;

/** Rules that need the resolved tools; returned as Zod issues so callers render them like schema errors. */
function toolIssues(suite: Suite): z.core.$ZodIssue[] {
  const issues: z.core.$ZodIssue[] = [];
  suite.cases.forEach((tc, i) => {
    const names = new Set((tc.tools ?? []).map((t) => t.name));
    if (usesEvaluator(tc, 'tool-call') && (tc.expectedCalls === undefined || names.size === 0)) {
      issues.push({
        code: 'custom',
        path: ['cases', i],
        message: `case ${tc.id}: the \`tool-call\` evaluator requires \`expectedCalls\` and at least one tool.`,
        input: tc,
      });
    }
    tc.expectedCalls?.forEach((call, j) => {
      if (!names.has(call.name)) {
        issues.push({
          code: 'custom',
          path: ['cases', i, 'expectedCalls', j, 'name'],
          message: `case ${tc.id}: expectedCalls names unknown tool "${call.name}"`,
          input: call.name,
        });
      }
    });
  });
  return issues;
}

export function parseSuite(yamlText: string): Suite {
  const raw = yamlLoad(yamlText);
  const suite = resolveSuiteTools(SuiteSchema.parse(raw));
  const issues = toolIssues(suite);
  if (issues.length > 0) throw new z.ZodError(issues);
  return suite;
}

export function loadSuiteFromFile(path: string): Suite {
  const text = readFileSync(path, 'utf8');
  return parseSuite(text);
}
