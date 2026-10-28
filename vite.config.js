import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: { ignored: ['**/.worktrees/**'] },
  },
  test: {
    environment: 'node',
    pool: 'threads',
    testTimeout: 20000,
    hookTimeout: 20000,
    globalSetup: ['./tests/helpers/cleanTemp.js'],
    setupFiles: ['./tests/helpers/isolate.js'],
    include: ['tests/**/*.test.js'],
  },
})
