// Local test console for the Conts ERP API. Serves index.html on port 3000 only,
// on this computer only. Port 3000 is the staging Supabase "Site URL", so email
// sign-in links land here. Start the API first (`npm run dev`), then `npm run console`.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = 3000;
const page = () => readFileSync(new URL('./index.html', import.meta.url));

const handler = (req, res) => {
  if (req.url === '/favicon.ico') return res.writeHead(204).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(page());
};

// Both loopback addresses, because "localhost" can resolve to either on Windows.
createServer(handler).listen(PORT, '127.0.0.1', () => console.log(`Test console: http://localhost:${PORT}`));
createServer(handler).listen(PORT, '::1').on('error', () => {});
