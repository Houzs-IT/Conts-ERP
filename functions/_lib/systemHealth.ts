/** Audit actions worth a second look: accounts and passwords, settings, money leaving, and anything deleted
 *  or cleared. A SQL condition on audit_log.action, shared by the health counts and the audit feed. */
export const SENSITIVE_SQL = `(action LIKE 'user.%' OR action LIKE 'account.%' OR action LIKE 'settings.%' OR action LIKE 'payout.%'
  OR action LIKE '%.delete' OR action LIKE 'data.%' OR action LIKE '%fail%')`;

export const RANGES: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
