import type { MessageParam } from '../types/index.js';
import {
  toMessages,
  type CompletionOptions,
  type CompletionResponse,
  type ProviderAdapter,
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
  };
}

export interface ContentEntry {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export interface GenerateContentResponseLike {
  text?: string;
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
      },
    };

    const response = await withRetry(
      () => this.config.client.models.generateContent(params),
      this.config.retry,
    );

    const text = response.text ?? '';
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
    };
  }
}
