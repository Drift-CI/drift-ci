import { createHash } from 'node:crypto';
import { redactSecrets } from '../engine/redaction.js';
import { DEFAULT_MAX_STEPS, TestCaseSchema, type TestCase } from '../types/index.js';
import { Skip } from './skip.js';
import type { TraceSkipReason } from './skip.js';
import {
  exceedsDepth,
  filterArgs,
  isObject,
  normaliseTools,
  redactDeep,
  TOOL_NAME_RE,
  type NormalisedTool,
} from './trace-tools.js';

export type { TraceSkipReason };

export type TraceToCaseResult =
  | { ok: true; case: TestCase; redactions: number }
  | { ok: false; reason: TraceSkipReason };

export interface TraceToCaseOptions {
  /** Prefix for the generated case id. Must match /^[a-z0-9\-_]+$/. */
  prefix: string;
}

const PREFIX_RE = /^[a-z0-9\-_]+$/;
const ID_MAX = 80;
/** Assistant replies a tool trace may take after the last user message (the case `maxSteps` cap). */
const MAX_REPLIES = 10;
/** Calls a tool trace may make (the case `expectedCalls` cap). */
const MAX_CALLS = 16;
/** The case schema's limit on a tool description. */
const DESCRIPTION_MAX = 1024;

type Turn = { role: 'user' | 'assistant'; content: string };

type RecordedCall = { id: unknown; name: string; arguments: Record<string, unknown> };
type RecordedResult = { id: unknown; content: string };
type Item =
  | { kind: 'turn'; turn: Turn }
  | { kind: 'calls'; calls: RecordedCall[] }
  | { kind: 'results'; results: RecordedResult[] };
/** A tool step's calls, each paired with its result. */
type PairedStep = { calls: RecordedCall[]; results: string[] };
/** A redacted tool step as hashed into the case id. Keep the shape stable: it changes ids. */
type HashedStep = { calls: { name: string; arguments: Record<string, unknown> }[]; results: string[] };

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

function caseId(
  rawId: string | undefined,
  prefix: string,
  system: string,
  turns: Turn[],
  steps?: HashedStep[],
): string {
  if (rawId !== undefined) {
    const clean = rawId
      .toLowerCase()
      .replace(/[^a-z0-9\-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, ID_MAX)
      .replace(/-+$/, '');
    if (clean) return `${prefix}-${clean}`;
  }
  // Text-only traces hash exactly as before tool support, so their ids don't change.
  const hash = createHash('sha256')
    .update(JSON.stringify(steps ? { system, turns, steps } : { system, turns }))
    .digest('hex')
    .slice(0, 12);
  return `${prefix}-${hash}`;
}

/** A recorded call, after checking its name and that its arguments are a shallow-enough object. */
function recordedCall(id: unknown, name: unknown, args: unknown): RecordedCall {
  if (typeof name !== 'string') throw new Skip('not-a-chat-trace');
  if (!TOOL_NAME_RE.test(name)) throw new Skip('invalid tool arguments');
  // Bound the depth before anything recursive (redaction, the free-text filter, hashing) runs.
  if (!isObject(args) || exceedsDepth(args)) throw new Skip('invalid tool arguments');
  return { id, name, arguments: args };
}

/** OpenAI `tool_calls` entries as recorded calls; `arguments` must be JSON for an object. */
function openAiCalls(raw: unknown[]): RecordedCall[] {
  return raw.map((c) => {
    if (!isObject(c) || !isObject(c.function)) throw new Skip('not-a-chat-trace');
    let args: unknown;
    try {
      args = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments) : undefined;
    } catch {
      throw new Skip('invalid tool arguments');
    }
    return recordedCall(c.id, c.function.name, args);
  });
}

/** An assistant message's text and its calls (OpenAI `tool_calls` or Anthropic `tool_use` blocks). */
function assistantParts(m: Record<string, unknown>): { text: string; calls: RecordedCall[] } {
  const calls: RecordedCall[] = Array.isArray(m.tool_calls) ? openAiCalls(m.tool_calls) : [];
  let content = m.content;
  if (Array.isArray(content)) {
    const rest: unknown[] = [];
    for (const part of content) {
      if (isObject(part) && part.type === 'tool_use') calls.push(recordedCall(part.id, part.name, part.input));
      else rest.push(part);
    }
    content = rest;
  }
  return { text: textOf(content), calls };
}

