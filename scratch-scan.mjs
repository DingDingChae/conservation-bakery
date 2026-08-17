import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'packages/app/src/renderer';

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT, []);
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/;
const used = new Map();

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const callRe = /\b(?:t|translate)\(/g;
  let m;
  while ((m = callRe.exec(src))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    let inStr = null;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (inStr) {
        if (c === '\\') { i += 2; continue; }
        if (c === inStr) inStr = null;
      } else {
        if (c === "'" || c === '"' || c === '`') inStr = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
      }
      i++;
    }
    const argsSubstr = src.slice(start, i - 1);
    const strRe = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    let sm;
    while ((sm = strRe.exec(argsSubstr))) {
      const val = sm[1] !== undefined ? sm[1] : sm[2];
      if (KEY_PATTERN.test(val)) {
        if (!used.has(val)) used.set(val, new Set());
        used.get(val).add(file);
      }
    }
  }
}

console.log('Total distinct keys used:', used.size);

const catSrc = fs.readFileSync('packages/app/src/renderer/i18n/catalogue.ts', 'utf8');
const keysBlockMatch = catSrc.match(/export const CATALOGUE_KEYS = \[([\s\S]*?)\] as const;/);
const definedKeys = new Set([...keysBlockMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

const missing = [...used.keys()].filter((k) => !definedKeys.has(k)).sort();
console.log('Missing (used but not defined):', missing.length);
console.log(JSON.stringify(missing, null, 2));

const unused = [...definedKeys].filter((k) => !used.has(k)).sort();
console.log('Defined but never used by this scan:', unused.length);
console.log(JSON.stringify(unused, null, 2));

