import {
  callIdAt,
  isConversation,
  isGeneratedCallId,
  toMessages,
  withCallIds,
  type CompletionInput,
  type CompletionOptions,
  type CompletionResponse,
  type ProviderAdapter,
  type ToolCall,
} from './base.js';
import { withRetry, type RetryOptions } from './utils.js';

/**
 * Shared base for the Gemini API and Vertex AI Gemini providers.
 *
 * Both wrap the same `@google/genai` `GoogleGenAI.models.generateContent`
 * surface; only the constructor (apiKey vs project+location) and the
 * `name` prefix differ. The base class accepts any object that
 * matches the narrow {@link GoogleGenAILike} shape so tests can
 * inject a fake without depending on the SDK at all.
 */

/** Minimal client surface used by complete(). */
export interface GoogleGenAILike {
  models: {
    generateContent: (
      params: GenerateContentParams,
    ) => Promise<GenerateContentResponseLike>;
  };
}

export interface GenerateContentParams {
  model: string;
  contents: ContentEntry[];
  config?: {
    systemInstruction?: { role: 'user'; parts: Array<{ text: string }> };
    temperature?: number;
    maxOutputTokens?: number;
    tools?: Array<{ functionDeclarations: GoogleFunctionDeclaration[] }>;
  };
}

/**
 * `parametersJsonSchema` (not `parameters`, which is the SDK's OpenAPI-subset
 * `Schema`) takes plain JSON Schema, which is what suites define.
 */
export interface GoogleFunctionDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface GoogleFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export interface GooglePart {
  text?: string;
  thought?: boolean;
  functionCall?: GoogleFunctionCall;
  /** Gemini 3 puts this on (the first) functionCall part; it must be sent back on that part. */
  thoughtSignature?: string;
}

export interface GoogleFunctionResponse {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

/** A request part: text, a function call the model made, or the result sent back for one. */
export type ContentPart =
  | { text: string }
  | { functionCall: GoogleFunctionCall; thoughtSignature?: string }
  | { functionResponse: GoogleFunctionResponse };

export interface ContentEntry {
  role: 'user' | 'model';
  parts: ContentPart[];
}

export interface GenerateContentResponseLike {
  text?: string;
  functionCalls?: GoogleFunctionCall[];
  candidates?: Array<{ content?: { parts?: GooglePart[] } }>;
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface BaseGoogleProviderConfig {
  model: string;
  client: GoogleGenAILike;
  /** Display name; subclasses set this to e.g. `google/<model>` or `vertex/<model>`. */
  displayName: string;
  defaultMaxTokens?: number;
  retry?: RetryOptions;
}

export class BaseGoogleGenAIProvider implements ProviderAdapter {
  readonly name: string;
  protected readonly config: BaseGoogleProviderConfig;

  constructor(config: BaseGoogleProviderConfig) {
    this.config = config;
    this.name = config.displayName;
  }

  async complete(
    input: CompletionInput,
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    const start = Date.now();
    const tools = options.tools?.length ? options.tools : undefined;

    const contents = toGoogleContents(input);

    const params: GenerateContentParams = {
      model: this.config.model,
      contents,
      config: {
        temperature: options.temperature ?? 0,
        maxOutputTokens: options.maxTokens ?? this.config.defaultMaxTokens ?? 1024,
        ...(systemPrompt
          ? {
              systemInstruction: {
                role: 'user',
                parts: [{ text: systemPrompt }],
              },
            }
          : {}),
        ...(tools
          ? {
              tools: [
                {
                  functionDeclarations: tools.map((t) => ({
                    name: t.name,
                    ...(t.description !== undefined ? { description: t.description } : {}),
                    parametersJsonSchema: t.parameters,
                  })),
                },
              ],
            }
          : {}),
      },
    };

    const response = await withRetry(
      () => this.config.client.models.generateContent(params),
      this.config.retry,
    );

    const read = tools ? readWithTools(response, input) : undefined;
    const text = read ? read.text : (response.text ?? '');
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    const cachedInputTokens = usage?.cachedContentTokenCount;

    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          usage?.totalTokenCount ?? inputTokens + outputTokens,
        ...(typeof cachedInputTokens === 'number'
          ? { cachedInputTokens }
          : {}),
      },
      model: response.modelVersion ?? this.config.model,
      latencyMs: Date.now() - start,
      ...(read ? { toolCalls: read.toolCalls } : {}),
    };
  }
}

