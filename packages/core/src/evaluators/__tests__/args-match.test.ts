import { describe, it, expect } from 'vitest';
import { argsMatch, valuesEqual } from '../args-match.js';

describe('valuesEqual', () => {
  it('trims strings and compares nested values recursively', () => {
    expect(valuesEqual(' a ', 'a')).toBe(true);
    expect(valuesEqual({ x: [1, ' b'] }, { x: [1, 'b'] })).toBe(true);
    expect(valuesEqual({ x: 1 }, { x: 1, y: 2 })).toBe(false);
  });

  it('equates a number with a plain-decimal string only', () => {
    expect(valuesEqual(2139, '02139')).toBe(true);
    expect(valuesEqual('1e3', 1000)).toBe(false);
  });
});

describe('argsMatch', () => {
  it('matches when no arguments are listed', () => {
    expect(argsMatch(undefined, { a: 1 })).toBe(true);
    expect(argsMatch({}, {})).toBe(true);
  });

  it('requires every listed key to equal the actual value and ignores unlisted keys', () => {
    expect(argsMatch({ order_id: 'ORD-1' }, { order_id: ' ORD-1 ', extra: true })).toBe(true);
    expect(argsMatch({ order_id: 'ORD-1' }, { order_id: 'ORD-2' })).toBe(false);
    expect(argsMatch({ order_id: 'ORD-1', n: 2 }, { order_id: 'ORD-1' })).toBe(false);
  });

  it('compares nested listed values exactly (unlisted keys ignored at the top level only)', () => {
    expect(argsMatch({ q: { a: 1 } }, { q: { a: 1, b: 2 } })).toBe(false);
  });
});
