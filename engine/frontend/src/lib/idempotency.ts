// ---------------------------------------------------------------------------
// Idempotency keys for money-mutating requests — the CLIENT half.
//
// backend/src/middleware/idempotency.ts is mounted on /api/* after auth and
// companyContext, so principal + tenant scope are set before its claim store. It has an
// in-flight 409 and a daily TTL sweep. It is OPT-IN: a pure pass-through unless
// the client sends an `Idempotency-Key` header, and until this module NO client
// ever sent one. A safety feature nobody switched on is not a safety feature —
// every double-fire of a payment write (double tap, flaky-network re-submit,
// an operator re-pressing after a partial failure) booked the money twice.
//
// Two rules. Break EITHER and this is worse than the bug it fixes:
//
//   1. STABLE for a retry. A key minted per click or per render hands the two
//      halves of a double-fire two DIFFERENT keys, and the middleware no-ops.
//      That is a fix that does nothing.
//   2. UNIQUE per intent. A key derived from the payload makes two GENUINE
//      identical payments (the same customer pays RM100 twice today) collide,
//      and the middleware replays the first response verbatim — so the second
//      payment is silently swallowed and the money is never booked, while the
//      operator is told it saved. That is a fix that LOSES money.
//
// So: mint once when the operator STARTS one payment (opens the sheet, adds the
// draft row), reuse it for every retry of that one submit, and let it die with
// the thing that represents the intent — the draft row is removed on success,
// the sheet unmounts on close. The key is retired by the intent ENDING, never by
// the write succeeding; see useIdempotencyKey for why that distinction is load-
// bearing rather than pedantic.
//
// This is deliberately NOT hidden inside authedFetch. Only the call site knows
// where an intent begins and ends: an automatic per-request key would satisfy
// (2) and break (1); an automatic payload-derived key would satisfy (1) and
// break (2). There is no correct automatic key, which is precisely why the
// middleware was built opt-in and precisely why nobody ever opted in.
//
// SCOPE: money that duplicates — a call site that creates a payment-ledger row,
// adds to a paid total, or MINTS A SOURCE DOCUMENT money hangs off. The third
// clause was added 2026-07-17 (fix/so-idempotency) and is not a widening of the
// rule, it is the rule finally being read: SO create was left out while every
// payment stacked ON TOP of it was covered, so the order itself could be raised
// twice at RM3,888 and take DO / SI / stock with it. The middleware's own
// docblock always said so — "instead of creating a duplicate order/DO/PO".
//
// NOT a blanket on every POST: plenty of endpoints have legitimate repeat-submit
// semantics (SoFromProducts' batch generator raises N orders per run BY DESIGN —
// a per-mount key there would collapse N into 1, which is rule (2) inverted and
// worse than the bug it would claim to fix), and an endpoint that is already
// domain-idempotent (payment-vouchers.ts:407 /post, :528 /cancel both detect
// their own replay and echo back) gains nothing from a key.
// ---------------------------------------------------------------------------
import { useRef, useState } from "react";

/** Mint a key for ONE payment intent. Opaque to the server, which binds it to
 *  the authenticated principal, company, route and exact request payload. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // randomUUID needs a secure context. Keep a fallback so a payment can still
  // be recorded from an http:// LAN origin instead of throwing at the mint —
  // failing to mint must never block collecting money.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

/** Merge the key into a fetch init. No key → the init is returned untouched and
 *  the middleware stays a pass-through, i.e. exactly today's behaviour. Keeps
 *  the header name in ONE place so call sites can't misspell it into silence. */
export function idempotentInit(key: string | undefined, init: RequestInit): RequestInit {
  if (!key) return init;
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      "Idempotency-Key": key,
    },
  };
}

/** One intent's key, for a form/sheet whose MOUNT is the intent — the operator
 *  opened it to record ONE payment, and it closes once that payment lands. The
 *  key lives exactly as long as that mount: stable for every retry while the
 *  sheet is open, gone when it closes, so the next payment is a new mount and a
 *  new key. Callers whose intent is a DATA row rather than a mount (a
 *  PaymentsTable draft) should instead mint with newIdempotencyKey() and store
 *  it on the row, which dies with the row on success — same rule, same effect.
 *
 *  There is deliberately no `rotate()`. Retiring the key on success sounds
 *  safer and is not: the only way to reach a second submit is for a step AFTER
 *  the successful post to fail (a refetch on bad signal — the exact scenario
 *  this module exists for), and a rotated key would then book the payment a
 *  SECOND time. Keeping the key means that retry REPLAYS, which is the honest
 *  answer: the operator only ever intended one payment. The key is retired by
 *  the intent ending, never by the write succeeding.
 *
 *  AND NOT ON A REFUSAL EITHER — the tempting one, tried and REJECTED on
 *  2026-08-18, so nobody has to re-derive why. The dead end being chased is
 *  real: a GRN refused with 409 zero_cost_receipt claimed this key against the
 *  refused payload, so the corrected resubmit came back 409
 *  idempotency_key_reused and only a page reload (which throws away everything
 *  typed) got out of it. Rotating here on that code looks like the fix and is
 *  not, because `idempotency_key_reused` DOES NOT MEAN "nothing was written".
 *  backend/src/middleware/idempotency.ts answers it whenever the stored claim's
 *  request hash differs from this request's — including when that claim holds a
 *  COMMITTED 201. A client that rotates on it, and tells the operator to press
 *  Save again, turns a retype into a SECOND document, a second stock IN and a
 *  second AutoCount enqueue. Costing the operator their typing is the cheaper
 *  of those two by a wide margin.
 *
 *  The dead end is fixed where the answer is actually known: the ROUTE calls
 *  markIdempotencyNoWrite(c) when it can prove it rolled everything back, and
 *  the middleware then DELETES the claim, so the corrected resubmit is a fresh
 *  claim and simply succeeds — no 409 to react to, and nothing for this module
 *  to guess at. A `key_reused` that still reaches the client is therefore, by
 *  construction, one no route was able to prove; it carries `completed_status`
 *  (the earlier request's own HTTP status) and the only safe response to it is
 *  to go and look. */
