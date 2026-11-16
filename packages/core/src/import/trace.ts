import { createHash } from 'node:crypto';
import { redactSecrets } from '../engine/redaction.js';
import { TestCaseSchema, type TestCase } from '../types/index.js';

export type TraceSkipReason =
  | 'invalid-json'
  | 'not-a-chat-trace'
  | 'non-text content'
  | 'tool calls'
  | 'system message mid-conversation'
  | 'no final assistant reply'
  | 'no user turn'
  | 'roles do not alternate'
  | 'empty content';

export type TraceToCaseResult =
  | { ok: true; case: TestCase; redactions: number }
  | { ok: false; reason: TraceSkipReason };

export interface TraceToCaseOptions {
  /** Prefix for the generated case id. Must match /^[a-z0-9\-_]+$/. */
  prefix: string;
}

const PREFIX_RE = /^[a-z0-9\-_]+$/;
const ID_MAX = 80;

type Turn = { role: 'user' | 'assistant'; content: string };

class Skip extends Error {
  constructor(public readonly reason: TraceSkipReason) {
    super(reason);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A message's text: a string, or the `text` parts of a content array joined with \n. */
function textOf(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw new Skip('not-a-chat-trace');
  const texts: string[] = [];
  for (const part of content) {
    if (isObject(part) && (part.type === 'thinking' || part.type === 'redacted_thinking')) continue;
    if (isObject(part) && part.type === 'text' && typeof part.text === 'string') {
      texts.push(part.text);
      continue;
    }
    throw new Skip('non-text content');
  }
  return texts.join('\n');
}

function caseId(rawId: string | undefined, prefix: string, system: string, turns: Turn[]): string {
  if (rawId !== undefined) {
    const clean = rawId
      .toLowerCase()
      .replace(/[^a-z0-9\-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, ID_MAX)
      .replace(/-+$/, '');
    if (clean) return `${prefix}-${clean}`;
  }
  const hash = createHash('sha256')
    .update(JSON.stringify({ system, turns }))
    .digest('hex')
    .slice(0, 12);
  return `${prefix}-${hash}`;
}

function build(trace: unknown, prefix: string): { case: TestCase; redactions: number } {
  if (!isObject(trace) || !Array.isArray(trace.messages)) throw new Skip('not-a-chat-trace');

  const systemParts: string[] = [];
  if (trace.system !== undefined && trace.system !== null) systemParts.push(textOf(trace.system));

  const turns: Turn[] = [];
  for (const m of trace.messages) {
    if (!isObject(m) || typeof m.role !== 'string') throw new Skip('not-a-chat-trace');
    if (
      m.role === 'tool' ||
      m.role === 'function' ||
      (m.function_call !== undefined && m.function_call !== null) ||
      (Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
    ) {
      throw new Skip('tool calls');
    }
    if (m.role === 'system' || m.role === 'developer') {
      if (turns.length > 0) throw new Skip('system message mid-conversation');
      systemParts.push(textOf(m.content));
      continue;
    }
    if (m.role !== 'user' && m.role !== 'assistant') throw new Skip('not-a-chat-trace');
    turns.push({ role: m.role, content: textOf(m.content) });
  }

  if (!turns.some((t) => t.role === 'user')) throw new Skip('no user turn');
  if (turns[turns.length - 1].role !== 'assistant') throw new Skip('no final assistant reply');
  if (turns.some((t, i) => t.role !== (i % 2 === 0 ? 'user' : 'assistant'))) {
    throw new Skip('roles do not alternate');
  }
  if (turns.some((t) => t.content.trim() === '')) throw new Skip('empty content');

  let redactions = 0;
  const redact = (s: string): string => {
    const r = redactSecrets(s);
    redactions += r.redactions.reduce((n, x) => n + x.count, 0);
    return r.text;
  };

  let rawId: string | undefined;
  if (typeof trace.id === 'string') rawId = redact(trace.id);
  else if (typeof trace.id === 'number' && Number.isFinite(trace.id)) rawId = String(trace.id);

  const system = systemParts.filter((s) => s.trim() !== '').join('\n\n');
  const systemPrompt = system ? redact(system) : undefined;
  const red: Turn[] = turns.map((t) => ({ role: t.role, content: redact(t.content) }));
  const prompt = red.slice(0, -1);

  // Built in display order (id, systemPrompt, input|messages, expected, tags), so the YAML reads well.
  const tc: Record<string, unknown> = { id: caseId(rawId, prefix, systemPrompt ?? '', red) };
  if (systemPrompt) tc.systemPrompt = systemPrompt;
  if (prompt.length === 1) tc.input = prompt[0].content;
  else tc.messages = prompt;
  tc.expected = red[red.length - 1].content;
  tc.tags = ['imported'];

  TestCaseSchema.parse(tc); // a failure here is a bug in this function
  return { case: tc as TestCase, redactions };
}

/**
 * Convert one parsed chat trace (OpenAI `messages`, or Anthropic `system` + `messages`)
 * into a suite case. The final assistant turn becomes `expected`; secrets are redacted.
 * Returns a skip reason for traces that can't become a case.
 */
export function traceToCase(trace: unknown, opts: TraceToCaseOptions): TraceToCaseResult {
  if (!PREFIX_RE.test(opts.prefix)) {
    throw new Error(`traceToCase: prefix must match ${PREFIX_RE} (got "${opts.prefix}")`);
  }
  try {
    return { ok: true, ...build(trace, opts.prefix) };
  } catch (err) {
    if (err instanceof Skip) return { ok: false, reason: err.reason };
    throw err;
  }
}
