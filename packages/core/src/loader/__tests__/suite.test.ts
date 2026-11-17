import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';
import { parseSuite } from '../suite.js';
import { SuiteSchema } from '../../types/index.js';

describe('parseSuite', () => {
  it('parses a minimal valid suite', () => {
    const yaml = `
version: 1
id: my-suite
name: My Suite
cases:
  - id: c1
    input: hi
    expected: hi
`;
    const s = parseSuite(yaml);
    expect(s.id).toBe('my-suite');
    expect(s.cases).toHaveLength(1);
    expect(s.cases[0].id).toBe('c1');
  });

  it('rejects a suite where a case has both input and messages', () => {
    const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: hi
    messages:
      - role: user
        content: hi
`;
    expect(() => parseSuite(yaml)).toThrow(
      /exactly one of .input. or .messages./,
    );
  });

  it('rejects a suite where a case has neither input nor messages', () => {
    const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    expected: hi
`;
    expect(() => parseSuite(yaml)).toThrow(
      /exactly one of .input. or .messages./,
    );
  });

  it('rejects duplicate case IDs', () => {
    const yaml = `
version: 1
id: s
name: S
cases:
  - id: dup
    input: a
  - id: dup
    input: b
`;
    expect(() => parseSuite(yaml)).toThrow(/unique/);
  });

  it('rejects json-schema evaluator without a schema field', () => {
    const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [json-schema]
`;
    expect(() => parseSuite(yaml)).toThrow(/json-schema/);
  });

  it('parses a contains evaluator with required substrings', () => {
    const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [contains]
    contains: [refund, 5 business days]
`;
    const suite = parseSuite(yaml);
    expect(suite.cases[0].contains).toEqual(['refund', '5 business days']);
  });

  it('rejects contains evaluator without a contains field', () => {
    const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [contains]
`;
    expect(() => parseSuite(yaml)).toThrow(/non-empty .contains. field/);
  });

  it('rejects an empty contains field', () => {
    const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [contains]
    contains: []
`;
    expect(() => parseSuite(yaml)).toThrow();
  });

  it('rejects bad case-id format', () => {
    const yaml = `
version: 1
id: s
name: S
cases:
  - id: Case With Spaces
    input: a
`;
    expect(() => parseSuite(yaml)).toThrow();
  });

  // ─── rubric-checklist (M30, arch §10) ────────────────────────────────

  describe('rubric-checklist YAML', () => {
    it('rejects a rubric with fewer than 2 items (test 8)', () => {
      const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [rubric-checklist]
    rubric:
      - "Only one item — should be rejected"
`;
      expect(() => parseSuite(yaml)).toThrow(/at least 2 items/i);
    });

    it('rejects a rubric with more than 20 items (test 9)', () => {
      const items = Array.from({ length: 21 }, (_, i) => `        - "Item ${i + 1}"`).join('\n');
      const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [rubric-checklist]
    rubric:
${items}
`;
      expect(() => parseSuite(yaml)).toThrow(/at most 20 items/i);
    });

    it('rejects an even-length majority quorum (test 22)', () => {
      const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [rubric-checklist]
    rubric:
      - "Item one"
      - "Item two"
    rubricQuorum:
      judges: [a, b, c, d]
      threshold: majority
`;
      expect(() => parseSuite(yaml)).toThrow(/odd number of judges/);
    });

    it('accepts an even-length unanimous quorum (no tie-break ambiguity)', () => {
      const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [rubric-checklist]
    rubric:
      - "Item one"
      - "Item two"
    rubricQuorum:
      judges: [a, b]
      threshold: unanimous
`;
      const s = parseSuite(yaml);
      expect(s.cases[0].rubricQuorum?.judges).toEqual(['a', 'b']);
    });

    it('rejects a rubric-checklist evaluator without a `rubric` field', () => {
      const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [rubric-checklist]
`;
      expect(() => parseSuite(yaml)).toThrow(/must define a .rubric. field/);
    });

    it('parses a shorthand string-array rubric', () => {
      const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [rubric-checklist]
    rubric:
      - "Returns one of: positive, negative, neutral"
      - "Includes a confidence score"
`;
      const s = parseSuite(yaml);
      expect(s.cases[0].rubric).toHaveLength(2);
    });

    it('parses a rich rubric with mode + weight + id', () => {
      const yaml = `
version: 1
id: s
name: S
cases:
  - id: c
    input: a
    evaluators: [rubric-checklist]
    rubric:
      - id: cite-policy
        text: Cites the 30-day return window
        weight: 0.5
        mode: strict
      - id: empathy
        text: Acknowledges customer frustration
        weight: 0.5
        mode: lenient
`;
      const s = parseSuite(yaml);
      expect(s.cases[0].rubric).toHaveLength(2);
      const r = s.cases[0].rubric;
      if (!r) throw new Error('rubric expected');
      expect(typeof r[0]).toBe('object');
    });
  });
});

