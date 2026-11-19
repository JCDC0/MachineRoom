import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { availableParallelism } from 'node:os'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 970,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll('\\', '/')
          if (normalized.includes('/src/control/mock.js')) {
            return 'mock'
          }
          if (normalized.includes('/node_modules/three/')) return 'three'
          if (
            normalized.includes('/node_modules/react/') ||
            normalized.includes('/node_modules/react-dom/') ||
            normalized.includes('/node_modules/scheduler/')
          ) {
            return 'react'
          }
        },
      },
    },
  },
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
    include: ['tests/**/*.test.js', 'tests/**/*.test.jsx'],
  },
})
