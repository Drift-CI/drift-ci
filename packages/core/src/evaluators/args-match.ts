// Argument matching shared by the `tool-call` evaluator and the multi-step tool loop.

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Deep equality; strings compare after trim, everything else exactly. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ka = Object.keys(ao);
    const kb = Object.keys(bo);
    return ka.length === kb.length && ka.every((k) => k in bo && valuesEqual(ao[k], bo[k]));
  }
  if (typeof a === 'number' && typeof b === 'string') return numEqualsString(a, b);
  if (typeof a === 'string' && typeof b === 'number') return numEqualsString(b, a);
  return a === b;
}

/** `2139` equals `"02139"`; only plain decimals qualify, so `"1e3"` stays unequal. */
function numEqualsString(n: number, s: string): boolean {
  const t = s.trim();
  return PLAIN_NUMBER.test(t) && Number(t) === n;
}

/**
 * True when every key listed in `listed` equals (`valuesEqual`) the actual value at that key.
 * Unlisted keys are ignored at the top level only; nothing listed always matches.
 */
export function argsMatch(
  listed: Record<string, unknown> | undefined,
  actual: Record<string, unknown>,
): boolean {
  return Object.entries(listed ?? {}).every(([k, v]) => valuesEqual(v, actual[k]));
}
