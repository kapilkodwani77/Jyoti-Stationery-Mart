/**
 * Content lint — catches copy that should never reach a customer.
 *
 * The theme already has a safety net for *missing* content: fallback chains for
 * settings, and the editor-only `.bc-todo` chip for unset metafields. Neither
 * covers free-text copy that a human typed and left unfinished — which is how
 * "BabyCare is run from [city]." shipped, and how a mis-encoded "6.5 Õ 5 ft"
 * sat in a schema preset. Both are invisible to Liquid: they are perfectly
 * valid strings, just wrong ones.
 *
 * This closes that gap by reading the copy the way a customer would.
 *
 *   node scripts/lint-content.mjs
 *
 * Exits non-zero when it finds something, so it can gate a publish.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/* Non-ASCII this theme legitimately uses. Anything outside this set is far more
   likely to be a mis-decode than a deliberate choice, so it gets surfaced for a
   human rather than guessed at. Deliberate additions belong here. */
const ALLOWED_NON_ASCII = new Set([
  ...'—–…·×₹°™®“”‘’′″≈≤≥±',
]);

/* Unfinished-copy markers. Square brackets are the house style for a stub
   ("[city]"); the rest are the usual suspects from drafting. Angle brackets are
   deliberately not checked — FAQ answers contain real HTML. */
const STUBS = [
  { re: /\[[^\]\n]{1,40}\]/g, why: 'unresolved placeholder' },
  { re: /\b(TODO|TBD|FIXME|TK+|XXX)\b/g, why: 'draft marker' },
  { re: /\blorem ipsum\b/gi, why: 'filler text' },
];

const findings = [];

function walk(value, path, file) {
  if (typeof value === 'string') return checkString(value, path, file);
  if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`, file));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, file);
  }
}

function checkString(str, path, file) {
  for (const { re, why } of STUBS) {
    for (const m of str.matchAll(re)) {
      findings.push({ file, path, why, detail: m[0], line: lineOf(file, m[0]) });
    }
  }
  const bad = [...new Set([...str].filter((c) => c.charCodeAt(0) > 127 && !ALLOWED_NON_ASCII.has(c)))];
  for (const c of bad) {
    const hex = c.codePointAt(0).toString(16).padStart(4, '0');
    findings.push({
      file, path, why: 'suspect character',
      detail: `${c} (U+${hex.toUpperCase()}) in "${excerpt(str, c)}"`,
      line: lineOf(file, c),
    });
  }
}

/* Best-effort line number: the parsed value has no position, so find the raw
   text again in the source. Good enough to jump to; never load-bearing. */
function lineOf(file, needle) {
  const src = sources.get(file) || '';
  const idx = src.indexOf(needle);
  return idx === -1 ? null : src.slice(0, idx).split('\n').length;
}

function excerpt(str, char) {
  const i = str.indexOf(char);
  return str.slice(Math.max(0, i - 20), i + 20).replace(/\s+/g, ' ');
}

const sources = new Map();

function read(abs) {
  const rel = relative(ROOT, abs);
  const src = readFileSync(abs, 'utf8');
  sources.set(rel, src);
  return { rel, src };
}

/* Shopify JSON templates carry a leading /* *\/ banner that JSON.parse rejects. */
function parseJsonWithBanner(src, rel) {
  const stripped = src.replace(/^\s*\/\*[\s\S]*?\*\//, '');
  try {
    return JSON.parse(stripped);
  } catch (e) {
    findings.push({ file: rel, path: '(file)', why: 'invalid JSON', detail: e.message, line: 1 });
    return null;
  }
}

function filesIn(dir, ext) {
  try {
    return readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith(ext))
      .map((f) => join(ROOT, dir, f));
  } catch {
    return [];
  }
}

/* ---- JSON templates + theme settings: every string is shipped copy ---- */
for (const abs of [...filesIn('templates', '.json'), ...filesIn('config', '.json')]) {
  const { rel, src } = read(abs);
  const data = parseJsonWithBanner(src, rel);
  if (data) walk(data, '', rel);
}

/* ---- section schemas: defaults and presets become copy the moment a merchant
   adds the section or resets it, which is exactly how the Õ stayed hidden ---- */
for (const abs of filesIn('sections', '.liquid')) {
  const { rel, src } = read(abs);
  const m = src.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
  if (!m) continue;
  const data = parseJsonWithBanner(m[1], rel);
  if (data) walk(data, 'schema', rel);
}

/* ---- report ---- */
if (!findings.length) {
  console.log('content lint: clean');
  process.exit(0);
}

console.log(`content lint: ${findings.length} finding(s)\n`);
for (const f of findings) {
  console.log(`  ${f.file}${f.line ? ':' + f.line : ''}`);
  console.log(`    ${f.why}: ${f.detail}`);
  console.log(`    at ${f.path}\n`);
}
process.exit(1);
