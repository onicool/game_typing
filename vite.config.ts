import { defineConfig } from 'vite';

export default defineConfig({
  build: { rollupOptions: { input: { angel: 'index.html', legacy: 'legacy.html' } } },
});
