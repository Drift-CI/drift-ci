import { Document, isMap, isScalar, isSeq, parseDocument } from 'yaml';
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
  return ak.length === keys(bo).length && ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
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
  const { tools: _dropped, ...rest } = c;
  void _dropped;
  return own.length > 0 ? ({ ...c, tools: own } as TestCase) : (rest as TestCase);
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
  seq.flow = false;
  const seen = new Set<string>();
  for (const item of seq.items) {
    const id = isMap(item) ? item.get('id') : undefined;
    if (typeof id === 'string') seen.add(id);
  }

  const suiteJs = (doc.toJS() ?? {}) as { evaluators?: unknown; tools?: unknown };
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
    addedCases.push(withEvaluators(deduped, opts.evaluators));
  }
  const added = addedCases.map((c) => c.id);

  if (addedCases.length === 0) {
    return { text: suiteText ?? '', added, present, created: false, evaluatorWarning: false, addedCases, skipped };
  }

  // Only cases without their own evaluators fall back to the suite's.
  const evaluatorWarning =
    addedCases.some((c) => !c.evaluators?.length) &&
    !evaluatorNames(suiteJs.evaluators).some((n) => REFERENCE_EVALUATORS.has(n));

  for (const tc of addedCases) seq.add(doc.createNode(tc));
  const text = doc.toString(YAML_OPTS);
  try {
    parseSuite(text);
  } catch (e) {
    const issues = (e as { issues?: Issue[] }).issues;
    if (!issues) {
      const first = (e as Error).message.split('\n')[0];
      throw new SuiteEditError('invalid', first, [first]);
    }
    const parsed = doc.toJS() as { cases?: { id?: unknown }[] };
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
