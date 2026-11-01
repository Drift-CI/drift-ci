/**
 * Strip a single surrounding markdown code fence (```json … ``` or ``` … ```)
 * from a judge response and return the inner text. Judge models routinely wrap
 * their JSON in a fence despite the prompt asking them not to, which makes a
 * strict `JSON.parse(text.trim())` fail and silently drop the verdict (the
 * parser fragility surfaced by the test-app dogfood).
 *
 * This is intentionally narrow: it removes ONLY a surrounding fence. It does
 * NOT extract a JSON object out of prose or regex out a number — the caller
 * still strict-parses the full object (arch §10), so an attacker who controls
 * the candidate output cannot use this to inject a score.
 */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  // String ops rather than a regex: the old pattern backtracked polynomially on
  // inputs like "```" + many spaces (CodeQL js/polynomial-redos).
  if (trimmed.length < 6 || !trimmed.startsWith("```") || !trimmed.endsWith("```")) return trimmed;
  let inner = trimmed.slice(3, -3);
  if (inner.slice(0, 4).toLowerCase() === "json") inner = inner.slice(4);
  return inner.trim();
}
