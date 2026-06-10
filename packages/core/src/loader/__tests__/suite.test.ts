import { describe, it, expect } from 'vitest';
import { parseSuite } from '../suite.js';

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
