import { describe, it, expect, vi } from 'vitest';
import { AzureOpenAIProvider } from '../azure-openai.js';

function okResponse(model: string) {
  return {
    id: 'chatcmpl-azure',
    model,
    object: 'chat.completion',
    created: 1,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'from azure' },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  };
}

function fakeClient() {
  const create = vi.fn();
  return {
    client: { chat: { completions: { create } } },
    create,
  };
}

describe('AzureOpenAIProvider', () => {
  it('names itself `azure/<deployment>` regardless of the underlying model string', async () => {
    const { client, create } = fakeClient();
    create.mockResolvedValue(okResponse('gpt-4o-2024-08-06'));
    const p = new AzureOpenAIProvider({
      resourceName: 'drift',
      deployment: 'gpt4o-prod',
      apiVersion: '2024-10-21',
      apiKey: 'ak',
      client,
    });
    expect(p.name).toBe('azure/gpt4o-prod');
    const out = await p.complete('hi');
    expect(out.text).toBe('from azure');
  });

  it('passes the deployment as the model name when calling the injected client', async () => {
    const { client, create } = fakeClient();
    create.mockResolvedValue(okResponse('unused-response-model'));
    const p = new AzureOpenAIProvider({
      resourceName: 'drift',
      deployment: 'my-deploy',
      apiVersion: '2024-10-21',
      apiKey: 'ak',
      client,
    });
    await p.complete('hi');
    expect(create.mock.calls[0][0].model).toBe('my-deploy');
  });

  it('throws when apiKey is missing and AZURE_OPENAI_API_KEY is unset', () => {
    const original = process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    try {
      expect(() =>
        new AzureOpenAIProvider({
          resourceName: 'drift',
          deployment: 'd',
          apiVersion: '2024-10-21',
        }),
      ).toThrowError(/AZURE_OPENAI_API_KEY/);
    } finally {
      if (original !== undefined) process.env.AZURE_OPENAI_API_KEY = original;
    }
  });

  it('throws when neither endpoint nor resourceName is supplied', () => {
    expect(() =>
      new AzureOpenAIProvider({
        deployment: 'd',
        apiVersion: '2024-10-21',
        apiKey: 'ak',
      }),
    ).toThrowError(/endpoint.*resourceName/);
  });

  it('throws when apiVersion is missing', () => {
    expect(() =>
      new AzureOpenAIProvider({
        resourceName: 'drift',
        deployment: 'd',
        apiVersion: '',
        apiKey: 'ak',
      }),
    ).toThrowError(/apiVersion/);
  });

  it('accepts a custom endpoint URL in place of resourceName', async () => {
    // This only exercises the construction path — we pass a client, so
    // the Azure SDK code isn't actually hit. Verifies the schema.
    const { client, create } = fakeClient();
    create.mockResolvedValue(okResponse('x'));
    const p = new AzureOpenAIProvider({
      endpoint: 'https://custom.openai.azure.com',
      deployment: 'd',
      apiVersion: '2024-10-21',
      apiKey: 'ak',
      client,
    });
    await p.complete('hi');
    expect(p.name).toBe('azure/d');
  });
});
