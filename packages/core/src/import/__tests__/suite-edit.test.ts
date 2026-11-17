import { describe, expect, it } from 'vitest';
import type { TestCase } from '../../types/index.js';
import { parseSuite } from '../../loader/parse-suite.js';
import { appendCasesToSuite, SuiteEditError } from '../suite-edit.js';

const SUITE = `# Hand-written suite — keep this comment
version: 1
id: support
name: Support bot
evaluators:
  - llm-judge # judge against expected
cases:
  - id: greeting
    input: "Hello"
    expected: "Hi there"
`;

const mk = (id: string, extra: Partial<TestCase> = {}): TestCase =>
  ({ id, input: 'q', expected: 'a', tags: ['imported'], ...extra }) as TestCase;

function fail(fn: () => unknown): SuiteEditError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SuiteEditError);
    return e as SuiteEditError;
  }
  throw new Error('did not throw');
}

describe('appendCasesToSuite', () => {
  it('appends cases, keeps comments and untouched lines byte-identical', () => {
    const r = appendCasesToSuite(SUITE, [mk('prod-1')]);
    expect(r.text.startsWith(SUITE)).toBe(true);
    expect(r.text).toContain('# judge against expected');
    expect(r.added).toEqual(['prod-1']);
    expect(r.created).toBe(false);
    expect(parseSuite(r.text).cases.map((c) => c.id)).toEqual(['greeting', 'prod-1']);
  });

  it('skips ids already in the suite and duplicates within the input', () => {
    const r = appendCasesToSuite(SUITE, [mk('greeting'), mk('x'), mk('x')]);
    expect(r.added).toEqual(['x']);
    expect(r.present).toEqual(['greeting', 'x']);
  });

  it('stops after `limit` new cases and does not count later duplicates', () => {
    const r = appendCasesToSuite(SUITE, [mk('a'), mk('b'), mk('greeting')], { limit: 1 });
    expect(r.added).toEqual(['a']);
    expect(r.present).toEqual([]);
  });

  it('returns the input unchanged when nothing is added', () => {
    const r = appendCasesToSuite(SUITE, [mk('greeting')]);
    expect(r.text).toBe(SUITE);
    expect(r.added).toEqual([]);
    expect(r.evaluatorWarning).toBe(false);
  });

  it.each([[null], [''], ['  \n'], ['# nothing here\n'], ['---\n'], ['null\n'], ['---\nnull\n'], ['~\n']])(
    'creates a new suite from %j',
    (text) => {
      const r = appendCasesToSuite(text, [mk('a')]);
      expect(r.created).toBe(true);
      const s = parseSuite(r.text);
      expect(s.id).toBe('imported');
      expect(s.name).toBe('Imported production traces');
      expect(s.evaluators).toEqual(['llm-judge']);
      expect(s.cases).toHaveLength(1);
      expect(r.evaluatorWarning).toBe(false);
    },
  );

  it.each([['# my notes\n'], ['# my notes\n---\n'], ['# my notes\nnull\n']])(
    'keeps leading comments when replacing %j',
    (text) => {
      const r = appendCasesToSuite(text, [mk('a')]);
      expect(r.text).toContain('# my notes');
      expect(parseSuite(r.text).cases).toHaveLength(1);
    },
  );

  it('converts a flow-style cases list to block style', () => {
    for (const cases of ['[]', '[{id: a, input: hi, expected: x}]']) {
      const text = `version: 1\nid: s\nname: S\nevaluators: [llm-judge]\ncases: ${cases}\n`;
      const r = appendCasesToSuite(text, [mk('m', { expected: 'line1\nline2' })]);
      expect(r.text).toContain('expected: |-');
      expect(parseSuite(r.text).cases.at(-1)?.expected).toBe('line1\nline2');
    }
  });

  it('puts evaluators before tags', () => {
    const r = appendCasesToSuite(SUITE, [mk('prod-o')], { evaluators: ['llm-judge'] });
    const t = r.text;
    expect(t.indexOf('evaluators:', t.indexOf('prod-o'))).toBeLessThan(t.indexOf('tags:'));
    expect(parseSuite(t).cases[1].evaluators).toEqual(['llm-judge']);
  });

  it('warns when the suite evaluators would not use the production reply', () => {
    const json = SUITE.replace('  - llm-judge # judge against expected', '  - json-schema');
    expect(appendCasesToSuite(json, [mk('a')]).evaluatorWarning).toBe(true);
    const none = SUITE.replace('evaluators:\n  - llm-judge # judge against expected\n', '');
    expect(appendCasesToSuite(none, [mk('a')]).evaluatorWarning).toBe(true);
    expect(appendCasesToSuite(json, [mk('a')], { evaluators: ['cosine-similarity'] }).evaluatorWarning).toBe(false);
    expect(appendCasesToSuite(SUITE, [mk('a')]).evaluatorWarning).toBe(false);
  });

  it('throws parse for YAML that will not parse', () => {
    const e = fail(() => appendCasesToSuite('cases: [\n', [mk('a')]));
    expect(e.code).toBe('parse');
  });

  it('throws no-cases when cases is missing or not a list', () => {
    expect(fail(() => appendCasesToSuite('version: 1\nid: s\n', [mk('a')])).code).toBe('no-cases');
    expect(fail(() => appendCasesToSuite('cases: 3\n', [mk('a')])).code).toBe('no-cases');
  });

  it('throws invalid with issues labelled by case id', () => {
    const e = fail(() => appendCasesToSuite(SUITE, [mk('bad', { evaluators: ['contains'] })]));
    expect(e.code).toBe('invalid');
    expect(e.issues?.length).toBeGreaterThan(0);
    expect(e.issues?.join('\n')).toContain('bad');
  });

  it('does not repeat the case id when the message already starts with it', () => {
    const e = fail(() => appendCasesToSuite(SUITE, [mk('t', { evaluators: ['tool-call'] })]));
    const lines = e.issues!.filter((l) => l.includes('the `tool-call` evaluator requires'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^case t: the/);
  });
});
