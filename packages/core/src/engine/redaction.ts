export type SecretKind =
  | 'aws-key'
  | 'anthropic-key'
  | 'openai-key'
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
    kind: 'openai-key',
    pattern: /sk-[a-zA-Z0-9]{48}/g,
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
    if (count > 0) counts.push({ kind, count });
  }

  return { text: current, redactions: counts };
}
