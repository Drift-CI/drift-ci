import { Document, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { parseSuite } from '../loader/parse-suite.js';
import type { TestCase } from '../types/index.js';

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
  /** The cases as appended (with per-case evaluators applied). */
  addedCases: TestCase[];
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

  const addedCases: TestCase[] = [];
  const present: string[] = [];
  for (const c of cases) {
    if (opts.limit !== undefined && addedCases.length >= opts.limit) break;
    if (seen.has(c.id)) {
      present.push(c.id);
      continue;
    }
    seen.add(c.id);
    addedCases.push(withEvaluators(c, opts.evaluators));
  }
  const added = addedCases.map((c) => c.id);

  if (addedCases.length === 0) {
    return { text: suiteText ?? '', added, present, created: false, evaluatorWarning: false, addedCases };
  }

  const evaluatorWarning =
    !opts.evaluators?.length &&
    !evaluatorNames((doc.toJS() as { evaluators?: unknown }).evaluators).some((n) =>
      REFERENCE_EVALUATORS.has(n),
    );

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

  return { text, added, present, created, evaluatorWarning, addedCases };
}
