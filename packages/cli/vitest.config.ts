import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts',
        'scripts/**',
      ],
      // Ratchet: this floor only goes up. Measured 84.33 % after M10;
      // gate set to the advertised Phase 1 KPI (80 %).
      thresholds: {
        statements: 80,
        lines: 80,
      },
    },
  },
});
