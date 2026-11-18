import { describe, expect, it } from 'vitest';
import type { TestCase } from '../../types/index.js';
import { parseDocument } from 'yaml';
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

function parseDocumentCase(text: string, id: string): Record<string, unknown> {
  const raw = parseDocument(text).toJS() as { cases: Record<string, unknown>[] };
  return raw.cases.find((c) => c.id === id)!;
}

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
    expect(r.skipped).toEqual([]);
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
  describe('tool cases', () => {
    const GET_ORDER = {
      name: 'get_order',
      description: 'Look up an order',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
    };
    const TOOL_SUITE = `${SUITE}tools:
  - name: get_order
    description: Look up an order
    parameters:
      type: object
      properties:
        id:
          type: string
`;
    const toolCase = (id: string, extra: Partial<TestCase> = {}): TestCase =>
      mk(id, {
        toolResults: [{ name: 'get_order', result: { status: 'shipped' } }],
        expectedCalls: [{ name: 'get_order', arguments: {} }],
        evaluators: ['tool-call', 'llm-judge'],
        tags: ['imported', 'tools'],
        ...extra,
      });

    it('drops a case tool identical to the suite tool, and the tools key with it', () => {
      const reordered = {
        parameters: { properties: { id: { type: 'string' } }, type: 'object' },
        name: 'get_order',
        description: 'Look up an order',
      };
      const r = appendCasesToSuite(TOOL_SUITE, [toolCase('t1', { tools: [reordered] as TestCase['tools'] })]);
      expect(r.added).toEqual(['t1']);
      expect(r.skipped).toEqual([]);
      expect(r.addedCases[0]).not.toHaveProperty('tools');
      const c = parseSuite(r.text).cases.find((x) => x.id === 't1')!;
      expect(c.tools?.map((t) => t.name)).toEqual(['get_order']);
      expect(parseDocumentCase(r.text, 't1')).not.toHaveProperty('tools');
    });

    it('keeps only the case tools that differ from the suite', () => {
      const other = { name: 'refund_order', parameters: { type: 'object', properties: {} } };
      const changed = { ...GET_ORDER, description: 'Find an order' };
      const r = appendCasesToSuite(TOOL_SUITE, [
        toolCase('t1', { tools: [GET_ORDER, other] as TestCase['tools'] }),
        toolCase('t2', { tools: [changed] as TestCase['tools'] }),
      ]);
      expect(r.addedCases[0].tools).toEqual([other]);
      expect(r.addedCases[1].tools).toEqual([changed]);
      const t2 = parseSuite(r.text).cases.find((x) => x.id === 't2')!;
      expect(t2.tools?.[0].description).toBe('Find an order');
    });

    it('skips cases calling tools defined nowhere and appends the rest', () => {
      const r = appendCasesToSuite(SUITE, [
        mk('plain'),
        toolCase('t1', {
          toolResults: [
            { name: 'b', result: 1 },
            { name: 'a', result: 2 },
          ],
          expectedCalls: [{ name: 'b', arguments: {} }],
        }),
        toolCase('t2', { tools: [GET_ORDER] as TestCase['tools'] }),
      ]);
      expect(r.skipped).toEqual([{ id: 't1', reason: 'tools not defined', tools: ['a', 'b'] }]);
      expect(r.added).toEqual(['plain', 't2']);
      expect(r.present).toEqual([]);
      expect(parseSuite(r.text).cases.map((c) => c.id)).toEqual(['greeting', 'plain', 't2']);
    });

    it('skips when the suite defines only other tools', () => {
      const r = appendCasesToSuite(TOOL_SUITE, [
        toolCase('t1', { expectedCalls: [{ name: 'refund_order', arguments: {} }] }),
      ]);
      expect(r.skipped).toEqual([{ id: 't1', reason: 'tools not defined', tools: ['refund_order'] }]);
    });

    it('resolves names against the suite tools', () => {
      const r = appendCasesToSuite(TOOL_SUITE, [toolCase('t1')]);
      expect(r.added).toEqual(['t1']);
      expect(r.skipped).toEqual([]);
    });

    it('returns the input unchanged when every case is skipped', () => {
      const r = appendCasesToSuite(SUITE, [toolCase('t1')]);
      expect(r).toEqual({
        text: SUITE,
        added: [],
        present: [],
        created: false,
        evaluatorWarning: false,
        addedCases: [],
        skipped: [{ id: 't1', reason: 'tools not defined', tools: ['get_order'] }],
      });
    });

    it('does not warn about evaluators for cases that carry their own', () => {
      const json = TOOL_SUITE.replace('  - llm-judge # judge against expected', '  - json-schema');
      expect(appendCasesToSuite(json, [toolCase('t1')]).evaluatorWarning).toBe(false);
      expect(appendCasesToSuite(json, [toolCase('t1'), mk('plain')]).evaluatorWarning).toBe(true);
    });
  });
});
