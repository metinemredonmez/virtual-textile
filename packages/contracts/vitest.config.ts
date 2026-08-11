import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'contracts',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 70, functions: 70 },
    },
  },
});
