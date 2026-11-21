import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { availableParallelism } from 'node:os'

export const CHUNK_GROUPS = [
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 60 },
  { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 50 },
  { name: 'engine', test: /src[\\/](engine|model)[\\/]/, priority: 40 },
  { name: 'mock', test: /src[\\/]control[\\/]mock\.js/, priority: 30 },
]

export function chunkGroupFor(id) {
  const normalized = String(id).replaceAll('\\', '/')
  let best
  for (const group of CHUNK_GROUPS) {
    if (!group.test.test(normalized)) continue
    if (best === undefined || group.priority > best.priority) best = group
  }
  return best?.name
}

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 970,
    rollupOptions: {
      output: {
        codeSplitting: { groups: CHUNK_GROUPS },
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
