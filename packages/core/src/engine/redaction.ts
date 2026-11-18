export type SecretKind =
  | 'aws-key'
  | 'anthropic-key'
  | 'openai-key'
  | 'github-token'
  | 'slack-token'
  | 'jwt'
  | 'rsa-private-key';

export interface RedactionCount {
  kind: SecretKind;
  count: number;
}

export interface RedactionResult {
  text: string;
  redactions: RedactionCount[];
}

interface Scanner {
  kind: SecretKind;
  pattern: RegExp;
}

const SCANNERS: Scanner[] = [
  {
    kind: 'aws-key',
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
  {
    kind: 'anthropic-key',
    pattern: /sk-ant-[a-zA-Z0-9_-]{8,}/g,
  },
  {
    // Current OpenAI keys: project, service-account and admin.
    kind: 'openai-key',
    pattern: /(?<![A-Za-z0-9])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g,
  },
  {
    // Legacy OpenAI user keys.
    kind: 'openai-key',
    pattern: /sk-[a-zA-Z0-9]{48}/g,
  },
  {
    // Classic (ghp_, gho_, ghu_, ghs_, ghr_) and fine-grained (github_pat_) tokens.
    kind: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g,
  },
  {
    kind: 'slack-token',
    pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  },
  {
    // The lookbehind stops a match starting inside a token-character run, which
    // keeps this linear: without it, "eyJeyJeyJ..." with no dots is quadratic.
    kind: 'jwt',
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  {
    kind: 'rsa-private-key',
    pattern: /-----BEGIN (?:RSA |OPENSSH |DSA |EC |ENCRYPTED |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |DSA |EC |ENCRYPTED |)PRIVATE KEY-----/g,
  },
];

const PEM_BEGIN = /-----BEGIN (?:RSA |OPENSSH |DSA |EC |ENCRYPTED |)PRIVATE KEY-----/g;
const PEM_END = /-----END (?:RSA |OPENSSH |DSA |EC |ENCRYPTED |)PRIVATE KEY-----/g;

/**
 * Replace each BEGIN ... END private-key block, matching each BEGIN with the
 * first END after it (the same result as a lazy regex). Linear time: every END
 * is found once up front, and BEGIN lines inside a replaced block or with no
 * END after them are skipped without rescanning.
 */
function replacePemBlocks(text: string, onMatch: () => string): string {
  const ends: { start: number; end: number }[] = [];
  for (const m of text.matchAll(PEM_END)) ends.push({ start: m.index, end: m.index + m[0].length });
  if (ends.length === 0) return text;
  let out = '';
  let pos = 0;
  let e = 0;
  for (const m of text.matchAll(PEM_BEGIN)) {
    const begin = m.index;
    if (begin < pos) continue; // inside a block already replaced
    const bodyStart = begin + m[0].length;
    while (e < ends.length && ends[e].start < bodyStart) e++;
    if (e === ends.length) break; // no END after this BEGIN, or any later one
    out += text.slice(pos, begin) + onMatch();
    pos = ends[e].end;
  }
  return out + text.slice(pos);
}

export function redactSecrets(text: string): RedactionResult {
  let current = text;
  const counts: RedactionCount[] = [];

  for (const { kind, pattern } of SCANNERS) {
    let count = 0;
    const redact = (t: string) =>
      t.replace(pattern, () => {
        count += 1;
        return `[REDACTED:${kind}]`;
      });
    if (kind === 'rsa-private-key') {
      current = replacePemBlocks(current, () => {
        count += 1;
        return `[REDACTED:${kind}]`;
      });
    } else {
      current = redact(current);
    }
    if (count > 0) {
      const existing = counts.find((c) => c.kind === kind);
      if (existing) existing.count += count;
      else counts.push({ kind, count });
    }
  }

  return { text: current, redactions: counts };
}
