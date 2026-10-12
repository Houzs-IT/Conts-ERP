/** Whether to offer two-step sign-in on the next screen. Raised by a password-only sign-in, lowered when the
 *  person answers the prompt (components/TwoStepPrompt). Kept for the tab only, so it asks once per sign-in. */
const KEY = 'tc_two_step_prompt';
export const twoStepPrompt = {
  raise: () => { try { sessionStorage.setItem(KEY, '1'); } catch { /* private window: no prompt, sign-in still works */ } },
  raised: () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } },
  lower: () => { try { sessionStorage.removeItem(KEY); } catch { /* nothing to lower */ } },
};
