import type { EvalInput, EvalResult, Evaluator } from './base.js';

export interface RefusalDetectionOptions {
  patterns?: string[];
  replaceDefaults?: boolean;
  caseSensitive?: boolean;
}

// Curated list of phrases that open a refusal. Kept deliberately narrow —
// false positives on legitimate "I can't tell from the text" answers are
// worse than a missed refusal, since this evaluator feeds regression
// detection. Authors are expected to extend via `patterns`.
export const DEFAULT_REFUSAL_PATTERNS: readonly string[] = Object.freeze([
  "I can't (help|assist|do|answer|provide|generate|create|continue)",
  'I cannot (help|assist|do|answer|provide|generate|create|continue)',
  "I won't (help|assist|do|answer|provide|generate|create|continue)",
  "I'm (not able|unable|really not able) to",
  'I am (not able|unable) to',
  'I do(?:n\'?t| not) (?:feel comfortable|have the ability)',
  "As an AI(?: language model)?",
  'As a (?:large )?language model',
  "I'm sorry,? but I can('?t| not)",
  'I apologize,? but I',
  "I'm not comfortable",
  'Sorry,? (?:I|but) (?:can\'?t|cannot)',
]);

export class RefusalDetectionEvaluator implements Evaluator {
  readonly name = 'refusal-detection';
  private readonly patterns: RegExp[];

  constructor(options: RefusalDetectionOptions = {}) {
    const flags = options.caseSensitive ? '' : 'i';
    const sources = options.replaceDefaults
      ? options.patterns ?? []
      : [...DEFAULT_REFUSAL_PATTERNS, ...(options.patterns ?? [])];
    if (sources.length === 0) {
      throw new Error(
        'RefusalDetectionEvaluator: at least one pattern is required. ' +
          'Drop `replaceDefaults` or supply `patterns`.',
      );
    }
    this.patterns = sources.map((p) => new RegExp(p, flags));
  }

  async evaluate({ output }: EvalInput): Promise<EvalResult> {
    // Look only at the opening slice: refusals lead, they don't bury.
    const head = output.slice(0, 400);
    for (const re of this.patterns) {
      const match = head.match(re);
      if (match) {
        return {
          score: 0,
          reason: `Refusal pattern matched: ${truncate(match[0])}`,
          metadata: { matchedPattern: re.source, matchedText: match[0] },
        };
      }
    }
    return { score: 1, reason: 'No refusal pattern detected' };
  }
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
