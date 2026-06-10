import { GoogleGenAI } from '@google/genai';

import {
  BaseGoogleGenAIProvider,
  type GoogleGenAILike,
} from './google-base.js';
import type { RetryOptions } from './utils.js';

export interface VertexAIProviderConfig {
  /** Gemini model id, e.g. `gemini-2.5-pro`, `gemini-2.0-flash`. */
  model: string;
  /** GCP project id. */
  project?: string;
  /** GCP region, e.g. `us-central1`. */
  location?: string;
  defaultMaxTokens?: number;
  retry?: RetryOptions;
  /** Inject a client (tests / advanced auth). */
  client?: GoogleGenAILike;
}

/**
 * Vertex AI flavour of Gemini. Auth flows through Google Cloud's
 * application-default credentials (env / metadata server / service-
 * account JSON), which is what production GCP workloads expect. Use
 * {@link GoogleGeminiProvider} for the simpler API-key flow.
 */
export class VertexAIProvider extends BaseGoogleGenAIProvider {
  constructor(config: VertexAIProviderConfig) {
    const client =
      config.client ??
      buildVertexClient({
        project: config.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT,
        location:
          config.location ??
          process.env.GOOGLE_CLOUD_LOCATION ??
          process.env.GCP_LOCATION,
      });
    super({
      model: config.model,
      client,
      displayName: `vertex/${config.model}`,
      defaultMaxTokens: config.defaultMaxTokens,
      retry: config.retry,
    });
  }
}

function buildVertexClient(opts: {
  project: string | undefined;
  location: string | undefined;
}): GoogleGenAILike {
  if (!opts.project) {
    throw new Error(
      'VertexAIProvider: project is required (set GOOGLE_CLOUD_PROJECT env or config.project).',
    );
  }
  if (!opts.location) {
    throw new Error(
      'VertexAIProvider: location is required (set GOOGLE_CLOUD_LOCATION env or config.location, e.g. us-central1).',
    );
  }
  return new GoogleGenAI({
    vertexai: true,
    project: opts.project,
    location: opts.location,
  }) as unknown as GoogleGenAILike;
}
