// Property OS (src/, functions/, worker/) imports a few engine modules so one rule has one copy. A push that only touches
// such a module must still typecheck and redeploy Property OS, or the two builds drift apart without anyone noticing:
// the deploy and CI workflows watch fixed path lists, and CI skips engine/ altogether. So every engine file imported from
// outside the engine must be named in each of those workflows.
import { runCheck, runIfMain, walk, read, stripComments } from './_lib.mjs';

const WORKFLOWS = ['ci', 'deploy-property-os', 'deploy-staging-preview', 'deploy-cron'].map(n => `.github/workflows/${n}.yml`);
const ENGINE_IMPORT = /from\s+['"](?:\.\.\/)+(engine\/[^'"]+)['"]/g;

/** The engine files a piece of source imports, as repo paths. */
const engineImports = (text) => [...stripComments(text).matchAll(ENGINE_IMPORT)].map(m => (/\.tsx?$/.test(m[1]) ? m[1] : `${m[1]}.ts`));

export const def = {
  name: 'shared-paths',
  rule: 'an engine file imported by Property OS is watched by CI and every deploy workflow',
  files: () => [...walk('src'), ...walk('functions'), ...walk('worker')],
  scan(text, path, workflows = WORKFLOWS.map(w => [w, read(w)])) {
    const hits = [];
    for (const file of engineImports(text)) {
      for (const [name, body] of workflows) {
        if (!body.includes(`'${file}'`)) hits.push({ line: 0, msg: `imports ${file}, which ${name} does not watch: add it, or a change there will not reach Property OS` });
      }
    }
    return hits;
  },
  selfTest: {
    bad: [{ path: 'src/lib/x.ts', text: "import { y } from '../../engine/frontend/src/vendor/shared/not-watched';" }],
    good: [{ path: 'src/lib/x.ts', text: "import { fmtDate } from '../../engine/frontend/src/vendor/shared/format';\n// from '../../engine/in-a-comment' is fine" }],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
