import type { MessageParam } from '../types/index.js';
import {
  toMessages,
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
}

export interface ContentEntry {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
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
    input: string | MessageParam[],
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    const start = Date.now();
    const tools = options.tools?.length ? options.tools : undefined;

    const contents = toMessages(input).map<ContentEntry>((m) => ({
      // Gemini's content roles are user / model. We map our user-role
      // unchanged and rebrand `assistant` → `model`. drift-ci doesn't
      // emit `system` in MessageParam[]; that's the systemInstruction
      // below, sent separately.
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text:
            typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        },
      ],
    }));

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

    const read = tools ? readWithTools(response) : undefined;
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
 * Reads text and function calls from the first candidate's parts directly:
 * the SDK's `text` getter warns about (and its result omits) non-text parts,
 * and is undefined when only function calls came back. Falls back to the
 * `functionCalls` / `text` getters when there are no candidate parts.
 */
function readWithTools(response: GenerateContentResponseLike): {
  text: string;
  toolCalls: ToolCall[];
} {
  const parts = response.candidates?.[0]?.content?.parts;
  const calls = parts
    ? parts.flatMap((p) => (p.functionCall ? [p.functionCall] : []))
    : (response.functionCalls ?? []);
  const text = parts
    ? parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('')
    : safeText(response);
  return {
    text,
    toolCalls: calls.map((fc) => ({ name: fc.name ?? '', arguments: fc.args ?? {} })),
  };
}

function safeText(response: GenerateContentResponseLike): string {
  try {
    return response.text ?? '';
  } catch {
    return '';
  }
}