/** An Anthropic user message made only of `tool_result` blocks, as results; otherwise undefined. */
function anthropicResults(content: unknown): RecordedResult[] | undefined {
  if (!Array.isArray(content) || content.length === 0) return undefined;
  if (!content.every((p) => isObject(p) && p.type === 'tool_result')) return undefined;
  return (content as Record<string, unknown>[]).map((p) => ({ id: p.tool_use_id, content: textOf(p.content) }));
}

/** Pair each step's calls with the results that follow it, by id. `tail` holds only tool items. */
function pairSteps(tail: Item[]): PairedStep[] {
  const steps: PairedStep[] = [];
  for (let i = 0; i < tail.length; i += 2) {
    const calls = tail[i];
    const results = tail[i + 1];
    if (calls.kind !== 'calls' || results?.kind !== 'results') throw new Skip('unanswered tool call');
    const byId = new Map<string, string>();
    for (const r of results.results) {
      if (typeof r.id !== 'string' || byId.has(r.id)) throw new Skip('unanswered tool call');
      byId.set(r.id, r.content);
    }
    const ids = new Set<string>();
    for (const c of calls.calls) {
      if (typeof c.id !== 'string' || ids.has(c.id) || !byId.has(c.id)) throw new Skip('unanswered tool call');
      ids.add(c.id);
    }
    if (ids.size !== byId.size) throw new Skip('unanswered tool call');
    steps.push({ calls: calls.calls, results: calls.calls.map((c) => byId.get(c.id as string)!) });
  }
  return steps;
}

/** Read the messages into text turns, tool-call steps and tool-result turns. */
function readItems(messages: unknown[], systemParts: string[]): Item[] {
  const items: Item[] = [];
  for (const m of messages) {
    if (!isObject(m) || typeof m.role !== 'string') throw new Skip('not-a-chat-trace');
    if (m.role === 'function' || (m.function_call !== undefined && m.function_call !== null)) {
      throw new Skip('legacy function calls');
    }
    if (m.role === 'system' || m.role === 'developer') {
      if (items.length > 0) throw new Skip('system message mid-conversation');
      systemParts.push(textOf(m.content));
      continue;
    }
    let results: RecordedResult[] | undefined;
    if (m.role === 'tool') results = [{ id: m.tool_call_id, content: textOf(m.content) }];
    else if (m.role === 'user') results = anthropicResults(m.content);
    if (results) {
      // Consecutive result messages answer the same step.
      const last = items[items.length - 1];
      if (last?.kind === 'results') last.results.push(...results);
      else items.push({ kind: 'results', results });
      continue;
    }
    if (m.role === 'assistant') {
      const { text, calls } = assistantParts(m);
      items.push(calls.length > 0 ? { kind: 'calls', calls } : { kind: 'turn', turn: { role: 'assistant', content: text } });
      continue;
    }
    if (m.role !== 'user') throw new Skip('not-a-chat-trace');
    items.push({ kind: 'turn', turn: { role: 'user', content: textOf(m.content) } });
  }
  return items;
}

/**
 * Check the shape of a trace with tool items, which has at least one user turn: every tool
 * item after the last user message, then a text-only final reply. Returns the paired steps
 * and the number of assistant replies after the last user message.
 */
function toolSteps(items: Item[]): { steps: PairedStep[]; replies: number } {
  let lastUser = -1;
  items.forEach((it, i) => {
    if (it.kind === 'turn' && it.turn.role === 'user') lastUser = i;
  });
  if (items.slice(0, lastUser).some((it) => it.kind !== 'turn')) {
    throw new Skip('tool calls before the last user message');
  }
  if (items[items.length - 1].kind !== 'turn') throw new Skip('final reply calls tools');
  const tail = items.slice(lastUser + 1, -1);
  const replies = tail.filter((it) => it.kind !== 'results').length + 1;
  const calls = tail.reduce((n, it) => n + (it.kind === 'calls' ? it.calls.length : 0), 0);
  if (replies > MAX_REPLIES || calls > MAX_CALLS) throw new Skip('too many tool steps');
  if (tail.some((it) => it.kind === 'turn')) throw new Skip('roles do not alternate');
  return { steps: pairSteps(tail), replies };
}

/**
 * Assemble a case in display order: id, systemPrompt, input|messages, then `middle`,
 * expected, then `end`. The order lives here so the YAML reads well.
 */
