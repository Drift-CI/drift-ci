import { z } from 'zod';

export const CURRENT_CONFIG_VERSION = { major: 1, minor: 0 };

const VersionSchema = z.union([
  z.number().int().min(1),
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'version must be MAJOR or MAJOR.MINOR (e.g. 1 or 1.1)'),
]);

const MockProviderConfigSchema = z
  .object({
    responses: z.record(z.string(), z.string()).optional(),
    defaultResponse: z.string().optional(),
    latencyMs: z.number().int().min(0).optional(),
  })
  .optional();

const ProviderConfigSchema = z.object({
  name: z.enum([
    'anthropic',
    'openai',
    'azure',
    'google',
    'vertex',
    'bedrock',
    'ollama',
    'mock',
  ]),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  region: z.string().optional(),
  mock: MockProviderConfigSchema,
});

const StorageConfigSchema = z.object({
  type: z
    .enum(['memory', 'json-file', 'sqlite', 'postgres', 'http'])
    .default('json-file'),
  url: z.string().optional(),
  /**
   * Bearer token for `http` storage — the dashboard receiver's
   * `DRIFT_INGEST_TOKEN`. Reading from env at load time is preferred;
   * this field exists so CI workflows can inject the secret.
   */
  token: z.string().optional(),
});

const ThresholdsSchema = z.object({
  regression: z.number().min(0).max(1).default(0.1),
  alert: z.number().min(0).max(1).default(0.2),
});

const RedactPatternSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      'redaction pattern names must be lowercase alphanumeric with hyphens',
    ),
  pattern: z.string().min(1),
});

const BaselineConfigSchema = z.object({
  source: z.enum(['branch', 'main']).default('branch'),
  redactPatterns: z.array(RedactPatternSchema).optional(),
});

const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(false),
});

const JudgeConfigSchema = z.object({
  provider: z
    .enum([
      'anthropic',
      'openai',
      'azure',
      'google',
      'vertex',
      'bedrock',
      'ollama',
      'mock',
    ])
    .optional(),
  model: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  allowSelfBias: z.boolean().default(false),
});

/**
 * Named-judge entry for the multi-judge quorum used by the
 * `rubric-checklist` evaluator. Top-level `judges:` map (M30, arch §10):
 *
 *   judges:
 *     primary:   { provider: anthropic, model: claude-sonnet-4-5 }
 *     secondary: { provider: openai,    model: gpt-4o }
 *
 * Each entry produces a `ProviderAdapter` keyed by name; per-case
 * `rubricQuorum.judges: ['primary', 'secondary']` references those keys.
 */
const NamedJudgeSchema = z.object({
  provider: z.enum([
    'anthropic',
    'openai',
    'azure',
    'google',
    'vertex',
    'bedrock',
    'ollama',
    'mock',
  ]),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  region: z.string().optional(),
});

export type NamedJudgeConfig = z.infer<typeof NamedJudgeSchema>;

/**
 * Safety classifier config (M31). Discriminated on `type`. Two
 * built-in backends ship with drift-ci:
 *
 *   - `openai-moderation` — talks to `/v1/moderations`. Free,
 *     fixed model, returns categorised flags + scores.
 *   - `llama-guard` — wraps a regular provider with a Llama Guard
 *     prompt. Self-hosting via Ollama is the canonical setup.
 *
 * Custom backends bypass this schema entirely (operators construct
 * a `SafetyClassifier` and pass it through `EvaluatorFactoryContext`),
 * but the YAML path is the easy "pick one and go" surface.
 */
const SafetyClassifierConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('openai-moderation'),
    apiKey: z.string().optional(),
    model: z.string().min(1).optional(),
    url: z.string().url().optional(),
    /** Categories to TREAT AS FAILURES. Unset = any flagged category fails. */
    blockedCategories: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    type: z.literal('llama-guard'),
    /** Provider key referencing the top-level `judges:` map (or a built-in name). */
    provider: z.string().min(1),
    model: z.string().min(1),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    blockedCategories: z.array(z.string().min(1)).optional(),
  }),
]);

export type SafetyClassifierConfig = z.infer<typeof SafetyClassifierConfigSchema>;

export const DriftConfigSchema = z.object({
  version: VersionSchema,
  provider: ProviderConfigSchema,
  judge: JudgeConfigSchema.optional(),
  /**
   * Optional map of named judges for the rubric-checklist multi-judge
   * quorum. Keys reference these from per-case `rubricQuorum.judges`.
   * Distinct from `judge:` which is the single default judge for
   * `llm-judge` and rubric-checklist without quorum.
   */
  judges: z.record(z.string().min(1), NamedJudgeSchema).optional(),
  /** Optional safety-classifier backend for the `safety-classifier` evaluator (M31). */
  safetyClassifier: SafetyClassifierConfigSchema.optional(),
  storage: StorageConfigSchema.default({ type: 'json-file' }),
  thresholds: ThresholdsSchema.default({ regression: 0.1, alert: 0.2 }),
  baseline: BaselineConfigSchema.default({ source: 'branch' }),
  telemetry: TelemetryConfigSchema.default({ enabled: false }),
  concurrency: z.number().int().min(1).max(50).default(5),
  timeoutMs: z.number().int().min(1000).max(600_000).default(30_000),
  maxCostUsd: z.number().min(0).optional(),
  suite: z.string().default('.drift/suite.yaml'),
});

export type DriftConfig = z.infer<typeof DriftConfigSchema>;
export type ConfigVersion = { major: number; minor: number };
