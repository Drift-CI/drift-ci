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

const PEM_END_HEAD = '-----END ';
const PEM_TAIL = 'PRIVATE KEY-----';

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
      // A BEGIN line with no END after it makes the lazy body scan to the end of the
      // text for every BEGIN (quadratic). Only scan up to the last END line, so every
      // BEGIN that the regex tries can succeed.
      const lastEnd = current.lastIndexOf(PEM_END_HEAD);
      const tail = lastEnd === -1 ? -1 : current.indexOf(PEM_TAIL, lastEnd);
      if (tail === -1) continue;
      const cut = tail + PEM_TAIL.length;
      current = redact(current.slice(0, cut)) + current.slice(cut);
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
