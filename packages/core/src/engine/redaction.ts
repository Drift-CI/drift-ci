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
    kind: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  {
    kind: 'rsa-private-key',
    pattern: /-----BEGIN (?:RSA |OPENSSH |DSA |EC |ENCRYPTED |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |DSA |EC |ENCRYPTED |)PRIVATE KEY-----/g,
  },
];

export function redactSecrets(text: string): RedactionResult {
  let current = text;
  const counts: RedactionCount[] = [];

  for (const { kind, pattern } of SCANNERS) {
    let count = 0;
    current = current.replace(pattern, () => {
      count += 1;
      return `[REDACTED:${kind}]`;
    });
    if (count > 0) {
      const existing = counts.find((c) => c.kind === kind);
      if (existing) existing.count += count;
      else counts.push({ kind, count });
    }
  }

  return { text: current, redactions: counts };
}
