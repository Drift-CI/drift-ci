import { describe, it, expect } from 'vitest';
import { SchemaEvaluator } from '../schema.js';

describe('SchemaEvaluator', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer', minimum: 0 },
    },
    required: ['name', 'age'],
    additionalProperties: false,
  };

  it('throws when the case has no schema', async () => {
    const ev = new SchemaEvaluator();
    await expect(
      ev.evaluate({ input: 'x', output: '{}' }),
    ).rejects.toThrow(/requires a `schema` field/);
  });

  it('scores 1 when output is valid JSON matching the schema', async () => {
    const ev = new SchemaEvaluator(schema);
    const res = await ev.evaluate({
      input: 'give me a person',
      output: '{"name":"Ada","age":36}',
    });
    expect(res.score).toBe(1);
    expect(res.reason).toMatch(/valid/i);
  });

  it('scores 0 when output is not valid JSON', async () => {
    const ev = new SchemaEvaluator(schema);
    const res = await ev.evaluate({
      input: 'x',
      output: 'not-json',
    });
    expect(res.score).toBe(0);
    expect(res.reason).toMatch(/not valid JSON/);
  });

  it('scores 0 when JSON fails validation and reports errors', async () => {
    const ev = new SchemaEvaluator(schema);
    const res = await ev.evaluate({
      input: 'x',
      output: '{"name":"Ada"}',
    });
    expect(res.score).toBe(0);
    expect(res.reason).toMatch(/Schema invalid/);
    expect(res.reason).toMatch(/age/);
  });

  it('rejects additional properties when configured', async () => {
    const ev = new SchemaEvaluator(schema);
    const res = await ev.evaluate({
      input: 'x',
      output: '{"name":"Ada","age":36,"extra":true}',
    });
    expect(res.score).toBe(0);
  });
});
