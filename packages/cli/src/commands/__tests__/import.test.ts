import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSuiteFromFile } from '@drift-ci/core';

import { executeImport, KNOWN_EVALUATORS, type ImportOptions } from '../import.js';

let dir: string;
let out: string[];
let err: string[];
const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };

const trace = (q: string, a: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...extra, messages: [{ role: 'user', content: q }, { role: 'assistant', content: a }] });

const SUITE = `# Hand-written suite — keep this comment
version: 1
id: support
name: Support bot
evaluators:
  - llm-judge # judge against expected
cases:
  - id: greeting
    input: "Hello"
    expected: "Hi there"
`;

function opts(o: Partial<ImportOptions> = {}): ImportOptions {
  return {
    suite: join(dir, '.drift', 'suite.yaml'),
    config: join(dir, '.drift', 'config.yaml'),
    prefix: 'prod',
    evaluator: [],
    dryRun: false,
    ...o,
  };
}
function writeTraces(lines: string[]): string {
  const p = join(dir, 'traces.jsonl');
  writeFileSync(p, lines.join('\n'));
  return p;
}
function writeSuite(text = SUITE): string {
  const p = join(dir, '.drift', 'suite.yaml');
  mkdirSync(join(dir, '.drift'), { recursive: true });
  writeFileSync(p, text);
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drift-import-'));
  out = [];
  err = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('executeImport', () => {
  it('appends cases to an existing suite and keeps its comments', () => {
    const suite = writeSuite();
    const file = writeTraces([trace('Where is my order?', 'It ships today.', { id: 'order-1' })]);

    expect(executeImport(file, opts(), io)).toBe(0);

    const text = readFileSync(suite, 'utf8');
    expect(text).toContain('# Hand-written suite — keep this comment');
    expect(text).toContain('# judge against expected');
    const loaded = loadSuiteFromFile(suite);
    expect(loaded.cases.map((c) => c.id)).toEqual(['greeting', 'prod-order-1']);
    expect(loaded.cases[1]).toMatchObject({
      input: 'Where is my order?',
      expected: 'It ships today.',
      tags: ['imported'],
    });
    expect(out.join('\n')).toContain('Imported 1 case(s) into');
    expect(out.join('\n')).toContain(`drift-ci baseline accept ${suite} --all`);
    expect(existsSync(`${suite}.tmp`)).toBe(false);
  });

  it('skips cases already in the suite and duplicates within the file', () => {
    const suite = writeSuite();
    const file = writeTraces([trace('a', 'b', { id: 'x' }), trace('a', 'b', { id: 'x' })]);
    expect(executeImport(file, opts(), io)).toBe(0);
    expect(loadSuiteFromFile(suite).cases).toHaveLength(2);

    out = [];
    expect(executeImport(file, opts(), io)).toBe(0);
    expect(loadSuiteFromFile(suite).cases).toHaveLength(2);
    expect(out.join('\n')).toContain('Imported 0 case(s)');
    expect(out.join('\n')).toContain('2 already present');
  });

  it('respects --limit', () => {
    const suite = writeSuite();
    const file = writeTraces([trace('1', 'a'), trace('2', 'b'), trace('3', 'c')]);
    expect(executeImport(file, opts({ limit: 2 }), io)).toBe(0);
    expect(loadSuiteFromFile(suite).cases).toHaveLength(3);
  });

  it('prints YAML and writes nothing on --dry-run', () => {
    const suite = writeSuite();
    const file = writeTraces([trace('q', 'a', { id: 'dry' })]);
    expect(executeImport(file, opts({ dryRun: true }), io)).toBe(0);
    expect(readFileSync(suite, 'utf8')).toBe(SUITE);
    expect(out.join('\n')).toContain('id: prod-dry');
    expect(out.join('\n')).toContain('Would import 1 case(s)');
  });

  it('creates a suite with llm-judge when none exists', () => {
    const file = writeTraces([trace('q', 'a')]);
    const suitePath = join(dir, 'new', 'suite.yaml');
    expect(executeImport(file, opts({ suite: suitePath }), io)).toBe(0);
    const loaded = loadSuiteFromFile(suitePath);
    expect(loaded.id).toBe('imported');
    expect(loaded.evaluators).toEqual(['llm-judge']);
    expect(loaded.cases).toHaveLength(1);
    expect(err.join('\n')).not.toContain('Warning');
  });

  it('warns when the suite evaluators will not use the production reply', () => {
    writeSuite(SUITE.replace('  - llm-judge # judge against expected', '  - json-schema'));
    const file = writeTraces([trace('q', 'a')]);
    // json-schema at suite level is fine for validation (the per-case refine only checks case-level evaluators)
    expect(executeImport(file, opts(), io)).toBe(0);
    expect(err.join('\n')).toContain("Warning: the suite's evaluators");
  });

  it('warns when the suite has no evaluators (exact-match default)', () => {
    writeSuite(SUITE.replace('evaluators:\n  - llm-judge # judge against expected\n', ''));
    const file = writeTraces([trace('q', 'a')]);
    expect(executeImport(file, opts(), io)).toBe(0);
    expect(err.join('\n')).toContain("Warning: the suite's evaluators");
  });

  it('sets per-case evaluators with --evaluator and suppresses the warning', () => {
    const suite = writeSuite(SUITE.replace('  - llm-judge # judge against expected', '  - json-schema'));
    const file = writeTraces([trace('q', 'a', { id: 'e' })]);
    expect(executeImport(file, opts({ evaluator: ['cosine-similarity'] }), io)).toBe(0);
    expect(loadSuiteFromFile(suite).cases[1].evaluators).toEqual(['cosine-similarity']);
    expect(err.join('\n')).not.toContain('Warning');
  });

  it('reports skipped lines with their numbers', () => {
    writeSuite();
    const file = writeTraces([
      trace('q', 'a'),
      '{not json',
      '',
      JSON.stringify({ messages: [{ role: 'user', content: 'q' }] }),
    ]);
    expect(executeImport(file, opts(), io)).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('Skipped 2 line(s):');
    expect(text).toContain('line 2: invalid-json');
    expect(text).toContain('line 4: no final assistant reply');
  });

  it('lists at most 20 skipped lines', () => {
    writeSuite();
    const file = writeTraces([trace('q', 'a'), ...Array.from({ length: 25 }, () => '{bad')]);
    executeImport(file, opts(), io);
    expect(out.join('\n')).toContain('… and 5 more');
  });

  it('reports redactions', () => {
    writeSuite();
    const file = writeTraces([trace(`key sk-ant-${'a'.repeat(20)}`, 'ok')]);
    executeImport(file, opts(), io);
    expect(out.join('\n')).toContain('Redacted 1 secret(s)');
  });

  it('exits 1 when nothing can be imported', () => {
    const suite = writeSuite();
    const file = writeTraces(['{bad', '{worse']);
    expect(executeImport(file, opts(), io)).toBe(1);
    expect(readFileSync(suite, 'utf8')).toBe(SUITE);
  });

  it('exits 1 for an empty file', () => {
    writeSuite();
    expect(executeImport(writeTraces([]), opts(), io)).toBe(1);
  });

  it('exits 1 and writes nothing when the result fails validation', () => {
    const suite = writeSuite();
    const file = writeTraces([trace('q', 'a')]);
    // `contains` needs a per-case `contains` field, which imported cases don't have.
    expect(executeImport(file, opts({ evaluator: ['contains'] }), io)).toBe(1);
    expect(readFileSync(suite, 'utf8')).toBe(SUITE);
    expect(err.join('\n')).toContain('nothing written');
  });

  it('does not repeat the case id when the message already starts with it', () => {
    writeSuite();
    const file = writeTraces([trace('q', 'a')]);
    expect(executeImport(file, opts({ evaluator: ['tool-call'] }), io)).toBe(1);
    const lines = err.filter((l) => l.includes('the `tool-call` evaluator requires'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ {2}case [^:]+: the/);
  });

  it('exits 2 when the input file is missing', () => {
    writeSuite();
    expect(executeImport(join(dir, 'missing.jsonl'), opts(), io)).toBe(2);
  });

  it('exits 2 when the suite is not valid YAML', () => {
    writeSuite('cases: [\n');
    expect(executeImport(writeTraces([trace('q', 'a')]), opts(), io)).toBe(2);
  });

  it('exits 2 for an invalid --prefix', () => {
    writeSuite();
    expect(executeImport(writeTraces([trace('q', 'a')]), opts({ prefix: 'Bad!' }), io)).toBe(2);
  });

  it('uses the config suite path when --suite is not given', () => {
    const suite = writeSuite();
    writeFileSync(join(dir, '.drift', 'config.yaml'), `version: 1\nprovider:\n  name: mock\n  model: m\nsuite: ${JSON.stringify(suite)}\n`);
    const file = writeTraces([trace('q', 'a')]);
    expect(executeImport(file, opts({ suite: undefined }), io)).toBe(0);
    expect(loadSuiteFromFile(suite).cases).toHaveLength(2);
  });

  it('leaves existing suite text byte-identical', () => {
    const long = 'word '.repeat(30).trim();
    const text = `version: 1\nid: s\nname: S\nevaluators: [llm-judge]\ncases:\n  - id: a\n    input: '${long}'\n    expected: 'ok'\n`;
    const suite = writeSuite(text);
    const file = writeTraces([trace('q', 'a')]);
    expect(executeImport(file, opts(), io)).toBe(0);
    const after = readFileSync(suite, 'utf8');
    expect(after.startsWith(text)).toBe(true);
    for (const l of text.split('\n')) expect(after).toContain(l);
  });

  it('converts a flow-style cases list to a block list', () => {
    for (const cases of ['[]', '[{id: a, input: hi, expected: x}]']) {
      const suite = writeSuite(`version: 1\nid: s\nname: S\nevaluators: [llm-judge]\ncases: ${cases}\n`);
      const file = writeTraces([trace('q', 'line1\nline2', { id: 'm' })]);
      expect(executeImport(file, opts(), io)).toBe(0);
      expect(readFileSync(suite, 'utf8')).toContain('expected: |-');
      expect(loadSuiteFromFile(suite).cases.at(-1)?.expected).toBe('line1\nline2');
    }
  });

  it('exits 2 and leaves no tmp file when the write fails', () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'x');
    const suitePath = join(blocker, 'suite.yaml');
    expect(executeImport(writeTraces([trace('q', 'a')]), opts({ suite: suitePath }), io)).toBe(2);
    expect(err.join('\n')).toContain("Can't write");
    expect(err.join('\n')).toContain('(nothing written)');

    // target is a directory: rename fails
    const dirTarget = join(dir, 'dirsuite');
    mkdirSync(dirTarget);
    err = [];
    expect(executeImport(writeTraces([trace('q', 'a')]), opts({ suite: dirTarget }), io)).toBe(2);
    expect(existsSync(`${dirTarget}.tmp`)).toBe(false);
  });

  it('exits 2 for a missing non-default --config', () => {
    expect(executeImport(writeTraces([trace('q', 'a')]), opts({ suite: undefined, config: join(dir, 'nope.yaml') }), io)).toBe(2);
    expect(err.join('\n')).toContain('Config not found:');
  });

  it('exits 2 with a one-line message for an invalid config', () => {
    writeSuite();
    const cfg = join(dir, '.drift', 'config.yaml');
    writeFileSync(cfg, 'version: 1\n');
    expect(executeImport(writeTraces([trace('q', 'a')]), opts({ suite: undefined, config: cfg }), io)).toBe(2);
    expect(err.join('\n')).toMatch(/^Can't read config .*/);
    expect(err.join('\n').split('\n')).toHaveLength(1);
  });

  it('rejects unknown --evaluator names with exit 2', () => {
    const suite = writeSuite();
    expect(executeImport(writeTraces([trace('q', 'a')]), opts({ evaluator: ['nope'] }), io)).toBe(2);
    expect(err.join('\n')).toContain('Unknown evaluator "nope". Known:');
    expect(readFileSync(suite, 'utf8')).toBe(SUITE);
  });

  it('puts evaluators before tags', () => {
    const suite = writeSuite();
    executeImport(writeTraces([trace('q', 'a', { id: 'o' })]), opts({ evaluator: ['llm-judge'] }), io);
    const t = readFileSync(suite, 'utf8');
    expect(t.indexOf('evaluators:', t.indexOf('prod-o'))).toBeLessThan(t.indexOf('tags:'));
  });

  it('treats an empty suite file as a new suite', () => {
    const suite = writeSuite('# nothing here\n');
    expect(executeImport(writeTraces([trace('q', 'a')]), opts(), io)).toBe(0);
    const loaded = loadSuiteFromFile(suite);
    expect(loaded.id).toBe('imported');
    expect(loaded.cases).toHaveLength(1);
  });

  it.each([['---\n'], ['null\n'], ['---\nnull\n'], ['~\n']])('treats %j as a new suite', (text) => {
    const suite = writeSuite(text);
    expect(executeImport(writeTraces([trace('q', 'a')]), opts(), io)).toBe(0);
    const loaded = loadSuiteFromFile(suite);
    expect(loaded.id).toBe('imported');
    expect(loaded.cases).toHaveLength(1);
  });

  it.each([['# my notes\n'], ['# my notes\n---\n'], ['# my notes\nnull\n']])(
    'keeps leading comments when replacing %j',
    (text) => {
      const suite = writeSuite(text);
      expect(executeImport(writeTraces([trace('q', 'a')]), opts(), io)).toBe(0);
      expect(readFileSync(suite, 'utf8')).toContain('# my notes');
      expect(loadSuiteFromFile(suite).cases).toHaveLength(1);
    },
  );

  it('keeps KNOWN_EVALUATORS in sync with the evaluator factory', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const factory = readFileSync(join(here, '../../../../core/src/evaluators/factory.ts'), 'utf8');
    const names = [...factory.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(KNOWN_EVALUATORS));
  });

  it('exits 0 when re-importing a file whose usable traces are all present', () => {
    writeSuite();
    const file = writeTraces([trace('q', 'a', { id: 'x' }), '{bad']);
    expect(executeImport(file, opts(), io)).toBe(0);
    expect(executeImport(file, opts(), io)).toBe(0);
  });
});

