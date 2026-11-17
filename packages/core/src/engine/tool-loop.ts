import type { ConversationTurn, ProviderAdapter, ToolResultContent } from '../providers/base.js';
import { callIdAt } from '../providers/base.js';
import { argsMatch } from '../evaluators/args-match.js';
import { DEFAULT_MAX_STEPS } from '../types/index.js';
import type { TestCase, TokenUsage, ToolCall } from '../types/index.js';
import { withContext } from './context.js';

/** Characters of a tool result shown on a `←` transcript line. */
const RESULT_CHARS = 200;

export interface ToolLoopResult {
  /** Transcript lines, a blank line, then the final text; just the text when no tool was called. */
  output: string;
  /** Every tool call across all steps, in order. */
  toolCalls: ToolCall[];
  /** Token usage summed across steps. */
  usage: TokenUsage;
  /** Provider calls made. */
  steps: number;
  /** True when the loop ended because the last allowed step still called tools. */
  stoppedAtStepLimit: boolean;
}

function timeoutError(): Error {
  const e = new Error('Timeout');
  (e as Error & { code?: string }).code = 'TIMEOUT';
  return e;
}

/** Rejects with a `TIMEOUT` error when `promise` takes longer than `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      handle = setTimeout(() => reject(timeoutError()), ms);
    }),
  ]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const cached =
    a.cachedInputTokens !== undefined || b.cachedInputTokens !== undefined
      ? { cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0) }
      : {};
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    ...cached,
  };
}

const truncate = (s: string): string =>
  s.length > RESULT_CHARS ? `${s.slice(0, RESULT_CHARS - 1)}…` : s;

/**
 * Runs a multi-step tool case: calls the provider, answers each tool call from the case's
 * `toolResults` (first entry with the same name whose listed arguments match; otherwise an
 * error result), and repeats until the model answers without a call or `maxSteps` is reached.
 * Each provider call gets `timeoutMs`, and the whole loop at most `timeoutMs × maxSteps`.
 * Provider errors propagate for the runner to classify.
 */
export async function runToolLoop(
  provider: ProviderAdapter,
  tc: TestCase,
  opts: { timeoutMs: number },
): Promise<ToolLoopResult> {
  const scripted = tc.toolResults ?? [];
  const maxSteps = tc.maxSteps ?? DEFAULT_MAX_STEPS;
  const deadline = Date.now() + opts.timeoutMs * maxSteps;
  const base = withContext(tc);
  const turns: ConversationTurn[] =
    typeof base === 'string' ? [{ role: 'user', content: base }] : base.map((m) => ({ ...m }));

  const transcript: string[] = [];
  const allCalls: ToolCall[] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let steps = 0;

  for (;;) {
    steps++;
    const left = deadline - Date.now();
    if (left <= 0) throw timeoutError();
    const res = await withTimeout(
      provider.complete(turns, tc.systemPrompt, {
        temperature: 0,
        maxTokens: tc.maxTokens,
        ...(tc.tools?.length ? { tools: tc.tools } : {}),
      }),
      Math.min(opts.timeoutMs, left),
    );
    usage = addUsage(usage, res.usage);
    const calls = (res.toolCalls ?? []).map((c, i) => ({
      ...c,
      id: callIdAt(c, allCalls.length + i + 1),
    }));

    if (calls.length === 0) {
      const final = res.text.trim();
      if (transcript.length === 0) {
        return { output: res.text, toolCalls: allCalls, usage, steps, stoppedAtStepLimit: false };
      }
      const output = final ? `${transcript.join('\n')}\n\n${final}` : transcript.join('\n');
      return { output, toolCalls: allCalls, usage, steps, stoppedAtStepLimit: false };
    }

    const text = res.text.trim();
    if (text) transcript.push(text);
    for (const c of calls) transcript.push(`→ ${c.name} ${JSON.stringify(c.arguments)}`);
    allCalls.push(...calls);

    // The step's text is already in the transcript, so it isn't repeated as a final answer.
    if (steps >= maxSteps) {
      return { output: transcript.join('\n'), toolCalls: allCalls, usage, steps, stoppedAtStepLimit: true };
    }

    turns.push({ role: 'assistant', content: res.text, toolCalls: calls });
    const results: ToolResultContent[] = calls.map((c) => {
      const match = scripted.find((r) => r.name === c.name && argsMatch(r.arguments, c.arguments));
      if (!match) {
        return {
          callId: c.id,
          name: c.name,
          content: `no result scripted for ${c.name} with these arguments`,
          isError: true,
        };
      }
      const content = typeof match.result === 'string' ? match.result : JSON.stringify(match.result);
      return { callId: c.id, name: c.name, content };
    });
    for (const r of results) transcript.push(`← ${truncate(r.content)}`);
    turns.push({ role: 'tool', results });
  }
}
