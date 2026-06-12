/**
 * Remove trailing `/` characters from a URL/base path.
 *
 * Implemented as a linear scan rather than `replace(/\/+$/, '')`: the regex
 * form is a polynomial-ReDoS hazard (CodeQL `js/polynomial-redos`) on input
 * that is a long run of slashes, because the unanchored search retries the
 * greedy `\/+` from every position. This scan is O(n) and allocation-free.
 */
export function stripTrailingSlashes(input: string): string {
  let end = input.length;
  while (end > 0 && input.charCodeAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }
  return end === input.length ? input : input.slice(0, end);
}
