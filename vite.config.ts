import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  base: './',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
      '/health': 'http://localhost:8080',
    },
  },
});
