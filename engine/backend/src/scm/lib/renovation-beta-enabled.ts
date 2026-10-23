// The Beta switch (owner, 23 Oct 2026): the Beta menu and its routes exist only where BETA_ENABLED is "true",
// which is the staging worker (wrangler.toml). Production does not set it, so there Beta answers 404 and never
// shows. Unlike costing-enabled.ts this defaults OFF: a missing var must hide unfinished work, not show it.

export interface BetaEnv {
  BETA_ENABLED?: string;
}

export function isBetaEnabled(env: BetaEnv | null | undefined): boolean {
  return env?.BETA_ENABLED?.trim().toLowerCase() === "true";
}