/**
 * Plain input becomes one text part per message, as always (`assistant` is Gemini's `model`;
 * the system prompt goes separately in systemInstruction). A tool conversation maps an assistant
 * turn's calls to `functionCall` parts and a tool turn to a user turn of `functionResponse` parts.
 * Ids are sent only when Gemini made them, not for the `call_<n>` ids drift-ci generated, and a
 * call's thought signature goes back on its own functionCall part.
 */
function toGoogleContents(input: CompletionInput): ContentEntry[] {
  if (!isConversation(input)) {
    return toMessages(input).map<ContentEntry>((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        },
      ],
    }));
  }
  let ordinal = 0;
  const providerId = (id: string) => (isGeneratedCallId(id) ? {} : { id });
  return input.map((turn): ContentEntry => {
    if (turn.role === 'user') return { role: 'user', parts: [{ text: turn.content }] };
    if (turn.role === 'assistant') {
      if (!turn.toolCalls?.length) return { role: 'model', parts: [{ text: turn.content }] };
      return {
        role: 'model',
        parts: [
          ...(turn.content ? [{ text: turn.content }] : []),
          ...turn.toolCalls.map((c) => ({
            functionCall: { name: c.name, args: c.arguments, ...providerId(callIdAt(c, ++ordinal)) },
            ...(c.providerMeta?.thoughtSignature
              ? { thoughtSignature: c.providerMeta.thoughtSignature }
              : {}),
          })),
        ],
      };
    }
    return {
      role: 'user',
      parts: turn.results.map((r) => ({
        functionResponse: {
          name: r.name,
          response: r.isError ? { error: r.content } : parsedOrWrapped(r.content),
          ...providerId(r.callId),
        },
      })),
    };
  });
}

/** A JSON object result as-is; anything else (plain text, arrays, scalars) as `{ result }`. */
function parsedOrWrapped(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON: wrapped below
  }
  return { result: content };
}

/**
 * Reads text and function calls from the first candidate's parts directly:
 * the SDK's `text` getter warns about (and its result omits) non-text parts,
 * and is undefined when only function calls came back. Falls back to the
 * `functionCalls` / `text` getters when there are no candidate parts. A call keeps
 * the thought signature of the part that carried it.
 */
function readWithTools(
  response: GenerateContentResponseLike,
  input: CompletionInput,
): {
  text: string;
  toolCalls: ToolCall[];
} {
  const parts = response.candidates?.[0]?.content?.parts;
  const calls: Array<{ fc: GoogleFunctionCall; thoughtSignature?: string }> = parts
    ? parts.flatMap((p) =>
        p.functionCall ? [{ fc: p.functionCall, thoughtSignature: p.thoughtSignature }] : [],
      )
    : (response.functionCalls ?? []).map((fc) => ({ fc }));
  const text = parts
    ? parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('')
    : safeText(response);
  return {
    text,
    toolCalls: withCallIds(
      calls.map(({ fc, thoughtSignature }) => ({
        ...(fc.id ? { id: fc.id } : {}),
        name: fc.name ?? '',
        arguments: fc.args ?? {},
        ...(thoughtSignature ? { providerMeta: { thoughtSignature } } : {}),
      })),
      input,
    ),
  };
}

function safeText(response: GenerateContentResponseLike): string {
  try {
    return response.text ?? '';
  } catch {
    return '';
  }
}
