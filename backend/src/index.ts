import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { getDb } from './lib/db';
import { authenticate } from './lib/auth';
import { onError } from './lib/http';
import type { Env, Vars } from './lib/types';
import { me } from './routes/me';
import { users } from './routes/users';
import { roles } from './routes/roles';
import { departments } from './routes/departments';
import { positions } from './routes/positions';
import { settings } from './routes/settings';
import { orgChart } from './routes/org-chart';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.onError(onError);
app.use('*', secureHeaders());

// Only the sites listed in ALLOWED_ORIGINS may call this API from a browser.
app.use('*', async (c, next) =>
  cors({
    origin: (origin) => {
      const allowed = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
      return allowed.includes(origin) ? origin : null;
    },
    allowHeaders: ['authorization', 'content-type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  })(c, next),
);

// Open: used by uptime checks. Says nothing about the data.
app.get('/health', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT ?? 'unknown' }));

// Everything below needs a valid Supabase Auth token and an active profile.
app.use('/api/*', async (c, next) => {
  c.set('db', getDb(c.env));
  await next();
});
app.use('/api/*', authenticate);

app.route('/api/me', me);
app.route('/api/users', users);
app.route('/api/roles', roles);
app.route('/api/departments', departments);
app.route('/api/positions', positions);
app.route('/api/settings', settings);
app.route('/api/org-chart', orgChart);

app.notFound((c) => c.json({ error: 'No such endpoint' }, 404));

export default app;
