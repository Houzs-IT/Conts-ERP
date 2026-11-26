// Domains a Mail Center mailbox may use (CONTS-0081): the company's Branding email domain, plus any extra domains in
// the engine var MAIL_EXTRA_DOMAINS (comma-separated, e.g. a brand's own domain such as Dream Crafter's). An extra
// domain only works end to end once it is verified in Resend (sending) and routed to the inbound worker (receiving).
export function mailboxDomains(brandingEmail: string | null | undefined, extra: string | null | undefined): string[] {
  const own = (brandingEmail ?? "").split("@")[1] ?? "";
  const all = [own, ...(extra ?? "").split(",")].map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  return [...new Set(all)];
}
