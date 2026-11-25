/** The AI Connector's "Allow?" screen (/ai-connect?request=...) opened by someone who is not signed in yet: sign-in
 *  sends everyone to their home screen (session.tsx), so the address is kept here for the tab and taken back once. */
const KEY = 'conts.aiConnectReturn';

export function rememberAiConnect(pathWithQuery: string) {
  try { sessionStorage.setItem(KEY, pathWithQuery); } catch { /* storage refused: they start again from the AI app */ }
}

/** The kept /ai-connect address, once (it is removed as it is read), or null. */
export function takeAiConnect(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v && /^\/ai-connect\?request=[A-Za-z0-9_%-]+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
