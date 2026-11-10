// GET /accounting/ai-usage?months=6 — what the AI bill reader costs each month
// and how often it answered, for the active company (Houzs routes/aiUsage.ts,
// #4700). Mounted on /accounting, so it rides the Accounting area guard and the
// Ledger: the people who scan bills are the people who see what scanning costs.
// Reads public.ai_usage_events only; writes nothing.
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { requireActiveCompanyId } from '../lib/companyScope';
import { loadAiUsageReport, loadRecentAiFailures } from '../../services/aiUsage';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context, untyped as in the routes it sits beside */
export const aiUsageHandler = async (c: any): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const raw = Number(c.req.query('months') ?? 6);
  const months = Number.isFinite(raw) ? Math.min(24, Math.max(1, Math.trunc(raw))) : 6;
  try {
    const [report, failures] = await Promise.all([
      loadAiUsageReport(c.env.DB, co.companyId, months, new Date()),
      loadRecentAiFailures(c.env.DB, co.companyId),
    ]);
    return c.json({ ...report, recentFailures: failures });
  } catch (e) {
    console.error('[ai-usage] report failed:', e instanceof Error ? e.message : e);
    return c.json({ error: 'load_failed', message: 'AI usage could not be read. Try again in a moment.' }, 500);
  }
};

export const aiUsageRoutes = new Hono();
/* The SCM bridge, declared here rather than inherited: until 2026-11-11 this router
   only got it because officialReceiptAttachments (mounted just before it on
   /accounting) registers '/accounting/*' supabaseAuth. tests/scmRouterBridge.test.ts. */
aiUsageRoutes.use('*', supabaseAuth);
aiUsageRoutes.get('/ai-usage', aiUsageHandler);
