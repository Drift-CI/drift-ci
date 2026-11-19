import { load as yamlLoad } from 'js-yaml';
import { Document, isMap, isScalar, isSeq, parseDocument, stringify, type YAMLSeq } from 'yaml';
import { parseSuite } from '../loader/parse-suite.js';
import type { TestCase, ToolDefinition } from '../types/index.js';

export type SuiteEditErrorCode = 'parse' | 'no-cases' | 'invalid';

export class SuiteEditError extends Error {
  constructor(
    readonly code: SuiteEditErrorCode,
    message: string,
    readonly issues?: string[],
  ) {
    super(message);
    this.name = 'SuiteEditError';
  }
}

export interface AppendCasesResult {
  /** The new suite text (the unchanged input when nothing was added). */
  text: string;
  /** Case ids appended, in order. */
  added: string[];
  /** Case ids skipped because the suite (or an earlier input case) already had them. */
  present: string[];
  /** True when the suite text was null/blank and a new suite was generated. */
  created: boolean;
  /** True when no per-case evaluators were given and the suite's would not use the production reply. */
  evaluatorWarning: boolean;
  /** The cases as appended (with per-case evaluators applied and suite-identical tools removed). */
  addedCases: TestCase[];
  /**
   * Cases not appended because their `toolResults`/`expectedCalls` name tools that neither the
   * case nor the suite defines. `tools` holds the missing names, sorted and unique. A skipped
   * case appears in neither `added` nor `present`.
   */
  skipped: { id: string; reason: 'tools not defined'; tools: string[] }[];
}

/** Evaluators that compare free text with `expected` usefully. */
const REFERENCE_EVALUATORS = new Set(['llm-judge', 'cosine-similarity']);
const YAML_OPTS = { lineWidth: 0, flowCollectionPadding: false } as const;

/** Field order for appended cases, so they read the same however their keys arrived (e.g. from Postgres jsonb). */
const CASE_KEY_ORDER = [
  'id', 'description', 'systemPrompt', 'input', 'messages', 'context',
  'tools', 'toolResults', 'maxSteps', 'expectedCalls', 'expected',
  'contains', 'schema', 'criteria', 'rubric', 'rubricQuorum',
  'evaluators', 'threshold', 'maxTokens', 'runs', 'tags',
];

/** Field order inside tool, tool-result and expected-call entries. */
const ENTRY_KEY_ORDER = ['name', 'description', 'parameters', 'arguments', 'result'];

/** `src` with its keys in `order`; unknown keys follow in their original order. */
function withKeyOrder(src: Record<string, unknown>, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of order) if (Object.hasOwn(src, k) && src[k] !== undefined) out[k] = src[k];
  for (const k of Object.keys(src)) if (!Object.hasOwn(out, k) && src[k] !== undefined) out[k] = src[k];
  return out;
}

/** The case with its keys, and those of its tool and step entries, in a fixed order. */
function ordered(c: TestCase): TestCase {
  const out = withKeyOrder(c as unknown as Record<string, unknown>, CASE_KEY_ORDER);
  for (const k of ['tools', 'toolResults', 'expectedCalls']) {
    const list = out[k];
    if (Array.isArray(list)) {
      out[k] = list.map((e) =>
        typeof e === 'object' && e !== null && !Array.isArray(e)
          ? withKeyOrder(e as Record<string, unknown>, ENTRY_KEY_ORDER)
          : e,
      );
    }
  }
  return out as unknown as TestCase;
}

/**
 * Insert `cases` after the last item of the block `cases` list, leaving every existing byte as it
 * was (comments, flow-collection padding, line endings). Returns null when the list's layout
 * can't be determined, so the caller falls back to re-rendering the document.
 */