export function useIdempotencyKey(): string {
  const [key] = useState(newIdempotencyKey);
  return key;
}

/* ---------------------------------------------------------------------------
 * A key per FORM CONTENT, for a create form the operator may correct and save again.
 *
 * WHY (owner, New Purchase Order, production 19 Nov 2026 18:07 MYT): the first Save was refused (a renovation PO
 * mixing two categories), the operator moved the line and pressed Save, and the reused mount key answered "An
 * earlier submission with different details already finished under this request key". The server half of the fix
 * releases a claim whenever the route can prove it wrote nothing; this is the client half, for the refusal no route
 * could prove.
 *
 * THE RULES, which keep both properties the docblock above insists on:
 *   - SAME content -> SAME key, always. A double press, or a retry after a stall, replays the first answer and never
 *     books a second document.
 *   - ANY save after the server REFUSED the last try with a 4xx (an answer, not a stall) -> a NEW key: the route said
 *     no, so the next press is a new request, not a retry. That holds for unchanged content too (audit 20 Nov 2026,
 *     items 19-24): the refusal may hang on something fixed elsewhere (stock received, a supplier set up), and the
 *     old key would only replay the stored refusal.
 *   - CHANGED content after a try whose outcome is UNKNOWN (no answer: a timeout, a dropped connection, a 5xx, a
 *     gateway error, "still going through") -> the caller must ASK first, because that try may have created the
 *     document; only a yes mints the new key.
 *   - `idempotency_key_reused` is never read as "nothing was saved" (it can follow a committed 201), so it counts
 *     as unknown, not as a refusal.
 * ------------------------------------------------------------------------- */

export type SubmitOutcome = "succeeded" | "refused" | "unknown";

