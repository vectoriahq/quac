import { defineConfig } from 'vitest/config'

// The package's own test run. A test that needs a DOM opts in with a
// `@vitest-environment jsdom` comment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
