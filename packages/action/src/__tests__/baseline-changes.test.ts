import { describe, it, expect } from 'vitest';

import { lineDiff, summariseBaselineChanges } from '../baseline-changes.js';

describe('lineDiff', () => {
  it('marks identical text as all unchanged', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { op: ' ', text: 'a' },
      { op: ' ', text: 'b' },
    ]);
  });
  it('handles pure additions', () => {
    expect(lineDiff('a', 'a\nb')).toEqual([
      { op: ' ', text: 'a' },
      { op: '+', text: 'b' },
    ]);
  });
  it('handles pure deletions', () => {
    expect(lineDiff('a\nb', 'a')).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
    ]);
  });
  it('handles a mixed change', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'x' },
      { op: ' ', text: 'c' },
    ]);
  });
  it('handles empty strings', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(lineDiff('', 'a')).toEqual([{ op: '+', text: 'a' }]);
    expect(lineDiff('a', '')).toEqual([{ op: '-', text: 'a' }]);
  });
  it('ignores a single trailing newline difference', () => {
    expect(lineDiff('a\n', 'a').every((l) => l.op === ' ')).toBe(true);
  });
  it('handles large unrelated inputs quickly and boundedly', () => {
    const a = Array.from({ length: 5000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 5000 }, (_, i) => `b${i}`).join('\n');
    const t = Date.now();
    const d = lineDiff(a, b);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(d.length).toBeGreaterThan(0);
    expect(d.length).toBeLessThanOrEqual(4000);
  });
  it('strips common prefix and suffix', () => {
    const d = lineDiff('p\nold\ns', 'p\nnew\ns');
    expect(d.map((l) => l.op).join('')).toBe(' -+ ');
  });
  it('normalises CRLF to LF', () => {
    expect(lineDiff('a\r\nb', 'a\nb').every((l) => l.op === ' ')).toBe(true);
  });
});

const bl = (o: Record<string, unknown>): string => JSON.stringify(o);

function runFull(
  base: Record<string, string | null>,
  head: Record<string, string | null>,
  warnings: string[] = [],
) {
  return summariseBaselineChanges(
    [...new Set([...Object.keys(base), ...Object.keys(head)])],
    (p) => base[p] ?? null,
    (p) => head[p] ?? null,
    (m) => warnings.push(m),
  );
}
function run(
  base: Record<string, string | null>,
  head: Record<string, string | null>,
  warnings: string[] = [],
) {
  return runFull(base, head, warnings).changes;
}

describe('summariseBaselineChanges', () => {
  it('classifies each kind and orders them', () => {
    const base = {
      '.drift/baseline/u.json': bl({ caseId: 'u', score: 0.5, output: 'x' }),
      '.drift/baseline/r.json': bl({ caseId: 'r', score: 0.5, output: 'x' }),
      '.drift/baseline/l1.json': bl({ caseId: 'l1', score: 0.9, output: 'x' }),
      '.drift/baseline/l2.json': bl({ caseId: 'l2', score: 0.9, output: 'x' }),
      '.drift/baseline/o.json': bl({ caseId: 'o', score: 0.5, output: 'x' }),
      '.drift/baseline/gone.json': bl({ caseId: 'gone', score: 0.8, output: 'x' }),
    };
    const head = {
      '.drift/baseline/u.json': bl({ caseId: 'u', score: 0.5, output: 'x', capturedAt: 'new' }),
      '.drift/baseline/r.json': bl({ caseId: 'r', score: 0.7, output: 'x' }),
      '.drift/baseline/l1.json': bl({ caseId: 'l1', score: 0.8, output: 'x' }),
      '.drift/baseline/l2.json': bl({ caseId: 'l2', score: 0.4, output: 'x' }),
      '.drift/baseline/o.json': bl({ caseId: 'o', score: 0.5, output: 'y' }),
      '.drift/baseline/new.json': bl({ caseId: 'new', score: 0.95, output: 'z' }),
    };
    const out = run(base, head);
    expect(out.map((c) => [c.caseId, c.kind])).toEqual([
      ['l2', 'lowered'],
      ['l1', 'lowered'],
      ['r', 'raised'],
      ['o', 'output-changed'],
      ['new', 'added'],
      ['gone', 'removed'],
      ['u', 'unchanged'],
    ]);
    const added = out.find((c) => c.kind === 'added')!;
    expect(added.newScore).toBe(0.95);
    expect(added.oldScore).toBeUndefined();
    const removed = out.find((c) => c.kind === 'removed')!;
    expect(removed.oldScore).toBe(0.8);
  });

  it('reports the skipped count', () => {
    const r = runFull({ 'a.json': '{nope' }, { 'a.json': bl({ score: 1 }) });
    expect(r.skipped).toBe(1);
  });

  it('skips unparseable JSON with a warning', () => {
    const w: string[] = [];
    const out = run({ 'a.json': '{nope' }, { 'a.json': bl({ score: 1, output: '' }) }, w);
    expect(out).toEqual([]);
    expect(w).toHaveLength(1);
  });

  it('skips a file with no numeric score', () => {
    const w: string[] = [];
    const out = run({ 'a.json': bl({ output: 'x' }) }, { 'a.json': bl({ score: 1, output: 'x' }) }, w);
    expect(out).toEqual([]);
    expect(w).toHaveLength(1);
  });

  it('falls back to the file base name for caseId', () => {
    const out = run({}, { '.drift/baseline/my-case.json': bl({ score: 1, output: 'x' }) });
    expect(out[0]!.caseId).toBe('my-case');
  });

  it('ignores non-json files', () => {
    expect(run({ 'a.txt': 'x' }, { 'a.txt': 'y' })).toEqual([]);
  });

  it('lets reader errors propagate', () => {
    expect(() =>
      summariseBaselineChanges(['a.json'], () => { throw new Error('git'); }, () => null, () => {}),
    ).toThrow('git');
  });
});
