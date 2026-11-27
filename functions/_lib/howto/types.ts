/**
 * howto/types.ts: the shape of the AI Connector's process help ("how do I...", owner 27 Nov 2026). Staff who do not
 * know how to do something ask Claude and get click-by-click guidance written to an SOP standard. Every guide is
 * written from the real frontend code; src/lib/mcpHowto.test.mjs checks every page path against the router and every
 * double-quoted UI label against the frontend source (src/ for The Conts' own screens, engine/frontend/src for the
 * supply chain engine's screens that Dream Crafter works in).
 *
 * Writing rules (enforced by the test where possible):
 *   - English only, except search keywords (staff type Chinese and Malay).
 *   - A UI label the person clicks or reads is written in DOUBLE quotes and must appear verbatim in the frontend.
 *     Typical values the person types go in single quotes, never double quotes.
 *   - No vague steps ("fill in the details"): every field is listed.
 *   - Business rules only from what the code enforces, cited in a code comment beside the text.
 */

/** The two companies on one system (access.ts Side): The Conts (short-stay rental) and Dream Crafter (renovation). */
export type Company = 'conts' | 'dream_crafter';

/** One input the person fills in. `label` is the exact UI label. */
export type HowToField = {
  label: string;
  required: boolean;
  /** Format / validation rule and what to put there. */
  value: string;
  /** A typical value, e.g. '2026-12-05'. */
  example?: string;
};

export type HowToStep = {
  /** The action, with the exact button / tab / menu label in double quotes. */
  do: string;
  /** The page this step happens on (router path, may contain :id). Defaults to the guide's page. */
  page?: string;
  /** The exact label of the button / tab to press: the ERP link carries ?highlight=<this>. */
  highlight?: string;
  fields?: HowToField[];
  /** What to check before confirming this step. */
  check?: string;
  /** What happens after the click, and where you land next. */
  then?: string;
};

export type HowToMistake = { mistake: string; fix: string };

/**
 * A permission the ERP checks, in one of two forms:
 *   "METHOD /api/path"   the session middleware's own gate for that request (access.ts accessFor + refusalFor), the
 *                        same check the connector's tools/list and actions use (mcpActionTools.ts gateFor);
 *   "area:<key>:<level>" the person's level on a permission area (Users and roles > Permissions) is at least
 *                        <level> (view | edit | full). Used for the supply chain engine's screens, which the engine
 *                        opens from the levels The Conts sends it at sign-on.
 */
export type HowToPermission = string;

export type HowToGuide = {
  id: string;
  title: string;
  /** English plus the Chinese / Malay words staff type. */
  keywords: string[];
  module: string;
  /** Purpose / when to use it. */
  purpose: string;
  /** What must exist first. */
  prerequisites: string[];
  /** The role(s) that normally do this. */
  who: string;
  /** Every one must hold for canDo. */
  permission: HowToPermission[];
  /** Optional OR-gate: when set, at least one of these must ALSO hold. */
  permissionAny?: HowToPermission[];
  /** The page where the task starts (router path, no :id). */
  page: string;
  /** How to reach `page` from the sidebar, e.g. "RESERVATIONS > Reservations". */
  sidebar: string;
  steps: HowToStep[];
  /** What to verify before the final confirm. */
  checkBefore: string[];
  /** What changes, and where you see it afterwards. */
  result: string;
  /** Locks a document, moves money, sends to a guest / owner / supplier, cannot be undone. */
  warnings: string[];
  /** How to fix a mistake after confirming, and who can. */
  undo: string;
  /** Approvals needed, if any. */
  approvals?: string;
  /** Cut-offs the system enforces, if any. */
  deadlines?: string;
  commonMistakes: HowToMistake[];
  /** One short realistic example (made-up names). */
  workedExample: string;
  related: string[];
  nextStep?: string;
  /** Which role to ask. */
  contact: string;
  /** The company (or both) this guide is for. A person sees the guides of their own side (Users and roles). */
  companies: Company[];
  /** Where a company, channel or unit type changes the flow. */
  variants?: HowToVariant[];
};

export type HowToVariant = {
  /** When this applies, e.g. "Owner stay" or "Reservation from a channel". */
  case: string;
  companies?: Company[];
  /** What is different, with exact UI labels in double quotes. */
  differences: string[];
};

/** One step of an end-to-end business chain: a task guide, who does it, and the hand-off. */
export type HowToFlowStep = {
  guide: string;
  role: string;
  /** What must be true before this step / what the previous step handed over. */
  handoff: string;
};

export type HowToFlow = {
  id: string;
  title: string;
  keywords: string[];
  summary: string;
  companies: Company[];
  steps: HowToFlowStep[];
};

export type HowToModule = {
  id: string;
  /** The sidebar section label exactly as navigation.ts has it (e.g. "RESERVATIONS"). */
  section: string;
  company: Company | 'both';
  oneLine: string;
  purpose: string;
  usedBy: string;
  /** Sidebar entries: `name` is the menu label, `path` the router path, `area` the permission area it opens under. */
  pages: { name: string; path: string; area?: string }[];
  /** How it connects to other modules. */
  links: string[];
  guides: string[];
};

export type HowToTerm = {
  term: string;
  aliases: string[];
  keywords: string[];
  definition: string;
  company: Company | 'both';
  /** Exact labels where the person sees it on screen (checked against the frontend). */
  labels: string[];
  page?: string;
  guides?: string[];
};

export type HowToError = {
  id: string;
  module: string;
  /** A fragment of the real backend / screen message (checked against functions/ and the frontend). */
  match: string;
  meaning: string;
  cause: string;
  fix: string;
  keywords?: string[];
};
