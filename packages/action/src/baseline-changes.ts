export type DiffLine = { op: ' ' | '-' | '+'; text: string };

function toLines(s: string): string[] {
  const n = s.replace(/\r\n?/g, '\n');
  return n === '' ? [] : n.split('\n');
}

/** LCS line diff. Normalises CRLF to LF. Identical inputs → all ' ' lines. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = toLines(a);
  const y = toLines(b);
  const n = x.length;
  const m = y.length;
  // lcs[i][j] = LCS length of x[i..] and y[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
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
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
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
 * Sorted: lowered (largest drop first), raised, output-changed, added, removed, unchanged.
 */
export function summariseBaselineChanges(
  files: string[],
  readBase: (path: string) => string | null,
  readHead: (path: string) => string | null,
  warn: (msg: string) => void,
): BaselineChange[] {
  const changes: BaselineChange[] = [];
  for (const path of files) {
    if (!path.endsWith('.json')) continue;
    const baseText = readBase(path);
    const headText = readHead(path);
    if (baseText === null && headText === null) continue;

    const base = baseText === null ? null : parseBaseline(baseText);
    const head = headText === null ? null : parseBaseline(headText);
    if ((baseText !== null && base === null) || (headText !== null && head === null)) {
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
  return changes.sort((p, q) => {
    const k = KIND_ORDER[p.kind] - KIND_ORDER[q.kind];
    if (k !== 0) return k;
    if (p.kind === 'lowered') return drop(q) - drop(p);
    if (p.kind === 'raised') return drop(p) - drop(q);
    return 0;
  });
}
