import OpenAI, { AzureOpenAI } from 'openai';

import { OpenAIProvider, type OpenAILike } from './openai.js';
import type { RetryOptions } from './utils.js';

export interface AzureOpenAIProviderConfig {
  /** Azure resource name (the subdomain in `https://<resource>.openai.azure.com`). */
  resourceName?: string;
  /** Full endpoint URL. Takes precedence over `resourceName` if both are set. */
  endpoint?: string;
  /** Deployment ID inside the Azure resource. Acts as the model name in drift-ci. */
  deployment: string;
  /** Azure API version. Required by the Azure OpenAI service. */
  apiVersion: string;
  apiKey?: string;
  defaultMaxTokens?: number;
  retry?: RetryOptions;
  /** Inject a client (e.g. for unit tests) instead of building one. */
  client?: OpenAILike;
}

export class AzureOpenAIProvider extends OpenAIProvider {
  constructor(config: AzureOpenAIProviderConfig) {
    const client =
      config.client ??
      (buildAzureClient(config) as unknown as OpenAILike);
    super({
      model: config.deployment,
      apiKey: config.apiKey,
      defaultMaxTokens: config.defaultMaxTokens,
      retry: config.retry,
      client,
      nameOverride: `azure/${config.deployment}`,
    });
  }
}

function buildAzureClient(config: AzureOpenAIProviderConfig): OpenAI {
  const apiKey = config.apiKey ?? process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AzureOpenAIProvider: AZURE_OPENAI_API_KEY env var (or config.apiKey) is required.',
    );
  }
  if (!config.endpoint && !config.resourceName) {
    throw new Error(
      'AzureOpenAIProvider: either `endpoint` or `resourceName` must be provided.',
    );
  }
  if (!config.apiVersion) {
    throw new Error(
      'AzureOpenAIProvider: `apiVersion` is required (e.g. "2024-10-21").',
    );
  }
  const endpoint =
    config.endpoint ?? `https://${config.resourceName}.openai.azure.com`;
  return new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion: config.apiVersion,
    deployment: config.deployment,
  });
}
