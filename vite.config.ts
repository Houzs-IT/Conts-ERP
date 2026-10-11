import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { usedIconsPlugin } from './scripts/build/usedIcons.mjs';

// Each build gets its own id, baked into the bundle and written to dist/version.json. An open tab compares
// the two to tell its user a newer version has been deployed (src/components/UpdateNotice.tsx).
const BUILD_ID = new Date().toISOString();
const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: BUILD_ID }) }); },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile(), usedIconsPlugin(fileURLToPath(new URL('./src', import.meta.url)))],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
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
