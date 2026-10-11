// The icons the app can draw by name (<Icon name="..." />, menu entries, status options). Icon used to import
// lucide-react whole, which put all ~1,500 icons (771 KB of the 1,265 KB first download) in the bundle every
// page loads. This scans the source for string literals that are lucide icon names (PascalCase as written, or
// kebab-case as navigation.ts stores them) and exports only those, so names held in data still resolve.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const toPascal = (kebab) => kebab.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('');

function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mjs|js)$/.test(n) ? [p] : [];
  });
}

/** Lucide export names that appear as string literals anywhere under `srcDir`, sorted. */
export function usedIconNames(srcDir, lucideNames) {
  const known = new Set(lucideNames);
  const used = new Set();
  for (const f of walk(srcDir)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/['"`]([A-Za-z][A-Za-z0-9-]*)['"`]/g)) {
      const s = m[1];
      if (known.has(s)) used.add(s);
      if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) { const p = toPascal(s); if (known.has(p)) used.add(p); }
    }
  }
  return [...used].sort();
}

/** Vite plugin: `import icons from 'virtual:used-icons'` gives { Name: Component } for the names found. */
export function usedIconsPlugin(srcDir) {
  const ID = 'virtual:used-icons', RESOLVED = '\0' + ID;
  return {
    name: 'used-icons',
    resolveId: id => (id === ID ? RESOLVED : null),
    async load(id) {
      if (id !== RESOLVED) return null;
      const lucide = await import('lucide-react');
      const names = usedIconNames(srcDir, Object.keys(lucide).filter(k => /^[A-Z]/.test(k) && !k.endsWith('Icon') && k !== 'Icon' && !k.startsWith('Lucide')));
      return `import { ${names.join(', ')} } from 'lucide-react';\nexport default { ${names.join(', ')} };\n`;
    },
  };
}
