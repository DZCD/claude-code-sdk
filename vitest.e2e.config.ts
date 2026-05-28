import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/e2e/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    allowOnly: true,
    sequence: {
      // Run sequentially to avoid hitting API rate limits
      concurrent: false,
    },
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/__tests__/**'],
      reporter: ['text', 'text-summary'],
      enabled: false,
    },
  },
})
