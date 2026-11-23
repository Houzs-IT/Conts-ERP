// JSON calls to /api/meetings for the Meetings page (see kit.tsx for why this file exists). A refusal throws
// MeetingsApiError with the status and the raw body: a 409 carries the hub's conflict, which the page draws a dialog
// from. The Conts' own envelope ({ error: { code, message } }) and the hub's ({ error: "..." }) both read here.
import { friendlyMessage, wrote } from "../../lib/api";

export class MeetingsApiError extends Error {
  readonly status: number;
  readonly rawBody: string;
  constructor(message: string, status: number, rawBody: string) {
    super(message);
    this.status = status;
    this.rawBody = rawBody;
  }
}

function messageOf(status: number, raw: string): string {
  try {
    const j = JSON.parse(raw) as { error?: unknown };
    if (j.error === "conflict") return "That time is taken.";
    if (typeof j.error === "string") return friendlyMessage(status, undefined, j.error);
    if (j.error && typeof j.error === "object") {
      const e = j.error as { code?: string; message?: string };
      return friendlyMessage(status, e.code, e.message);
    }
  } catch {
    /* not JSON: the plain sentence for the status */
  }
  return friendlyMessage(status, undefined, undefined);
}

async function call<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const write = method !== "GET";
  if (write) wrote();
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers: form ? undefined : body === undefined ? undefined : { "Content-Type": "application/json" },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch {
    throw new MeetingsApiError(write ? "No answer came back from the server, so this may still have been saved. Refresh and check before trying again." : "Could not reach the server. Check your internet connection and try again.", 0, "");
  } finally {
    if (write) wrote();
  }
  const raw = await res.text();
  if (!res.ok) throw new MeetingsApiError(messageOf(res.status, raw), res.status, raw);
  return (raw ? JSON.parse(raw) : {}) as T;
}

export const api = {
  get: <T,>(path: string, _opts?: { signal?: AbortSignal }) => call<T>("GET", path),
  post: <T = unknown,>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  patch: <T = unknown,>(path: string, body?: unknown) => call<T>("PATCH", path, body ?? {}),
  postForm: <T = unknown,>(path: string, form: FormData) => call<T>("POST", path, undefined, form),
  async fetchBlobUrl(path: string, mime?: string): Promise<string> {
    const res = await fetch(path, { credentials: "include" });
    if (!res.ok) throw new MeetingsApiError("That file could not be opened.", res.status, "");
    const blob = await res.blob();
    return URL.createObjectURL(mime ? new Blob([blob], { type: mime }) : blob);
  },
};

/** Opens a file fetched with the session in a new tab, and frees it after `keepMs`. */
export async function openLoadedTab(load: () => Promise<string>, keepMs: number): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const url = await load();
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), keepMs);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
