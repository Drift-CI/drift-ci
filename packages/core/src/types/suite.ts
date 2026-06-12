import { z } from 'zod';

const EvaluatorSpecSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    weight: z.number().min(0).max(1).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export const MessageParamSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

// ─── rubric (M30, spec lives in arch §10) ───────────────────────────────

/**
 * One rubric item. Authors can pass a bare string (shorthand for a
 * default-lenient item with auto-generated id) or this richer form.
 */
export const RubricItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Rubric item ids must be lowercase alphanumeric with hyphens.')
    .optional(),
  text: z.string().min(1).max(500),
  weight: z.number().min(0).max(1).optional(),
  mode: z.enum(['strict', 'lenient']).default('lenient'),
});

export const RubricSpecSchema = z
  .array(z.union([z.string().min(1).max(500), RubricItemSchema]))
  .min(2, {
    message:
      'rubric-checklist requires at least 2 items. Use the `llm-judge` evaluator for single-criterion grading.',
  })
  .max(20, {
    message:
      'rubric-checklist supports at most 20 items per case. Split into multiple cases or compose `llm-judge` if you need finer granularity.',
  });

export const RubricQuorumSchema = z
  .object({
    judges: z.array(z.string().min(1)).min(1).max(5),
    threshold: z.enum(['majority', 'unanimous']).default('majority'),
    /** Bypass the self-bias rejection — only valid when ALL judges happen to be the test provider. */
    allowSelfBias: z.boolean().default(false),
  })
  .refine((q) => q.threshold !== 'majority' || q.judges.length % 2 === 1, {
    error: (issue) => {
      const { judges } = issue.input as { judges: string[] };
      return `majority quorum requires an odd number of judges (got ${judges.length})`;
    },
  });

export type RubricItem = z.infer<typeof RubricItemSchema>;
export type RubricSpec = z.infer<typeof RubricSpecSchema>;
export type RubricQuorum = z.infer<typeof RubricQuorumSchema>;

// ─── case ───────────────────────────────────────────────────────────────

export const TestCaseSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9\-\/_]+$/,
        'IDs must be lowercase alphanumeric with hyphens, underscores, or slashes',
      ),
    description: z.string().optional(),
    input: z.string().min(1).optional(),
    expected: z.string().optional(),
    criteria: z.string().optional(),
    evaluators: z.array(EvaluatorSpecSchema).optional(),
    threshold: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(1).max(32000).optional(),
    runs: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
    messages: z.array(MessageParamSchema).optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
    rubric: RubricSpecSchema.optional(),
    rubricQuorum: RubricQuorumSchema.optional(),
  })
  .refine((tc) => (tc.input !== undefined) !== (tc.messages !== undefined), {
    message:
      'Each case must define exactly one of `input` or `messages` (not both, not neither).',
  })
  .refine(
    (tc) =>
      !tc.evaluators?.some(
        (e) => (typeof e === 'string' ? e : e.name) === 'json-schema',
      ) || tc.schema !== undefined,
    {
      message:
        'A case using the `json-schema` evaluator must define a `schema` field.',
    },
  )
  .refine(
    (tc) =>
      !tc.evaluators?.some(
        (e) => (typeof e === 'string' ? e : e.name) === 'rubric-checklist',
      ) || tc.rubric !== undefined,
    {
      message:
        'A case using the `rubric-checklist` evaluator must define a `rubric` field.',
    },
  );

export const SuiteSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  evaluators: z.array(EvaluatorSpecSchema).optional(),
  default_threshold: z.number().min(0).max(1).optional(),
  cases: z
    .array(TestCaseSchema)
    .min(1)
    .refine((cases) => new Set(cases.map((c) => c.id)).size === cases.length, {
      message: 'Case IDs must be unique within a suite.',
    }),
});

export type EvaluatorSpec = z.infer<typeof EvaluatorSpecSchema>;
export type MessageParam = z.infer<typeof MessageParamSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type Suite = z.infer<typeof SuiteSchema>;