function assembleCase(
  id: string,
  systemPrompt: string | undefined,
  turns: Turn[],
  middle: Record<string, unknown>,
  end: Record<string, unknown>,
): Record<string, unknown> {
  const prompt = turns.slice(0, -1);
  const tc: Record<string, unknown> = { id };
  if (systemPrompt) tc.systemPrompt = systemPrompt;
  if (prompt.length === 1) tc.input = prompt[0].content;
  else tc.messages = prompt;
  Object.assign(tc, middle);
  tc.expected = turns[turns.length - 1].content;
  Object.assign(tc, end);
  return tc;
}

function build(trace: unknown, prefix: string): { case: TestCase; redactions: number } {
  if (!isObject(trace) || !Array.isArray(trace.messages)) throw new Skip('not-a-chat-trace');

  const systemParts: string[] = [];
  if (trace.system !== undefined && trace.system !== null) systemParts.push(textOf(trace.system));

  const items = readItems(trace.messages, systemParts);
  const turns: Turn[] = items.flatMap((it) => (it.kind === 'turn' ? [it.turn] : []));

  if (!turns.some((t) => t.role === 'user')) throw new Skip('no user turn');
  const tool = items.some((it) => it.kind !== 'turn') ? toolSteps(items) : undefined;
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

  if (!tool) {
    const tc = assembleCase(caseId(rawId, prefix, systemPrompt ?? '', red), systemPrompt, red, {}, { tags: ['imported'] });
    TestCaseSchema.parse(tc); // a failure here is a bug in this function
    return { case: tc as TestCase, redactions };
  }

  let tools: NormalisedTool[] | undefined;
  if (trace.tools !== undefined && trace.tools !== null) {
    tools = normaliseTools(trace.tools).map((t) => {
      const out: NormalisedTool = { name: t.name };
      if (t.description !== undefined) out.description = redact(t.description);
      if (t.parameters !== undefined) out.parameters = redactDeep(t.parameters, redact) as Record<string, unknown>;
      return out;
    });
    if (tools.some((t) => (t.description?.length ?? 0) > DESCRIPTION_MAX)) {
      throw new Skip('invalid tool definitions');
    }
    // Without `tools`, undeclared calls are allowed: the suite's tools may define them,
    // and appendCasesToSuite checks that.
    const declared = new Set(tools.map((t) => t.name));
    if (declared.size > 0 && tool.steps.some((st) => st.calls.some((c) => !declared.has(c.name)))) {
      throw new Skip('invalid tool definitions');
    }
  }

  const steps: HashedStep[] = tool.steps.map((st) => ({
    calls: st.calls.map((c) => ({
      name: c.name,
      arguments: redactDeep(c.arguments, redact) as Record<string, unknown>,
    })),
    results: st.results.map(redact),
  }));

  const expectedCalls: Record<string, unknown>[] = [];
  const toolResults: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const st of steps) {
    st.calls.forEach((c, i) => {
      // The free-text filter runs on the redacted arguments.
      const args = filterArgs(c.arguments);
      const call: Record<string, unknown> = Object.keys(args).length > 0 ? { name: c.name, arguments: args } : { name: c.name };
      expectedCalls.push(call);
      // Identical entries collapse. If one call recorded different results, both are kept and
      // the loop's first-match rule serves the first at run time; the spec accepts that.
      const entry = { ...call, result: st.results[i] };
      const key = JSON.stringify(entry);
      if (!seen.has(key)) {
        seen.add(key);
        toolResults.push(entry);
      }
    });
  }

  const middle: Record<string, unknown> = {};
  if (tools?.length) middle.tools = tools;
  middle.toolResults = toolResults;
  if (tool.replies > DEFAULT_MAX_STEPS) middle.maxSteps = tool.replies;
  middle.expectedCalls = expectedCalls;
  const tc = assembleCase(caseId(rawId, prefix, systemPrompt ?? '', red, steps), systemPrompt, red, middle, {
    evaluators: ['tool-call', 'llm-judge'],
    tags: ['imported', 'tools'],
  });

  TestCaseSchema.parse(tc); // a failure here is a bug in this function
  return { case: tc as TestCase, redactions };
}

/**
 * Convert one parsed chat trace (OpenAI `messages`, or Anthropic `system` + `messages`)
 * into a suite case. The final assistant turn becomes `expected`; secrets are redacted.
 * A trace whose tool calls all follow the last user message becomes a multi-step case:
 * the calls become `expectedCalls`, their results scripted `toolResults`.
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
