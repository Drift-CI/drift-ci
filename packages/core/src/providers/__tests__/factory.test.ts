import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  AnthropicProvider,
  AzureOpenAIProvider,
  BedrockAnthropicProvider,
  GoogleGeminiProvider,
  OllamaProvider,
  OpenAIProvider,
  VertexAIProvider,
  createProvider,
} from '../index.js';
import type { GoogleGenAILike } from '../google-base.js';

describe('createProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('gates mock behind DRIFT_ENABLE_MOCK_PROVIDER=true', () => {
    delete process.env.DRIFT_ENABLE_MOCK_PROVIDER;
    expect(() => createProvider({ name: 'mock' })).toThrowError(
      /DRIFT_ENABLE_MOCK_PROVIDER=true/,
    );
  });

  it('returns a MockProvider when the gate is open', () => {
    process.env.DRIFT_ENABLE_MOCK_PROVIDER = 'true';
    const p = createProvider({ name: 'mock' });
    expect(p.name).toContain('mock');
  });

  it('returns an AnthropicProvider when model + apiKey are provided', () => {
    const p = createProvider({
      name: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-ant-test-key-123456',
    });
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p.name).toBe('anthropic/claude-sonnet-4-5');
  });

  it('errors when anthropic is chosen without a model', () => {
    expect(() =>
      createProvider({ name: 'anthropic', apiKey: 'sk-ant-x' }),
    ).toThrowError(/requires a "model"/);
  });

  it('returns an OllamaProvider when model is provided', () => {
    const p = createProvider({ name: 'ollama', model: 'llama3.2' });
    expect(p).toBeInstanceOf(OllamaProvider);
    expect(p.name).toBe('ollama/llama3.2');
  });

  it('errors when ollama is chosen without a model', () => {
    expect(() => createProvider({ name: 'ollama' })).toThrowError(
      /requires a "model"/,
    );
  });

  it('returns an OpenAIProvider when model + apiKey are provided', () => {
    const p = createProvider({
      name: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
    });
    expect(p).toBeInstanceOf(OpenAIProvider);
    expect(p.name).toBe('openai/gpt-4o-mini');
  });

  it('errors when openai is chosen without a model', () => {
    expect(() =>
      createProvider({ name: 'openai', apiKey: 'sk-test' }),
    ).toThrowError(/requires a "model"/);
  });

  it('returns an AzureOpenAIProvider routed through `config.azure`', () => {
    const fakeClient = { chat: { completions: { create: vi.fn() } } };
    const p = createProvider({
      name: 'azure',
      model: 'gpt4o-prod',
      azure: {
        resourceName: 'drift',
        apiVersion: '2024-10-21',
        apiKey: 'ak',
        client: fakeClient,
      },
    });
    expect(p).toBeInstanceOf(AzureOpenAIProvider);
    expect(p.name).toBe('azure/gpt4o-prod');
  });

  it('errors when azure is chosen without a deployment or top-level model', () => {
    expect(() =>
      createProvider({
        name: 'azure',
        azure: { resourceName: 'drift', apiVersion: '2024-10-21', apiKey: 'ak' },
      }),
    ).toThrowError(/deployment/);
  });

  it('returns a BedrockAnthropicProvider when modelId is provided', () => {
    const fakeClient = { messages: { create: vi.fn() } };
    const p = createProvider({
      name: 'bedrock',
      modelId: 'anthropic.claude-sonnet-4-5-20260101-v1:0',
      bedrock: { client: fakeClient },
    });
    expect(p).toBeInstanceOf(BedrockAnthropicProvider);
    expect(p.name).toBe('bedrock/anthropic.claude-sonnet-4-5-20260101-v1:0');
  });

  it('accepts `model` as an alias for `modelId` on bedrock', () => {
    const fakeClient = { messages: { create: vi.fn() } };
    const p = createProvider({
      name: 'bedrock',
      model: 'anthropic.claude-sonnet-4-5-20260101-v1:0',
      bedrock: { client: fakeClient },
    });
    expect(p.name).toBe('bedrock/anthropic.claude-sonnet-4-5-20260101-v1:0');
  });

  it('errors when bedrock is chosen without a modelId or model', () => {
    expect(() =>
      createProvider({
        name: 'bedrock',
        bedrock: { client: { messages: { create: vi.fn() } } },
      }),
    ).toThrowError(/modelId/);
  });

  it('returns a GoogleGeminiProvider when model + apiKey are provided', () => {
    const fakeClient = { models: { generateContent: vi.fn() } } as GoogleGenAILike;
    const p = createProvider({
      name: 'google',
      model: 'gemini-2.5-pro',
      apiKey: 'gak-test',
      gemini: { client: fakeClient },
    });
    expect(p).toBeInstanceOf(GoogleGeminiProvider);
    expect(p.name).toBe('google/gemini-2.5-pro');
  });

  it('errors when google is chosen without a model', () => {
    expect(() =>
      createProvider({ name: 'google', apiKey: 'gak-test' }),
    ).toThrowError(/requires a "model"/);
  });

  it('returns a VertexAIProvider routed through `config.vertex`', () => {
    const fakeClient = { models: { generateContent: vi.fn() } } as GoogleGenAILike;
    const p = createProvider({
      name: 'vertex',
      model: 'gemini-2.5-pro',
      project: 'my-proj',
      location: 'us-central1',
      vertex: { client: fakeClient },
    });
    expect(p).toBeInstanceOf(VertexAIProvider);
    expect(p.name).toBe('vertex/gemini-2.5-pro');
  });

  it('errors when vertex is chosen without a model', () => {
    expect(() =>
      createProvider({
        name: 'vertex',
        project: 'p',
        location: 'us-central1',
        vertex: { client: { models: { generateContent: vi.fn() } } as GoogleGenAILike },
      }),
    ).toThrowError(/requires a "model"/);
  });

  it('errors on unknown provider names', () => {
    expect(() => createProvider({ name: 'qux' })).toThrowError(/Unknown provider/);
  });
});