function spliceCases(text: string, seq: YAMLSeq, cases: TestCase[]): string | null {
  const last = seq.items[seq.items.length - 1] as { range?: [number, number, number] } | undefined;
  const range = last?.range;
  if (!range) return null;
  const lineStart = text.lastIndexOf('\n', range[0] - 1) + 1;
  const indent = text.slice(lineStart, range[0]).match(/^( *)- *$/)?.[1];
  if (indent === undefined) return null;

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rendered = stringify(cases, { lineWidth: 0, aliasDuplicateObjects: false, flowCollectionPadding: false })
    .trimEnd()
    .split('\n')
    .map((l) => (l === '' ? l : indent + l))
    .join(eol) + eol;

  const nl = text.indexOf('\n', Math.max(0, range[1] - 1));
  if (nl === -1) return text + eol + rendered;
  return text.slice(0, nl + 1) + rendered + text.slice(nl + 1);
}

function isBlankDocument(doc: Document): boolean {
  return doc.contents === null || (isScalar(doc.contents) && doc.contents.value == null);
}

function joinComments(...parts: (string | null | undefined)[]): string | undefined {
  const present = parts.filter((p): p is string => !!p);
  return present.length > 0 ? present.join('\n') : undefined;
}

function evaluatorNames(specs: unknown): string[] {
  if (!Array.isArray(specs)) return ['exact-match']; // the runner's default
  return specs.map((s) => (typeof s === 'string' ? s : String((s as { name?: unknown }).name)));
}

function withEvaluators(c: TestCase, evaluators: string[] | undefined): TestCase {
  if (!evaluators?.length) return c;
  const { tags, ...rest } = c;
  return { ...rest, evaluators: [...evaluators], ...(tags ? { tags } : {}) } as TestCase;
}

const DEFAULT_PARAMETERS = { type: 'object', properties: {} };

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined);
  const ak = keys(ao);
  return ak.length === keys(bo).length && ak.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
}

/** Compares tools the way `parseSuite` would see them (absent `parameters` takes the default). */
function sameTool(a: ToolDefinition, b: ToolDefinition): boolean {
  return deepEqual(
    { ...a, parameters: a.parameters ?? DEFAULT_PARAMETERS },
    { ...b, parameters: b.parameters ?? DEFAULT_PARAMETERS },
  );
}

/** Removes case tools identical to the suite tool of the same name; drops `tools` when none remain. */
function dedupeTools(c: TestCase, suiteTools: ToolDefinition[]): TestCase {
  if (!c.tools) return c;
  const own = c.tools.filter((t) => {
    const shared = suiteTools.find((s) => s.name === t.name);
    return !shared || !sameTool(shared, t);
  });
  if (own.length === c.tools.length) return c;
  if (own.length > 0) return { ...c, tools: own };
  const { tools: _t, ...rest } = c;
  return rest as TestCase;
}

/** Tool names a case calls that are not among its effective tools (case tools plus suite tools). */
function missingTools(c: TestCase, suiteTools: ToolDefinition[]): string[] {
  const known = new Set([...suiteTools, ...(c.tools ?? [])].map((t) => t.name));
  const called = [...(c.toolResults ?? []), ...(c.expectedCalls ?? [])].map((x) => x.name);
  return [...new Set(called.filter((n) => !known.has(n)))].sort();
}

type Issue = { path: PropertyKey[]; message: string };

/**
 * Appends cases to suite YAML text, preserving comments and untouched lines. A null, blank,
 * comments-only, `---` or `null` suite is replaced by a new one. The result is validated with
 * `parseSuite`; an invalid result throws. `limit` stops after that many new cases.
 */
