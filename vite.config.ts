import { defineConfig } from 'vite';

// A relative base keeps assets valid on project pages and on custom domains.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
