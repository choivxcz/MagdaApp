// Lists every English phrase the app translates (every t('...') in src/),
// and which are still missing from a language.
//
// Usage: node scripts/i18n-keys.mjs            (counts)
//        node scripts/i18n-keys.mjs --missing tl  (the missing Tagalog ones)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Admin pages stay in English; the AI's own replies pick their language themselves.
const SKIP = /AdminScreen|AdminMfa|i18n[\\/]|assistant[\\/]/;
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(f) && !SKIP.test(p) ? [p] : [];
  });
}

export function collectKeys(root = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')) {
  const keys = new Set();
  const re = /\bt\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      const raw = m[1] ?? m[2];
      keys.add(m[1] != null ? raw.replace(/\\'/g, "'") : JSON.parse(`"${raw}"`));
    }
  }
  return [...keys].sort();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('i18n-keys.mjs')) {
  const keys = collectKeys();
  const i = process.argv.indexOf('--missing');
  if (i > 0) {
    const lang = process.argv[i + 1];
    const dict = (await import(`../src/lib/i18n/${lang}.js`)).default;
    const missing = keys.filter((k) => !dict[k]);
    console.log(JSON.stringify(missing, null, 1));
    console.error(`${missing.length} of ${keys.length} missing in ${lang}`);
  } else {
    console.log(`${keys.length} phrases`);
  }
}
