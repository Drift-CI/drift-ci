import {
  AnthropicProvider,
  type AnthropicProviderConfig,
} from './anthropic.js';
import {
  AzureOpenAIProvider,
  type AzureOpenAIProviderConfig,
} from './azure-openai.js';
import {
  BedrockAnthropicProvider,
  type BedrockAnthropicProviderConfig,
} from './bedrock.js';
import {
  GoogleGeminiProvider,
  type GoogleGeminiProviderConfig,
} from './google-gemini.js';
import { MockProvider, type MockProviderOptions } from './mock.js';
import { OllamaProvider, type OllamaProviderConfig } from './ollama.js';
import { OpenAIProvider, type OpenAIProviderConfig } from './openai.js';
import { VertexAIProvider, type VertexAIProviderConfig } from './vertex-ai.js';
import type { ProviderAdapter } from './base.js';

export interface ProviderConfig {
  name: string;
  model?: string;
  /** Bedrock alias kept so callers can use `{ name: 'bedrock', modelId: '…' }`. */
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  region?: string;
  /** GCP project (vertex provider). Also reads `GOOGLE_CLOUD_PROJECT`. */
  project?: string;
  /** GCP location, e.g. `us-central1` (vertex provider). Also reads `GOOGLE_CLOUD_LOCATION`. */
  location?: string;
  mock?: MockProviderOptions;
  anthropic?: Partial<AnthropicProviderConfig>;
  ollama?: Partial<OllamaProviderConfig>;
  openai?: Partial<OpenAIProviderConfig>;
  azure?: Partial<AzureOpenAIProviderConfig>;
  bedrock?: Partial<BedrockAnthropicProviderConfig>;
  gemini?: Partial<GoogleGeminiProviderConfig>;
  vertex?: Partial<VertexAIProviderConfig>;
}

export function createProvider(config: ProviderConfig): ProviderAdapter {
  switch (config.name) {
    case 'mock': {
      if (process.env.DRIFT_ENABLE_MOCK_PROVIDER !== 'true') {
        throw new Error(
          'mock provider requires DRIFT_ENABLE_MOCK_PROVIDER=true',
        );
      }
      const model = config.model ?? config.mock?.name?.split('/')[1] ?? 'test-model';
      return new MockProvider({
        name: `mock/${model}`,
        ...config.mock,
      });
    }
    case 'anthropic': {
      if (!config.model) {
        throw new Error('anthropic provider requires a "model" field in config');
      }
      return new AnthropicProvider({
        model: config.model,
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        ...config.anthropic,
      });
    }
    case 'ollama': {
      if (!config.model) {
        throw new Error('ollama provider requires a "model" field in config');
      }
      return new OllamaProvider({
        model: config.model,
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        ...config.ollama,
      });
    }
    case 'openai': {
      if (!config.model) {
        throw new Error('openai provider requires a "model" field in config');
      }
      return new OpenAIProvider({
        model: config.model,
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        ...config.openai,
      });
    }
    case 'azure': {
      const deployment = config.azure?.deployment ?? config.model;
      if (!deployment) {
        throw new Error(
          'azure provider requires either `config.model` or `config.azure.deployment`',
        );
      }
      return new AzureOpenAIProvider({
        resourceName: config.azure?.resourceName,
        endpoint: config.azure?.endpoint,
        deployment,
        apiVersion: config.azure?.apiVersion ?? '',
        apiKey: config.apiKey ?? config.azure?.apiKey,
        defaultMaxTokens: config.azure?.defaultMaxTokens,
        retry: config.azure?.retry,
        client: config.azure?.client,
      });
    }
    case 'bedrock': {
      const modelId = config.bedrock?.modelId ?? config.modelId ?? config.model;
      if (!modelId) {
        throw new Error(
          'bedrock provider requires a `modelId` (or `model`) field in config',
        );
      }
      return new BedrockAnthropicProvider({
        modelId,
        region: config.bedrock?.region ?? config.region,
        awsAccessKey: config.bedrock?.awsAccessKey,
        awsSecretKey: config.bedrock?.awsSecretKey,
        awsSessionToken: config.bedrock?.awsSessionToken,
        defaultMaxTokens: config.bedrock?.defaultMaxTokens,
        retry: config.bedrock?.retry,
        client: config.bedrock?.client,
      });
    }
    case 'google': {
      const model = config.gemini?.model ?? config.model;
      if (!model) {
        throw new Error('google provider requires a "model" field in config');
      }
      return new GoogleGeminiProvider({
        model,
        apiKey: config.gemini?.apiKey ?? config.apiKey,
        defaultMaxTokens: config.gemini?.defaultMaxTokens,
        retry: config.gemini?.retry,
        client: config.gemini?.client,
      });
    }
    case 'vertex': {
      const model = config.vertex?.model ?? config.model;
      if (!model) {
        throw new Error('vertex provider requires a "model" field in config');
      }
      return new VertexAIProvider({
        model,
        project: config.vertex?.project ?? config.project,
        location: config.vertex?.location ?? config.location,
        defaultMaxTokens: config.vertex?.defaultMaxTokens,
        retry: config.vertex?.retry,
        client: config.vertex?.client,
      });
    }
    default:
      throw new Error(`Unknown provider: ${config.name}`);
  }
}
