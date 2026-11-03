import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { availableParallelism } from 'node:os'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: { ignored: ['**/.worktrees/**'] },
  },
  test: {
    environment: 'node',
    pool: 'threads',
    maxWorkers: Math.max(1, Math.min(4, availableParallelism() - 1)),
    testTimeout: 20000,
    hookTimeout: 20000,
    globalSetup: ['./tests/helpers/cleanTemp.js'],
    setupFiles: ['./tests/helpers/isolate.js'],
    include: ['tests/**/*.test.js'],
  },
})
