/**
 * Claude models in the 4.7+ generation removed the sampling parameters
 * (`temperature` / `top_p` / `top_k`) and return a 400
 * (`"temperature is deprecated for this model"`) if they are sent. Earlier
 * generations — Opus 4.6 and older, Sonnet 4.6/4.5, Haiku 4.5 — still accept
 * them.
 *
 * Matched by case-insensitive substring so Bedrock's `anthropic.`-prefixed and
 * region-prefixed model ids are covered too.
 *
 * Keep this list in sync as new sampling-param-free Claude models ship.
 */
const SAMPLING_PARAM_FREE = ['opus-4-7', 'opus-4-8', 'fable', 'mythos'];

export function claudeModelRejectsSamplingParams(model: string): boolean {
  const id = model.toLowerCase();
  return SAMPLING_PARAM_FREE.some((needle) => id.includes(needle));
}