/** What the last try's error says about whether it may have written. Only a plain 4xx from the route is a refusal. */
export function outcomeOfError(err: unknown): SubmitOutcome {
  const e = err as { status?: unknown; body?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : null;
  if (status == null || status < 400 || status >= 500) return "unknown";
  const body = typeof e?.body === "string" ? e.body : "";
  if (/"idempotency_(in_flight|key_reused|outcome_unknown|key_conflict)"/.test(body)) return "unknown";
  return "refused";
}

export type ContentKeyDecision = { key: string; needsConfirm: false } | { key: null; needsConfirm: true };

export type ContentBoundKey = {
  /** The key for this content, or `needsConfirm` when the content changed after a try with an unknown outcome. */
  keyFor(content: unknown): ContentKeyDecision;
  /** The operator confirmed saving the changed content although the last try may have written: mint its key. */
  confirmNewKey(content: unknown): string;
  /** Record how the try that used the current key ended. */
  settle(outcome: SubmitOutcome): void;
  /** The current key and the content it was minted for, kept with a form's local draft (lib/formDraft.ts). */
  snapshot(): ContentKeySnapshot | null;
  /** Take back a key kept with a restored draft. Its outcome is unknown (the page went away before or during the
      answer), so the same content replays under it and changed content asks first. */
  adopt(snap: unknown): void;
  /** Called whenever the key or its content changes (not on settle). */
  subscribe(fn: () => void): () => void;
};

export type ContentKeySnapshot = { key: string; sig: string };

/** Plain-object core of useContentBoundIdempotencyKey, so it can be tested without React. */
export function createContentBoundKey(mint: () => string = newIdempotencyKey): ContentBoundKey {
  let current: { key: string; sig: string; outcome: SubmitOutcome | "pending" } | null = null;
  const sigOf = (content: unknown) => JSON.stringify(content);
  const listeners = new Set<() => void>();
  let lastSeen = "";
  const changed = () => {
    const now = current ? `${current.key}|${current.sig}` : "";
    if (now === lastSeen) return;
    lastSeen = now;
    for (const fn of listeners) fn();
  };
  const keys: ContentBoundKey = {
    keyFor(content) {
      const sig = sigOf(content);
      if (!current) {
        current = { key: mint(), sig, outcome: "pending" };
        changed();
        return { key: current.key, needsConfirm: false };
      }
      if (current.outcome === "refused") {
        current = { key: mint(), sig, outcome: "pending" };
        changed();
        return { key: current.key, needsConfirm: false };
      }
      if (current.sig === sig) {
        current.outcome = "pending";
        return { key: current.key, needsConfirm: false };
      }
      if (current.outcome === "unknown") return { key: null, needsConfirm: true };
      /* Still running, or it succeeded (the page is about to leave): keep the key, so the server answers in_flight
         or replays instead of starting a second document. */
      return { key: current.key, needsConfirm: false };
    },
    confirmNewKey(content) {
      current = { key: mint(), sig: sigOf(content), outcome: "pending" };
      changed();
      return current.key;
    },
    settle(outcome) {
      if (current) current.outcome = outcome;
    },
    snapshot() {
      return current ? { key: current.key, sig: current.sig } : null;
    },
    adopt(snap) {
      const s = snap as Partial<ContentKeySnapshot> | null;
      if (typeof s?.key !== "string" || typeof s.sig !== "string") return;
      current = { key: s.key, sig: s.sig, outcome: "unknown" };
      changed();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
  return keys;
}

/** For a create form that opens inside a page that stays mounted (a modal or card on a list page): a fresh key set
 *  each time `intent` changes identity (the form state object set on open, or its open flag), so the next document
 *  is a new intent and two genuine identical documents never share a key. */
export function useContentBoundIdempotencyKeyFor(intent: unknown): ContentBoundKey {
  const ref = useRef<{ intent: unknown; keys: ContentBoundKey } | null>(null);
  if (!ref.current || ref.current.intent !== intent) ref.current = { intent, keys: createContentBoundKey() };
  return ref.current.keys;
}

/** One create form's content-bound key, living as long as the form's mount (see createContentBoundKey). */
export function useContentBoundIdempotencyKey(): ContentBoundKey {
  const ref = useRef<ContentBoundKey | null>(null);
  if (!ref.current) ref.current = createContentBoundKey();
  return ref.current;
}

/**
 * One content-keyed submit: takes the key for this content, asks before minting a new key when the last try may have
 * written (`askNewKey`; a no returns `{ sent: false }`), sends, and records how it ended. A failure is re-thrown after
 * it is recorded, so a refusal (4xx) lets the corrected content go out under a new key.
 */
export async function sendWithContentKey<T>(
  keys: ContentBoundKey,
  content: unknown,
  askNewKey: () => Promise<boolean>,
  send: (key: string) => Promise<T>,
): Promise<{ sent: false } | { sent: true; value: T }> {
  const decision = keys.keyFor(content);
  let key = decision.key;
  if (decision.needsConfirm) {
    if (!(await askNewKey())) return { sent: false };
    key = keys.confirmNewKey(content);
  }
  try {
    const value = await send(key!);
    keys.settle("succeeded");
    return { sent: true, value };
  } catch (err) {
    keys.settle(outcomeOfError(err));
    throw err;
  }
}

/** The usual question before a changed form goes out after a save that got no answer. */
export function unansweredSaveQuestion(docLabel: string, whereToCheck: string) {
  return {
    title: "Your last save did not get an answer",
    body: `It may already have created this ${docLabel}. Check ${whereToCheck} first.

Save this changed version anyway?`,
    confirmLabel: "Save changed version",
    danger: true,
  };
}

/**
 * The key for one press of Save on a content-keyed form, for call sites that settle the outcome themselves
 * (mutate with onSuccess / onError: call keys.settle("succeeded") and keys.settle(outcomeOfError(err))).
 * Returns null when the operator declined the "last save got no answer" question.
 */
export async function contentKeyFor(
  keys: ContentBoundKey,
  content: unknown,
  askNewKey: () => Promise<boolean>,
): Promise<string | null> {
  const decision = keys.keyFor(content);
  if (!decision.needsConfirm) return decision.key;
  if (!(await askNewKey())) return null;
  return keys.confirmNewKey(content);
}

/**
 * Wraps a mutate() call's callbacks so the try's outcome is recorded on the content key before the form's own
 * onSuccess / onError run. The callbacks keep their types from the mutate() call they are passed to.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function settleOutcome<C extends { onSuccess?: (...args: any[]) => unknown; onError?: (err: any, ...rest: any[]) => unknown }>(
  keys: ContentBoundKey,
  callbacks: C,
): C {
  return {
    ...callbacks,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (...args: any[]) => { keys.settle("succeeded"); return callbacks.onSuccess?.(...args); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any, ...rest: any[]) => { keys.settle(outcomeOfError(err)); return callbacks.onError?.(err, ...rest); },
  };
}
