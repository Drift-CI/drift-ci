/**
 * Line-level unified diff via classic LCS dynamic programming.
 *
 * This is deliberately small — LLM outputs are typically a few dozen
 * lines at most, so the O(n·m) memory cost is fine and a hand-rolled
 * implementation avoids pulling in a 30+ KB diff library at runtime.
 *
 * For each pair of inputs we return a flat array of "tagged lines":
 *   `=`  — present in both, no change
 *   `-`  — only in `before`
 *   `+`  — only in `after`
 *
 * Consumers render this however they like. {@link diffStats} is a
 * cheap summary for UI badges.
 */

export type DiffTag = '=' | '-' | '+';

export interface DiffLine {
  tag: DiffTag;
  text: string;
  /** 1-indexed line number in `before` (undefined when tag === '+'). */
  beforeLine?: number;
  /** 1-indexed line number in `after` (undefined when tag === '-'). */
  afterLine?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

/** Split a string into lines without losing trailing empty lines. */
export function splitLines(input: string): string[] {
  if (input.length === 0) return [];
  return input.split(/\r?\n/);
}

/** Count `+` / `-` / `=` lines in a diff for badge rendering. */
export function diffStats(diff: readonly DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of diff) {
    if (line.tag === '+') added += 1;
    else if (line.tag === '-') removed += 1;
    else unchanged += 1;
  }
  return { added, removed, unchanged };
}

/**
 * Compute a unified line diff between `before` and `after`. Identical
 * inputs produce all `=` lines. Either input may be `null`/empty.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  // Classic LCS table — lcs[i][j] is the length of the longest common
  // subsequence of a[..i] and b[..j].
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Walk the table from bottom-right to top-left, emitting ops in
  // reverse. We then reverse the buffer at the end.
  const out: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      out.push({
        tag: '=',
        text: a[i - 1],
        beforeLine: i,
        afterLine: j,
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      out.push({ tag: '+', text: b[j - 1], afterLine: j });
      j -= 1;
    } else {
      out.push({ tag: '-', text: a[i - 1], beforeLine: i });
      i -= 1;
    }
  }
  return out.reverse();
}
