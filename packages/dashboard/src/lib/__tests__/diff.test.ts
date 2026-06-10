import { describe, it, expect } from 'vitest';
import { diffLines, diffStats, splitLines } from '../diff';

describe('splitLines', () => {
  it('returns an empty array for an empty string', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('splits on \\n and \\r\\n alike', () => {
    expect(splitLines('a\nb\r\nc')).toEqual(['a', 'b', 'c']);
  });

  it('preserves trailing empty lines from a final newline', () => {
    expect(splitLines('a\n')).toEqual(['a', '']);
  });
});

describe('diffLines', () => {
  it('returns all = lines when inputs are identical', () => {
    const out = diffLines('a\nb\nc', 'a\nb\nc');
    expect(out.every((l) => l.tag === '=')).toBe(true);
    expect(out.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('reports an added trailing line as a single + op', () => {
    const out = diffLines('a\nb', 'a\nb\nc');
    expect(out.map((l) => l.tag)).toEqual(['=', '=', '+']);
    expect(out[2].afterLine).toBe(3);
    expect(out[2].text).toBe('c');
  });

  it('reports a removed leading line as a single - op', () => {
    const out = diffLines('a\nb\nc', 'b\nc');
    expect(out.map((l) => l.tag)).toEqual(['-', '=', '=']);
    expect(out[0].beforeLine).toBe(1);
  });

  it('reports a replacement as a -/+ pair', () => {
    const out = diffLines('a\nWAS\nc', 'a\nIS\nc');
    expect(out.map((l) => l.tag)).toEqual(['=', '-', '+', '=']);
    expect(out[1].text).toBe('WAS');
    expect(out[2].text).toBe('IS');
  });

  it('handles all-different inputs', () => {
    const out = diffLines('a\nb', 'c\nd');
    expect(out.map((l) => l.tag).sort()).toEqual(['+', '+', '-', '-']);
  });

  it('handles empty before — every line is a +', () => {
    const out = diffLines('', 'a\nb');
    expect(out.map((l) => l.tag)).toEqual(['+', '+']);
  });

  it('handles empty after — every line is a -', () => {
    const out = diffLines('a\nb', '');
    expect(out.map((l) => l.tag)).toEqual(['-', '-']);
  });

  it('preserves line numbers as 1-indexed positions in the originals', () => {
    const out = diffLines('a\nb\nc', 'a\nx\nc');
    const beforeLines = out
      .filter((l) => l.tag !== '+')
      .map((l) => l.beforeLine);
    const afterLines = out
      .filter((l) => l.tag !== '-')
      .map((l) => l.afterLine);
    expect(beforeLines).toEqual([1, 2, 3]);
    expect(afterLines).toEqual([1, 2, 3]);
  });
});

describe('diffStats', () => {
  it('counts each tag', () => {
    const out = diffLines('a\nb\nc', 'a\nx');
    const stats = diffStats(out);
    expect(stats.added).toBe(1);
    expect(stats.removed).toBe(2);
    expect(stats.unchanged).toBe(1);
  });

  it('returns all-zeros for an empty diff', () => {
    expect(diffStats([])).toEqual({ added: 0, removed: 0, unchanged: 0 });
  });
});
