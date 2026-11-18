import { describe, expect, it } from 'vitest';
import {
  exceedsDepth,
  filterArgs,
  isFreeText,
  MAX_JSON_DEPTH,
  normaliseTools,
  redactDeep,
  TOOL_NAME_RE,
} from '../trace-tools.js';
import { Skip } from '../skip.js';

function skipReason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof Skip) return err.reason;
    throw err;
  }
  throw new Error('expected a skip');
}

describe('isFreeText', () => {
  it('is false for a 40-character string and true for 41', () => {
    expect(isFreeText('a'.repeat(40))).toBe(false);
    expect(isFreeText('a'.repeat(41))).toBe(true);
  });

  it('is true for a string with a line break', () => {
    expect(isFreeText('a\nb')).toBe(true);
  });

  it('is false for non-strings', () => {
    expect(isFreeText(42)).toBe(false);
    expect(isFreeText(null)).toBe(false);
    expect(isFreeText(true)).toBe(false);
  });

  it('looks inside arrays and objects', () => {
    expect(isFreeText(['x', ['y', 'a'.repeat(41)]])).toBe(true);
    expect(isFreeText({ a: { b: 'x\ny' } })).toBe(true);
    expect(isFreeText({ a: ['short', 1], b: { c: 'ok' } })).toBe(false);
  });
});

describe('filterArgs', () => {
  it('drops a top-level free-text argument', () => {
    expect(filterArgs({ order_id: 'ORD-1', reason: 'r'.repeat(41) })).toEqual({ order_id: 'ORD-1' });
  });

  it('drops a key whose nested value contains free text', () => {
    expect(filterArgs({ meta: { note: 'x\ny' }, n: 2 })).toEqual({ n: 2 });
    expect(filterArgs({ tags: ['a', 'b'.repeat(50)], n: 2 })).toEqual({ n: 2 });
  });

  it('keeps an empty object empty', () => {
    expect(filterArgs({})).toEqual({});
  });
});

describe('redactDeep', () => {
  const up = (s: string) => s.toUpperCase();
  it('applies the function to every string leaf', () => {
    expect(redactDeep({ a: 'x', b: ['y', { c: 'z' }], n: 1, t: null }, up)).toEqual({
      a: 'X',
      b: ['Y', { c: 'Z' }],
      n: 1,
      t: null,
    });
    expect(redactDeep('s', up)).toBe('S');
  });
});

describe('normaliseTools', () => {
  const params = { type: 'object', properties: { order_id: { type: 'string' } } };

  it('normalises OpenAI tool definitions', () => {
    expect(
      normaliseTools([
        { type: 'function', function: { name: 'get_order', description: 'Look up', parameters: params } },
      ]),
    ).toEqual([{ name: 'get_order', description: 'Look up', parameters: params }]);
  });

  it('normalises Anthropic tool definitions', () => {
    expect(normaliseTools([{ name: 'get_order', description: 'Look up', input_schema: params }])).toEqual([
      { name: 'get_order', description: 'Look up', parameters: params },
    ]);
  });

  it('leaves out parameters when the tool has no schema', () => {
    const [a] = normaliseTools([{ type: 'function', function: { name: 'ping' } }]);
    const [b] = normaliseTools([{ name: 'ping' }]);
    expect(a).toEqual({ name: 'ping' });
    expect('parameters' in a).toBe(false);
    expect(b).toEqual({ name: 'ping' });
  });

  it.each([
    ['a non-array', { name: 'x' }],
    ['an unrecognised entry', [{ foo: 1 }]],
    ['a bad name', [{ name: 'bad name' }]],
    ['a name over 64 characters', [{ name: 'a'.repeat(65) }]],
    ['a duplicate name', [{ name: 'x' }, { type: 'function', function: { name: 'x' } }]],
    ['65 tools', Array.from({ length: 65 }, (_, i) => ({ name: `t${i}` }))],
    ['a non-object schema', [{ name: 'x', input_schema: 'nope' }]],
    ['a schema that is not type object', [{ name: 'x', input_schema: { type: 'string' } }]],
    ['a non-string description', [{ name: 'x', description: 5 }]],
  ])('throws invalid tool definitions for %s', (_label, raw) => {
    expect(skipReason(() => normaliseTools(raw))).toBe('invalid tool definitions');
  });

  it('accepts 64 tools', () => {
    expect(normaliseTools(Array.from({ length: 64 }, (_, i) => ({ name: `t${i}` })))).toHaveLength(64);
  });
});

describe('exceedsDepth', () => {
  const nestArrays = (n: number): unknown => {
    let v: unknown = 1;
    for (let i = 0; i < n; i++) v = [v];
    return v;
  };
  const nestObjects = (n: number): unknown => {
    let v: unknown = 'leaf';
    for (let i = 0; i < n; i++) v = { x: v };
    return v;
  };

  it('counts each container level: a primitive is depth 0, {} and [] are depth 1', () => {
    expect(exceedsDepth('s', 0)).toBe(false);
    expect(exceedsDepth({}, 0)).toBe(true);
    expect(exceedsDepth({}, 1)).toBe(false);
    expect(exceedsDepth({ a: [1] }, 1)).toBe(true);
    expect(exceedsDepth({ a: [1] }, 2)).toBe(false);
  });

  it('accepts depth 64 and rejects 65 by default', () => {
    expect(MAX_JSON_DEPTH).toBe(64);
    expect(exceedsDepth(nestArrays(64))).toBe(false);
    expect(exceedsDepth(nestArrays(65))).toBe(true);
    expect(exceedsDepth(nestObjects(64))).toBe(false);
    expect(exceedsDepth(nestObjects(65))).toBe(true);
  });

  it('handles very deep values without overflowing the stack', () => {
    expect(exceedsDepth(nestArrays(100_000))).toBe(true);
    expect(exceedsDepth(nestObjects(100_000))).toBe(true);
  });
});

describe('TOOL_NAME_RE', () => {
  it('matches 1-64 letters, digits, _ or -', () => {
    expect(TOOL_NAME_RE.test('get_order-2')).toBe(true);
    expect(TOOL_NAME_RE.test('a'.repeat(64))).toBe(true);
    expect(TOOL_NAME_RE.test('a'.repeat(65))).toBe(false);
    expect(TOOL_NAME_RE.test('bad name')).toBe(false);
    expect(TOOL_NAME_RE.test('')).toBe(false);
  });
});

describe('__proto__ keys', () => {
  const parsed = JSON.parse('{"__proto__":{"a":1},"n":2}') as Record<string, unknown>;

  it('filterArgs keeps an own __proto__ key as data', () => {
    const out = filterArgs(parsed);
    expect(Object.keys(out)).toEqual(['__proto__', 'n']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(JSON.stringify(out)).toBe('{"__proto__":{"a":1},"n":2}');
  });

  it('redactDeep keeps an own __proto__ key as data', () => {
    const out = redactDeep(parsed, (s) => s) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['__proto__', 'n']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(JSON.stringify(out)).toBe('{"__proto__":{"a":1},"n":2}');
  });
});
