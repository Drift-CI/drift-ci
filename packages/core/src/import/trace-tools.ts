import { Skip } from './skip.js';

/** A tool definition in the suite's shape. */
export interface NormalisedTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/** Valid tool (and call) names, as the suite schema requires. */
export const TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Deepest nesting accepted in recorded arguments and tool schemas. */
export const MAX_JSON_DEPTH = 64;
const MAX_TOOLS = 64;
const FREE_TEXT_MAX = 40;

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * True when `v` nests deeper than `max`. Depth counts container levels: a primitive is
 * depth 0, `{}` and `[]` are depth 1, `{ a: [1] }` is depth 2. Iterative, so it is safe on
 * untrusted input of any depth; run it before anything that recurses into the value.
 */
export function exceedsDepth(v: unknown, max: number = MAX_JSON_DEPTH): boolean {
  const stack: [unknown, number][] = [[v, 1]];
  while (stack.length > 0) {
    const [x, depth] = stack.pop()!;
    if (typeof x !== 'object' || x === null) continue;
    if (depth > max) return true;
    for (const child of Object.values(x)) stack.push([child, depth + 1]);
  }
  return false;
}

/** Set `k` as an own data property, so a `__proto__` key stays data instead of a prototype. */
function setOwn(out: Record<string, unknown>, k: string, value: unknown): void {
  Object.defineProperty(out, k, { value, enumerable: true, writable: true, configurable: true });
}

function toolFrom(name: unknown, description: unknown, schema: unknown): NormalisedTool {
  if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) throw new Skip('invalid tool definitions');
  const tool: NormalisedTool = { name };
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') throw new Skip('invalid tool definitions');
    tool.description = description;
  }
  if (schema !== undefined && schema !== null) {
    if (!isObject(schema) || schema.type !== 'object' || exceedsDepth(schema)) {
      throw new Skip('invalid tool definitions');
    }
    tool.parameters = schema;
  }
  return tool;
}

/**
 * Normalise a trace's `tools` (OpenAI `{ type: 'function', function: {...} }` or Anthropic
 * `{ name, description?, input_schema? }`) to the suite's tool shape.
 * Throws `Skip('invalid tool definitions')` for anything else, or a schema nested too deep.
 */
export function normaliseTools(raw: unknown): NormalisedTool[] {
  if (!Array.isArray(raw) || raw.length > MAX_TOOLS) throw new Skip('invalid tool definitions');
  const tools = raw.map((t): NormalisedTool => {
    if (!isObject(t)) throw new Skip('invalid tool definitions');
    if (t.type === 'function' && isObject(t.function)) {
      return toolFrom(t.function.name, t.function.description, t.function.parameters);
    }
    if ((t.type === undefined || t.type === 'custom') && t.name !== undefined) {
      return toolFrom(t.name, t.description, t.input_schema);
    }
    throw new Skip('invalid tool definitions');
  });
  if (new Set(tools.map((t) => t.name)).size !== tools.length) throw new Skip('invalid tool definitions');
  return tools;
}

/**
 * True for a string over 40 characters or containing a line break, anywhere inside `v`.
 * Recursive: only call it on values already checked with `exceedsDepth`.
 */
export function isFreeText(v: unknown): boolean {
  if (typeof v === 'string') return v.length > FREE_TEXT_MAX || v.includes('\n');
  if (Array.isArray(v)) return v.some(isFreeText);
  if (isObject(v)) return Object.values(v).some(isFreeText);
  return false;
}

const REDACTION_MARKER = '[REDACTED:';

/**
 * True when a string anywhere inside `v` holds a redaction marker.
 * Recursive: only call it on values already checked with `exceedsDepth`.
 */
export function hasRedaction(v: unknown): boolean {
  if (typeof v === 'string') return v.includes(REDACTION_MARKER);
  if (Array.isArray(v)) return v.some(hasRedaction);
  if (isObject(v)) return Object.values(v).some(hasRedaction);
  return false;
}

/**
 * Drop every top-level argument whose value is, or contains, free text or a redacted
 * secret (which can never match at run time). Run it on redacted arguments.
 */
export function filterArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (!isFreeText(v) && !hasRedaction(v)) setOwn(out, k, v);
  return out;
}

/**
 * Apply `redact` to every string leaf of `v`, keeping its structure.
 * Recursive: only call it on values already checked with `exceedsDepth`.
 */
export function redactDeep(v: unknown, redact: (s: string) => string): unknown {
  if (typeof v === 'string') return redact(v);
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, redact));
  if (isObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) setOwn(out, k, redactDeep(x, redact));
    return out;
  }
  return v;
}
