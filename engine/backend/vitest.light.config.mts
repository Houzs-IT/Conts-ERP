import path from "node:path";
import { defineConfig } from "vitest/config";
import { classifyTests } from "./scripts/lib/classify-tests.mjs";

// The ratcheted areas, from the ONE list scripts/coverage-ratchet.mjs also
// reads, so what vitest instruments and what the gate audits cannot drift.
import { includeGlobsFor } from "../scripts/coverage-areas.mjs";

// The backend's pure-logic suite, on a plain node runner.
//
// These are the same tests that used to run inside the Workers pool. Nothing
// about them changed — they simply never referenced `cloudflare:test` or a D1
// binding, so the workerd instance and isolated database booted for each of
// them was doing no work. `vitest.config.mts` runs files one at a time
// (the pool collapses above that), so that startup was serial and it
// dominated everything: the full suite measured 2026-08-13 at
// `565s, of which setup is 490s and the tests themselves are 10.9s`.
//
// The same 221 files here: **6.09s, 3433 tests, green.**
//
// Membership is computed from the source tree every run — see
// scripts/lib/classify-tests.mjs for why this is not a committed list.
//
// No setupFiles: the schema snapshot exists to give a test a database, and by
// construction nothing in this project has one.
// Conts: whole files skipped because they need Houzs-only data, docs or CI that
// were never copied (engine/backend/scripts/data was removed by design; no
// AutoCount and no engine CI in Conts). One line each: the missing input.
const HOUZS_ONLY = [
  "tests/acChainLineGrain.test.mjs", // AutoCount snapshot scripts/data/ac-reconcile-truth.json.gz
  "tests/acMasterMatcher.test.mjs", // AutoCount mappings scripts/data/autocount-so-writeback-mappings.json
  "tests/acPoLineRepair.test.mjs", // AutoCount snapshot scripts/data/ac-outstanding-po.json.gz
  "tests/autocountSyncReasonsCatalogue.test.ts", // Houzs doc docs/autocount-sync-reasons.md
  "tests/doTopupTargets.test.mjs", // AutoCount snapshot scripts/data/ac-reconcile-truth.json.gz
  "tests/itemCodeClass.test.mjs", // AutoCount mapping scripts/data/autocount-erp-mapping-1561.csv
  "tests/truncatedCodeMergePlan.test.mjs", // AutoCount mapping scripts/data/autocount-erp-mapping-1561.csv
  "tests/parseBedframeHydraulic.test.ts", // Houzs phrase map scripts/data/special-order-phrase-map.json
  "tests/parseSofaGrammar.test.ts", // Houzs phrase map scripts/data/special-order-phrase-map.json
  "tests/sofaDecodeBaseline.test.ts", // Houzs account book scripts/data/ac-fidelity-so-lines.json.gz
  "tests/pbbAdviceFixture.test.mjs", // Houzs bank statement fixture demo-statements/PBB-IBG-advice-Jun.pdf
  "tests/companyDivergenceGate.test.ts", // Houzs gate allowlist scripts/data/company-divergence-allowlist.json + ci.yml
  "tests/dateFormatGate.test.ts", // Houzs gate allowlist scripts/data/date-format-allowlist.json + ci.yml
  "tests/duplicatedDecisionGate.test.ts", // Houzs gate allowlist scripts/data/duplicated-decision-allowlist.json + ci.yml
  "tests/emptyStateClaimGate.test.ts", // Houzs gate allowlist scripts/data/empty-state-claim-allowlist.json + ci.yml
];

export default defineConfig(async () => {
  const testProjects = await classifyTests(__dirname);

  return {
    // Vitest does not read tsconfig "paths"; the alias has to be repeated here
    // for the same reason vitest.config.mts repeats it.
    resolve: {
      alias: { "@shared": path.resolve(__dirname, "../shared") },
    },
    test: {
      globals: true,
      environment: "node",
      include: testProjects.light,
      exclude: [...HOUZS_ONLY, "**/node_modules/**"],
      // ISTANBUL even though this project runs on plain node and v8 would be
      // cheaper here. The two backend projects' reports are MERGED, and a merge
      // is only meaningful when both sides describe the same statements — v8 and
      // istanbul derive different statement maps for the same file, so mixing
      // them would either double-count a file both projects touch or make the
      // ratchet's shape check reject the pair outright. One provider per merged
      // set. (The frontend is v8 and is never merged with these.)
      coverage: {
        provider: "istanbul",
        all: true,
        include: includeGlobsFor("backend", "backend"),
        reporter: ["text-summary", "json"],
        reportsDirectory: "./coverage/light",
      },
    },
  };
});
