import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
  },
});
