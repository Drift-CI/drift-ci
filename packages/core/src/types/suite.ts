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

// ─── tools ──────────────────────────────────────────────────────────────

/** A tool offered to the model. `parameters` is a JSON Schema object. */
export const ToolDefinitionSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Tool names must be 1-64 letters, digits, _ or -.'),
    description: z.string().max(1024).optional(),
    parameters: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
  })
  .strict()
  .refine((t) => t.parameters.type === 'object', {
    error: (issue) =>
      `Tool "${(issue.input as { name?: string }).name}": parameters must be a JSON Schema object (type: object).`,
    path: ['parameters'],
  });

const ToolListSchema = z
  .array(ToolDefinitionSchema)
  .max(64)
  .refine((t) => new Set(t.map((x) => x.name)).size === t.length, {
    message: 'Tool names must be unique.',
  });

/** A tool call the `tool-call` evaluator expects; listed arguments only are compared. */
export const ExpectedCallSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ExpectedCall = z.infer<typeof ExpectedCallSchema>;

/**
 * A scripted result for a multi-step case: answers the model's call to `name` (and, when
 * `arguments` is listed, only calls whose listed arguments match). `result` is any JSON value.
 */
export const ToolResultSchema = z
  .object({
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
    result: z.unknown(),
  })
  .refine((r) => r.result !== undefined, {
    message: 'Each `toolResults` entry must define a `result`.',
    path: ['result'],
  });

export type ToolResult = z.infer<typeof ToolResultSchema>;

/** Steps a multi-step case may take when it doesn't set `maxSteps`. */
export const DEFAULT_MAX_STEPS = 5;

/** A tool call made by the model, as returned by a provider. */
export interface ToolCall {
  /** The provider's call id, or a generated `call_<n>`; echoed back with the call's result. */
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Opaque provider data that must go back with the call in the next step, such as Gemini's
   * `thoughtSignature`. Never rendered, hashed or compared.
   */
  providerMeta?: { thoughtSignature?: string };
}

/** One result in a `tool` turn, answering the call with id `callId`. */
export interface ToolResultContent {
  callId: string;
  name: string;
  content: string;
  isError?: boolean;
}

/** A turn of a multi-step tool conversation (internal to the engine and providers). */
export type ConversationTurn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; results: ToolResultContent[] };

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
    contains: z.array(z.string().min(1)).min(1).optional(),
    context: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(20)])
      .optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
    rubric: RubricSpecSchema.optional(),
    rubricQuorum: RubricQuorumSchema.optional(),
    tools: ToolListSchema.optional(),
    expectedCalls: z.array(ExpectedCallSchema).max(16).optional(),
    /** Scripted tool results; makes the case multi-step. Names must be effective tools. */
    toolResults: z.array(ToolResultSchema).min(1).max(32).optional(),
    /** Provider calls a multi-step case may take (default 5); only with `toolResults`. */
    maxSteps: z.number().int().min(1).max(10).optional(),
  })
  .refine((tc) => (tc.input !== undefined) !== (tc.messages !== undefined), {
    message:
      'Each case must define exactly one of `input` or `messages` (not both, not neither).',
  })
  .refine(
    (tc) =>
      !tc.evaluators?.some(
        (e) => (typeof e === 'string' ? e : e.name) === 'contains',
      ) || tc.contains !== undefined,
    {
      message:
        'A case using the `contains` evaluator must define a non-empty `contains` field.',
    },
  )
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
  )
  .refine(
    (tc) =>
      !tc.evaluators?.some(
        (e) => (typeof e === 'string' ? e : e.name) === 'faithfulness',
      ) || tc.context !== undefined,
    {
      message:
        'A case using the `faithfulness` evaluator must define a `context` field.',
    },
  );

export const SuiteSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  evaluators: z.array(EvaluatorSpecSchema).optional(),
  default_threshold: z.number().min(0).max(1).optional(),
  /** Samples per case when a case has no `runs` of its own (1–5). The median score is used. */
  default_runs: z.number().int().min(1).max(5).optional(),
  /** Tools offered to every case; merged into each case's `tools` by `parseSuite`. */
  tools: ToolListSchema.optional(),
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
