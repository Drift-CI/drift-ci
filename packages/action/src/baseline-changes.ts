import { OUTPUT_MAX_BYTES } from '@drift-ci/core';

export type DiffLine = { op: ' ' | '-' | '+'; text: string };

const MAX_LINES = 2000;
const MAX_DP_CELLS = 4_000_000;

function toLines(s: string): string[] {
  let n = s.slice(0, OUTPUT_MAX_BYTES).replace(/\r\n?/g, '\n');
  if (n.endsWith('\n')) n = n.slice(0, -1);
  if (n === '') return [];
  const lines = n.split('\n');
  return lines.length > MAX_LINES ? lines.slice(0, MAX_LINES) : lines;
}

/**
 * LCS line diff. Normalises CRLF to LF, ignores one trailing newline, and
 * bounds its input (8 KB / 2,000 lines per side; above ~4M DP cells it
 * degrades to all-removed then all-added). Identical inputs → all ' ' lines.
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = toLines(a);
  const y = toLines(b);
  let lo = 0;
  while (lo < x.length && lo < y.length && x[lo] === y[lo]) lo++;
  let xe = x.length;
  let ye = y.length;
  while (xe > lo && ye > lo && x[xe - 1] === y[ye - 1]) {
    xe--;
    ye--;
  }
  const out: DiffLine[] = [];
  for (let k = 0; k < lo; k++) out.push({ op: ' ', text: x[k]! });
  out.push(...diffMiddle(x.slice(lo, xe), y.slice(lo, ye)));
  for (let k = xe; k < x.length; k++) out.push({ op: ' ', text: x[k]! });
  return out;
}

function diffMiddle(x: string[], y: string[]): DiffLine[] {
  const n = x.length;
  const m = y.length;
  if (n === 0 || m === 0 || n * m > MAX_DP_CELLS) {
    return [
      ...x.map((text): DiffLine => ({ op: '-', text })),
      ...y.map((text): DiffLine => ({ op: '+', text })),
    ];
  }
  const w = m + 1;
  // lcs[i * w + j] = LCS length of x[i..] and y[j..]
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        x[i] === y[j]
          ? lcs[(i + 1) * w + j + 1]! + 1
          : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: ' ', text: x[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      out.push({ op: '-', text: x[i++]! });
    } else {
      out.push({ op: '+', text: y[j++]! });
    }
  }
  while (i < n) out.push({ op: '-', text: x[i++]! });
  while (j < m) out.push({ op: '+', text: y[j++]! });
  return out;
}

export type BaselineChangeKind =
  | 'lowered'
  | 'raised'
  | 'output-changed'
  | 'added'
  | 'removed'
  | 'unchanged';

export interface BaselineChange {
  caseId: string;
  path: string;
  kind: BaselineChangeKind;
  oldScore?: number;
  newScore?: number;
  oldOutput?: string;
  newOutput?: string;
}

interface Parsed {
  caseId?: string;
  score: number;
  output: string;
}

function parseBaseline(text: string): Parsed | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['score'] !== 'number' || !Number.isFinite(r['score'])) return null;
  return {
    caseId: typeof r['caseId'] === 'string' ? r['caseId'] : undefined,
    score: r['score'],
    output: typeof r['output'] === 'string' ? r['output'] : '',
  };
}

const KIND_ORDER: Record<BaselineChangeKind, number> = {
  lowered: 0,
  raised: 1,
  'output-changed': 2,
  added: 3,
  removed: 4,
  unchanged: 5,
};

function baseName(path: string): string {
  const leaf = path.split('/').pop() ?? path;
  return leaf.replace(/\.json$/, '');
}

/**
 * files: repo-relative changed baseline paths (from GitOps.diffBaselineFiles).
 * readBase/readHead may throw; the caller handles git failure.
 * `skipped` counts files dropped as unparseable or score-less.
 * Sorted: lowered (largest drop first), raised, output-changed, added, removed, unchanged.
 */
export function summariseBaselineChanges(
  files: string[],
  readBase: (path: string) => string | null,
  readHead: (path: string) => string | null,
  warn: (msg: string) => void,
): { changes: BaselineChange[]; skipped: number } {
  let skipped = 0;
  const changes: BaselineChange[] = [];
  for (const path of files) {
    if (!path.endsWith('.json')) continue;
    const baseText = readBase(path);
    const headText = readHead(path);
    if (baseText === null && headText === null) continue;

    const base = baseText === null ? null : parseBaseline(baseText);
    const head = headText === null ? null : parseBaseline(headText);
    if ((baseText !== null && base === null) || (headText !== null && head === null)) {
      skipped++;
      warn(`skipping ${path}: unparseable baseline JSON or no numeric score`);
      continue;
    }

    const caseId = head?.caseId ?? base?.caseId ?? baseName(path);
    if (!base && head) {
      changes.push({ caseId, path, kind: 'added', newScore: head.score, newOutput: head.output });
    } else if (base && !head) {
      changes.push({ caseId, path, kind: 'removed', oldScore: base.score, oldOutput: base.output });
    } else if (base && head) {
      const kind: BaselineChangeKind =
        head.score < base.score
          ? 'lowered'
          : head.score > base.score
            ? 'raised'
            : head.output !== base.output
              ? 'output-changed'
              : 'unchanged';
      changes.push({
        caseId,
        path,
        kind,
        oldScore: base.score,
        newScore: head.score,
        oldOutput: base.output,
        newOutput: head.output,
      });
    }
  }
  const drop = (c: BaselineChange): number => (c.oldScore ?? 0) - (c.newScore ?? 0);
  changes.sort((p, q) => {
    const k = KIND_ORDER[p.kind] - KIND_ORDER[q.kind];
    if (k !== 0) return k;
    if (p.kind === 'lowered') return drop(q) - drop(p);
    if (p.kind === 'raised') return drop(p) - drop(q);
    return 0;
  });
  return { changes, skipped };
}
