import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, ...(process.env.VITE_FLAT ? { outDir: 'dist-flat', assetsDir: '.' } : {}) },
});
