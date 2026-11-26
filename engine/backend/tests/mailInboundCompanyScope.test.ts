import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { app } from "../src/index";
import { companyCodeForRecipient, ingestInboundEmail } from "../src/routes/mail-center";
import { MAX_INBOUND_BYTES } from "../src/routes/mail-inbound";
import type { Env } from "../src/types";

// DEV-03 / PRD T-011 P1 (Conts: single company, see below). A6 in Houzs: a forged In-Reply-To cannot attach a message to
// the other company's thread, and one mail copied to both companies is kept by
// both. R8: the inbound endpoint refuses oversized bodies and slows secret
// guessing.

const SECRET = "inbound-secret-0123456789";
const inboundEnv = { ...env, MAIL_INBOUND_SECRET: SECRET } as unknown as Env;

beforeAll(async () => {
  const schema = [
    `CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY, code TEXT NOT NULL)`,
    `INSERT OR IGNORE INTO companies (id, code) VALUES (1, 'HOUZS')`,
    `CREATE TABLE IF NOT EXISTS email_addresses (id TEXT PRIMARY KEY, address TEXT NOT NULL, label TEXT, assigned_user_id INTEGER, assigned_user_name TEXT, assigned_dept TEXT, assigned_position TEXT, department_id INTEGER, requested_department_id INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at TEXT, created_by INTEGER, company_id INTEGER NOT NULL DEFAULT 1, mail_host_status TEXT, mail_host_confirmed_at TEXT, mail_host_confirmed_by INTEGER)`,
    `CREATE TABLE IF NOT EXISTS email_threads (id TEXT PRIMARY KEY, mailbox_address TEXT, subject TEXT, counterparty_email TEXT, counterparty_name TEXT, status TEXT NOT NULL DEFAULT 'open', assigned_to_user_id INTEGER, assigned_to_name TEXT, last_message_at TEXT, last_direction TEXT, last_snippet TEXT, message_count INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 1, starred INTEGER NOT NULL DEFAULT 0, labels TEXT, trashed_at TEXT, last_inbound_at TEXT, created_at TEXT, company_id INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS email_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, direction TEXT NOT NULL, message_id TEXT, in_reply_to TEXT, reference_ids TEXT, from_address TEXT, from_name TEXT, to_addresses TEXT, cc_addresses TEXT, subject TEXT, text_body TEXT, html_body TEXT, sent_at TEXT, received_at TEXT, sent_by_user_id INTEGER, sent_by_name TEXT, provider_message_id TEXT, outbox_id TEXT, needs_ack INTEGER NOT NULL DEFAULT 0, ack_escalated_at TEXT, created_at TEXT, company_id INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS email_thread_reads (thread_id TEXT NOT NULL, user_id INTEGER NOT NULL, read_at TEXT, PRIMARY KEY (thread_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS email_message_acks (message_id TEXT NOT NULL, user_id INTEGER NOT NULL, requested_at TEXT NOT NULL, acked_at TEXT, PRIMARY KEY (message_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS email_attachments (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, filename TEXT, content_type TEXT, size_bytes INTEGER, storage_path TEXT, content_id TEXT, created_at TEXT)`,
  ];
  for (const s of schema) await env.DB.prepare(s).run();
});

beforeEach(async () => {
  await env.DB.exec(`DELETE FROM email_messages`);
  await env.DB.exec(`DELETE FROM email_threads`);
});

async function ingest(deliveredTo: string, messageId: string, inReplyTo?: string) {
  const r = await ingestInboundEmail(
    env.DB,
    {
      from: "someone@example.com",
      to: ["help@theconts.com"],
      deliveredTo,
      subject: "Hello",
      text: "hi",
      messageId,
      ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    },
    inboundEnv,
  );
  if (!r.ok) throw new Error(r.error);
  return r;
}

async function companyOf(threadId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT company_id FROM email_threads WHERE id = ?`)
    .bind(threadId)
    .first<{ company_id: number }>();
  return Number(row?.company_id);
}

// Conts: ONE company (internal code HOUZS, migrations-pg/0046). Houzs's A6 cases
// (forged In-Reply-To across companies, one mail kept by both) need a second
// company and do not apply; what does apply is that every recipient, on
// theconts.com or not, lands in that one company, threads and de-duplicates.
describe("Conts: inbound lands in the single company", () => {
  test("theconts.com and any other recipient resolve to the single company's code", () => {
    expect(companyCodeForRecipient(["help@theconts.com"])).toBe("HOUZS");
    expect(companyCodeForRecipient(["sales@brand.example", "x@theconts.com"])).toBe("HOUZS");
    expect(companyCodeForRecipient([])).toBe("HOUZS");
  });

  test("no Houzs or 2990 domain is special any more", () => {
    expect(companyCodeForRecipient(["hello@2990shome.com"])).toBe("HOUZS");
  });

  test("a mail is stamped with company 1, a reply threads, and a re-delivery is deduped", async () => {
    const first = await ingest("help@theconts.com", "<c-1@example.com>");
    expect(await companyOf(first.threadId)).toBe(1);
    const next = await ingest("help@theconts.com", "<c-2@example.com>", "<c-1@example.com>");
    expect(next.threadId).toBe(first.threadId);
    const again = await ingest("help@theconts.com", "<c-1@example.com>");
    expect(again.deduped).toBe(true);
  });

  test("an unregistered recipient falls back to theconts.com, never a Houzs address", async () => {
    const r = await ingestInboundEmail(
      env.DB,
      { from: "someone@example.com", to: ["nobody@theconts.com"], subject: "Hi", text: "hi", messageId: "<fb-1@example.com>" },
      inboundEnv,
    );
    if (!r.ok) throw new Error(r.error);
    const row = await env.DB.prepare(`SELECT mailbox_address FROM email_threads WHERE id = ?`)
      .bind(r.threadId)
      .first<{ mailbox_address: string }>();
    expect(row?.mailbox_address).toBe("nobody@theconts.com");
  });
});

describe("R8: inbound endpoint limits", () => {
  test("an oversized body is refused before it is read", async () => {
    const res = await app.request(
      "/api/mail-center/inbound",
      {
        method: "POST",
        headers: {
          "x-mail-secret": SECRET,
          "content-type": "application/json",
          "content-length": String(MAX_INBOUND_BYTES + 1),
        },
        body: "{}",
      },
      inboundEnv,
    );
    expect(res.status).toBe(413);
  });

  test("wrong secrets from one address are slowed to 429 after 20 tries", async () => {
    const headers = { "x-mail-secret": "wrong-secret-wrong-secret", "CF-Connecting-IP": "203.0.113.9" };
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await app.request("/api/mail-center/inbound", { method: "POST", headers, body: "{}" }, inboundEnv);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  test("the right secret still ingests", async () => {
    const res = await app.request(
      "/api/mail-center/inbound",
      {
        method: "POST",
        headers: { "x-mail-secret": SECRET, "content-type": "application/json" },
        body: JSON.stringify({ from: "a@example.com", to: ["help@theconts.com"], messageId: "<ok-1@example.com>" }),
      },
      inboundEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