export function appendCasesToSuite(
  suiteText: string | null,
  cases: TestCase[],
  opts: { evaluators?: string[]; limit?: number } = {},
): AppendCasesResult {
  let doc: Document | undefined;
  let leadingComment: string | undefined;
  if (suiteText !== null) {
    doc = parseDocument(suiteText);
    if (doc.errors.length > 0) throw new SuiteEditError('parse', doc.errors[0].message);
    if (isBlankDocument(doc)) {
      leadingComment = joinComments(
        doc.commentBefore,
        isScalar(doc.contents) ? doc.contents.commentBefore : undefined,
      );
      doc = undefined;
    }
  }
  const created = doc === undefined;
  if (!doc) {
    doc = new Document({
      version: 1,
      id: 'imported',
      name: 'Imported production traces',
      evaluators: ['llm-judge'],
      cases: [],
    });
    if (leadingComment) doc.commentBefore = leadingComment;
  }

  const seq = doc.get('cases', true);
  if (!isSeq(seq)) throw new SuiteEditError('no-cases', 'The suite has no `cases` list.');
  // A non-empty block list is edited in place; a new suite or a flow list (`cases: []`) is re-rendered.
  const canSplice = !created && !seq.flow && seq.items.length > 0;
  seq.flow = false;
  const seen = new Set<string>();
  for (const item of seq.items) {
    const id = isMap(item) ? item.get('id') : undefined;
    if (typeof id === 'string') seen.add(id);
  }

  // Read suite values the way parseSuite does (js-yaml), so tools resolve as the runner sees them.
  let loaded: unknown;
  if (created) {
    loaded = doc.toJS();
  } else {
    try {
      loaded = yamlLoad(suiteText as string);
    } catch (e) {
      throw new SuiteEditError('parse', (e as Error).message.split('\n')[0]);
    }
  }
  const suiteJs = (loaded ?? {}) as { evaluators?: unknown; tools?: unknown };
  const suiteTools = (Array.isArray(suiteJs.tools) ? suiteJs.tools : []).filter(
    (t): t is ToolDefinition => typeof t === 'object' && t !== null && typeof t.name === 'string',
  );

  const addedCases: TestCase[] = [];
  const present: string[] = [];
  const skipped: AppendCasesResult['skipped'] = [];
  for (const c of cases) {
    if (opts.limit !== undefined && addedCases.length >= opts.limit) break;
    if (seen.has(c.id)) {
      present.push(c.id);
      continue;
    }
    const deduped = dedupeTools(c, suiteTools);
    const missing = missingTools(deduped, suiteTools);
    if (missing.length > 0) {
      skipped.push({ id: c.id, reason: 'tools not defined', tools: missing });
      continue;
    }
    seen.add(c.id);
    addedCases.push(ordered(withEvaluators(deduped, opts.evaluators)));
  }
  const added = addedCases.map((c) => c.id);

  if (addedCases.length === 0) {
    return { text: suiteText ?? '', added, present, created: false, evaluatorWarning: false, addedCases, skipped };
  }

  // Only cases without their own evaluators fall back to the suite's.
  const evaluatorWarning =
    addedCases.some((c) => !c.evaluators?.length) &&
    !evaluatorNames(suiteJs.evaluators).some((n) => REFERENCE_EVALUATORS.has(n));

  const existingIds = seq.items.map((item) => (isMap(item) ? item.get('id') : undefined));
  let text = canSplice ? spliceCases(suiteText as string, seq, addedCases) : null;
  // Safety net: the spliced text must parse to exactly the old cases followed by the new ones.
  if (text !== null) {
    const ids = (parseDocument(text).toJS() as { cases?: { id?: unknown }[] } | null)?.cases?.map((c) => c?.id);
    if (JSON.stringify(ids) !== JSON.stringify([...existingIds, ...added])) text = null;
  }
  if (text === null) {
    for (const tc of addedCases) seq.add(doc.createNode(tc, { aliasDuplicateObjects: false }));
    text = doc.toString(YAML_OPTS);
  }
  try {
    parseSuite(text);
  } catch (e) {
    const issues = (e as { issues?: Issue[] }).issues;
    if (!issues) {
      const first = (e as Error).message.split('\n')[0];
      throw new SuiteEditError('invalid', first, [first]);
    }
    const parsed = parseDocument(text).toJS() as { cases?: { id?: unknown }[] };
    const labelled = issues.map((issue) => {
      const id =
        issue.path[0] === 'cases' && typeof issue.path[1] === 'number'
          ? parsed.cases?.[issue.path[1]]?.id
          : undefined;
      if (typeof id === 'string' && issue.message.startsWith(`case ${id}:`)) return issue.message;
      const label =
        typeof id === 'string'
          ? [id, ...issue.path.slice(2)].join('.')
          : issue.path.join('.');
      return `${label}: ${issue.message}`;
    });
    throw new SuiteEditError('invalid', labelled[0] ?? 'invalid suite', labelled);
  }

  return { text, added, present, created, evaluatorWarning, addedCases, skipped };
}
