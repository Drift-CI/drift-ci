import type { Config } from 'drizzle-kit';

const config: Config = {
  schema: './src/lib/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://drift:drift@localhost:5432/drift_ci',
  },
  strict: true,
};

export default config;
