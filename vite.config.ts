import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Match the ERP repos' "@/…" import alias (Hookka / Houzs convention).
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { outDir: 'dist', sourcemap: true },
  server: {
    port: 5173,
    // `npm run dev` starts wrangler on :8788, which serves /api from functions/.
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
});
