import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  // Relative asset paths, so the build works under GitHub Pages' /bet-with-friends/ path.
  base: './',
  plugins: [react()],
  server: { port: 5173 },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
