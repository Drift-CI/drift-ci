import { GoogleGenAI } from '@google/genai';

import {
  BaseGoogleGenAIProvider,
  type GoogleGenAILike,
} from './google-base.js';
import type { RetryOptions } from './utils.js';

export interface GoogleGeminiProviderConfig {
  model: string;
  apiKey?: string;
  defaultMaxTokens?: number;
  retry?: RetryOptions;
  /** Inject a client (tests / Vertex flavour). */
  client?: GoogleGenAILike;
}

/**
 * Gemini API provider. Auth = simple `x-goog-api-key` header, sourced
 * from `config.apiKey` or the `GOOGLE_GENAI_API_KEY` /
 * `GEMINI_API_KEY` env vars (in that order). Use {@link
 * VertexAIProvider} when you need GCP IAM, regional pinning, or audit
 * logging instead.
 */
export class GoogleGeminiProvider extends BaseGoogleGenAIProvider {
  constructor(config: GoogleGeminiProviderConfig) {
    const client =
      config.client ??
      buildGeminiClient(config.apiKey ?? process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY);
    super({
      model: config.model,
      client,
      displayName: `google/${config.model}`,
      defaultMaxTokens: config.defaultMaxTokens,
      retry: config.retry,
    });
  }
}

function buildGeminiClient(apiKey: string | undefined): GoogleGenAILike {
  if (!apiKey) {
    throw new Error(
      'GoogleGeminiProvider: GOOGLE_GENAI_API_KEY (or config.apiKey) is required.',
    );
  }
  return new GoogleGenAI({ apiKey }) as unknown as GoogleGenAILike;
}