describe('parseSuite tools', () => {
  const suite = (body: string) => `
version: 1
id: s
name: S
${body}`;

  it('merges suite tools into each case: replacement in place, then case-only tools', () => {
    const s = parseSuite(
      suite(`tools:
  - name: a
    description: suite a
  - name: b
cases:
  - id: c1
    input: q
    tools:
      - name: c
      - name: a
        description: case a
  - id: c2
    input: q
`),
    );
    expect(s.cases[0].tools?.map((t) => [t.name, t.description])).toEqual([
      ['a', 'case a'],
      ['b', undefined],
      ['c', undefined],
    ]);
    expect(s.cases[1].tools?.map((t) => t.name)).toEqual(['a', 'b']);
    expect(s.tools?.map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('leaves tools undefined on a case with no effective tools', () => {
    const s = parseSuite(suite(`cases:\n  - id: c1\n    input: q\n`));
    expect(s.cases[0].tools).toBeUndefined();
    expect('tools' in s.cases[0]).toBe(false);
  });

  it('accepts a per-case tool-call case with expectedCalls and a suite tool', () => {
    const s = parseSuite(
      suite(`tools:
  - name: get_order
cases:
  - id: c1
    input: q
    expectedCalls:
      - name: get_order
        arguments: { order_id: ORD-1 }
    evaluators: [tool-call]
  - id: c2
    input: thanks
    expectedCalls: []
    evaluators: [tool-call]
`),
    );
    expect(s.cases[0].expectedCalls?.[0].arguments).toEqual({ order_id: 'ORD-1' });
  });

  it('rejects per-case tool-call without expectedCalls', () => {
    const run = () =>
      parseSuite(
        suite(`tools:
  - name: a
cases:
  - id: c1
    input: q
    evaluators: [tool-call]
`),
      );
    expect(run).toThrow(z.ZodError);
    expect(run).toThrow(/tool-call/);
  });

  it('rejects per-case tool-call without tools', () => {
    const run = () =>
      parseSuite(
        suite(`cases:
  - id: c1
    input: q
    expectedCalls: []
    evaluators: [{ name: tool-call }]
`),
      );
    expect(run).toThrow(z.ZodError);
  });

  it('rejects an expectedCalls name that is not an effective tool', () => {
    let err: unknown;
    try {
      parseSuite(
        suite(`tools:
  - name: a
cases:
  - id: c1
    input: q
    expectedCalls:
      - name: nope
`),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(z.ZodError);
    const issue = (err as z.ZodError).issues[0];
    expect(issue.message).toBe('case c1: expectedCalls names unknown tool "nope"');
    expect(issue.path).toEqual(['cases', 0, 'expectedCalls', 0, 'name']);
  });

  const issueOf = (yaml: string): z.core.$ZodIssue => {
    try {
      parseSuite(yaml);
    } catch (e) {
      expect(e).toBeInstanceOf(z.ZodError);
      return (e as z.ZodError).issues[0];
    }
    throw new Error('expected parseSuite to throw');
  };

  it('accepts toolResults naming effective tools (suite and case tools)', () => {
    const s = parseSuite(
      suite(`tools:
  - name: get_order
cases:
  - id: c1
    input: q
    tools:
      - name: refund_order
    toolResults:
      - name: get_order
        arguments: { order_id: ORD-1 }
        result: { status: delivered }
      - name: refund_order
        result: { ok: true }
    maxSteps: 4
    expectedCalls:
      - name: get_order
    evaluators: [tool-call]
`),
    );
    expect(s.cases[0].toolResults?.map((r) => r.name)).toEqual(['get_order', 'refund_order']);
    expect(s.cases[0].maxSteps).toBe(4);
  });

  it('rejects a toolResults name that is not an effective tool', () => {
    const issue = issueOf(
      suite(`tools:
  - name: a
cases:
  - id: c1
    input: q
    toolResults:
      - name: a
        result: 1
      - name: nope
        result: 1
`),
    );
    expect(issue.message).toBe('case c1: toolResults names unknown tool "nope"');
    expect(issue.path).toEqual(['cases', 0, 'toolResults', 1, 'name']);
  });

  it('rejects toolResults on a case without any tools', () => {
    const issue = issueOf(
      suite(`cases:
  - id: c1
    input: q
    toolResults:
      - name: a
        result: 1
`),
    );
    expect(issue.message).toBe('case c1: toolResults needs at least one tool');
    expect(issue.path).toEqual(['cases', 0, 'toolResults']);
  });

  it('rejects maxSteps without toolResults', () => {
    const issue = issueOf(
      suite(`tools:
  - name: a
cases:
  - id: c1
    input: q
    maxSteps: 3
`),
    );
    expect(issue.message).toBe('case c1: `maxSteps` is only allowed together with `toolResults`');
    expect(issue.path).toEqual(['cases', 0, 'maxSteps']);
  });

  it('parses every example suite exactly as the schema does (except tools.yaml, which merges tools)', () => {
    const dir = fileURLToPath(new URL('../../../../../examples/suites', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') && f !== 'tools.yaml');
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(parseSuite(text)).toStrictEqual(SuiteSchema.parse(yamlLoad(text)));
    }
  });

  it('parses examples/suites/tools.yaml and merges the suite tools into each case', () => {
    const dir = fileURLToPath(new URL('../../../../../examples/suites', import.meta.url));
    const suite = parseSuite(readFileSync(join(dir, 'tools.yaml'), 'utf8'));
    const byId = Object.fromEntries(suite.cases.map((c) => [c.id, c]));
    expect(suite.cases).toHaveLength(4);
    expect(byId.order_lookup.tools?.map((t) => t.name)).toEqual(['get_order', 'cancel_order']);
    expect(byId.thanks_no_tool.expectedCalls).toEqual([]);
    expect(byId.case_level_tool.tools?.map((t) => t.name)).toEqual([
      'get_order',
      'cancel_order',
      'send_receipt',
    ]);
  });

  it('rejects a tool whose parameters are not an object schema', () => {
    expect(() =>
      parseSuite(suite(`cases:
  - id: c1
    input: q
    tools:
      - name: t
        parameters: { type: string }
`)),
    ).toThrow(/parameters must be a JSON Schema object/);
  });

  it('rejects misspelled tool keys', () => {
    expect(() =>
      parseSuite(suite(`tools:
  - name: t
    paramaters: { type: object }
cases:
  - id: c1
    input: q
`)),
    ).toThrow(/Unrecognized key/);
    expect(() =>
      parseSuite(suite(`tools:
  - name: t
    input_schema: { type: object }
cases:
  - id: c1
    input: q
`)),
    ).toThrow(/Unrecognized key/);
  });
});
