/* The client's read-only Client PO link (owner, 24 Oct 2026). No table: the token is the project and company it was
   made for plus an expiry date, signed with HMAC-SHA256 under a key derived from CONTS_SSO_SECRET (a separate label,
   so it is not the SSO signature). Nobody can make one for another project without the secret. A link cannot be
   revoked one by one; it expires after LINK_DAYS, and changing the secret ends all of them. */

export const LINK_DAYS = 120;

export interface LinkClaim { projectId: number; companyId: number; expiresAt: number }

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(`beta-client-po-link:v1:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,80}\.[A-Za-z0-9_-]{43}$/;

export async function signClientLink(secret: string, claim: LinkClaim): Promise<string> {
  const body = b64url(enc.encode(`${claim.projectId}.${claim.companyId}.${claim.expiresAt}`));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** The claim of a genuine, unexpired token; null for anything else. */
export async function readClientLink(secret: string, token: string, now = Date.now()): Promise<LinkClaim | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const [body, sigText] = token.split(".");
  const sig = fromB64url(sigText);
  if (!sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await key(secret), sig, enc.encode(body));
  if (!ok) return null;
  const raw = fromB64url(body);
  if (!raw) return null;
  const parts = new TextDecoder().decode(raw).split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  const [projectId, companyId, expiresAt] = parts;
  if (expiresAt < now) return null;
  return { projectId, companyId, expiresAt };
}
