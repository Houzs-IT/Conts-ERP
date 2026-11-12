import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { usedIconsPlugin } from './scripts/build/usedIcons.mjs';

// Each build gets its own id, written into index.html (a meta tag, read by src/lib/buildId.ts) and to dist/version.json.
// An open tab compares the two to tell its user a newer version has been deployed (src/components/UpdateNotice.tsx).
// Never a `define`: compiled into a script it renamed that chunk and every chunk importing it on every build, so a
// deploy took away files open tabs still needed even where no code had changed (Houzs c9ad7527a).
const BUILD_ID = new Date().toISOString();
const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: BUILD_ID }) }); },
  transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'conts-build-id', content: BUILD_ID }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile(), usedIconsPlugin(fileURLToPath(new URL('./src', import.meta.url)))],
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