describe('executeImport with tool traces', () => {
  const toolTrace = (name = 'get_order', extra: Record<string, unknown> = {}, id = 'call_1') =>
    JSON.stringify({
      ...extra,
      messages: [
        { role: 'user', content: 'Where is order 42?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: '{"order":42}' } }],
        },
        { role: 'tool', tool_call_id: id, content: '{"status":"shipped"}' },
        { role: 'assistant', content: 'It shipped.' },
      ],
    });
  const tools = [{ type: 'function', function: { name: 'get_order', parameters: { type: 'object' } } }];
  const LINE =
    "Skipped 1 case(s): they call tools the suite doesn't define (get_order). Add them under tools: in the suite, or send tools with each trace.";

  it('imports a tool trace that sends tools', () => {
    const suite = writeSuite();
    const file = writeTraces([toolTrace('get_order', { tools })]);
    expect(executeImport(file, opts(), io)).toBe(0);
    expect(readFileSync(suite, 'utf8')).toContain('toolResults');
    expect(out.join('\n')).toContain('Imported 1 case(s)');
  });

  it('exits 1 when the only case calls undefined tools', () => {
    const suite = writeSuite();
    const file = writeTraces([toolTrace()]);
    expect(executeImport(file, opts(), io)).toBe(1);
    expect(out.join('\n')).toContain(LINE);
    expect(readFileSync(suite, 'utf8')).toBe(SUITE);
  });

  it('exits 0 and still prints the line when other cases were added', () => {
    writeSuite();
    const file = writeTraces([trace('q', 'a'), toolTrace()]);
    expect(executeImport(file, opts(), io)).toBe(0);
    expect(out.join('\n')).toContain(LINE);
  });

  it('lists a tool call before a later user turn as a skipped line', () => {
    writeSuite();
    const call = {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c', type: 'function', function: { name: 'get_order', arguments: '{}' } }],
    };
    const file = writeTraces([
      trace('q', 'a'),
      JSON.stringify({
        messages: [
          { role: 'user', content: 'one' },
          call,
          { role: 'tool', tool_call_id: 'c', content: 'x' },
          { role: 'assistant', content: 'two' },
          { role: 'user', content: 'three' },
          { role: 'assistant', content: 'four' },
        ],
      }),
    ]);
    expect(executeImport(file, opts(), io)).toBe(0);
    expect(out.join('\n')).toContain('line 2: tool calls before the last user message');
  });

  it('combines names across skipped cases, sorted and unique', () => {
    writeSuite();
    const file = writeTraces([
      toolTrace('zeta', {}, 'a'),
      toolTrace('alpha', { id: 'x' }, 'b'),
      toolTrace('zeta', { id: 'y' }, 'c'),
    ]);
    expect(executeImport(file, opts(), io)).toBe(1);
    expect(out.join('\n')).toContain(
      "Skipped 3 case(s): they call tools the suite doesn't define (alpha, zeta).",
    );
  });

  it('treats --dry-run with only tool-skipped cases like a real run', () => {
    const suite = writeSuite();
    const file = writeTraces([toolTrace()]);
    expect(executeImport(file, opts({ dryRun: true }), io)).toBe(1);
    expect(out.join('\n')).toContain(LINE);
    expect(readFileSync(suite, 'utf8')).toBe(SUITE);
  });
});
