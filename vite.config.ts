/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the same build works at guid.nz/wfsc/ and
  // guid.nz/wfsc/staging/. Routing uses the URL hash, so no server rewrites
  // are needed on GitHub Pages.
  base: './',
  // React + supabase-js is ~145 kB gzipped; fine for an internal tool.
  build: { chunkSizeWarningLimit: 700 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
