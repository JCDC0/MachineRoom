import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/paperclip': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/paperclip/, ''),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
