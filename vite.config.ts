import { defineConfig } from 'vite';

export default defineConfig({
  base: '/LadderLens/',
  root: '.',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
  },
});
