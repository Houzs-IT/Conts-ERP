import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
  server: {
    port: 5173,
    // `npm run dev` starts wrangler on :8788, which serves /api from functions/.
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
});
