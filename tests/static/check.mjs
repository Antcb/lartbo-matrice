// Contrôles sans navigateur (quelques secondes) :
//  1. syntaxe de chaque fichier JavaScript ;
//  2. chaque nom importé existe bien dans le module visé ;
//  3. carte d'import (index.html) complète et à la version de js/config.js ;
//  4. le nombre de fenêtres natives (alert / confirm / prompt) n'augmente pas (référence : baselines/fenetres-natives.json) ;
//  5. aucun secret écrit dans les fichiers du dépôt.
// Usage : node static/check.mjs            (contrôle)
//         node static/check.mjs --baseline (réécrit la référence des fenêtres natives, seulement si leur nombre a BAISSÉ)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const BASELINE = fileURLToPath(new URL('../baselines/fenetres-natives.json', import.meta.url));
const rel = p => relative(ROOT, p).split('\\').join('/');
const walk = (d, ok) => readdirSync(d).flatMap(f => {
  if (['node_modules', '.git', 'test-results', 'playwright-report'].includes(f)) return [];
  const p = join(d, f); return statSync(p).isDirectory() ? walk(p, ok) : ok(p) ? [p] : [];
});
const JS = walk(join(ROOT, 'js'), p => p.endsWith('.js')).sort();
const problems = [];
const fail = (cat, msg) => problems.push(`[${cat}] ${msg}`);

// 1. Syntaxe (chaque fichier est vérifié comme module ES par Node)
const tmp = mkdtempSync(join(tmpdir(), 'matrice-'));
for (const f of JS) {
  const copy = join(tmp, rel(f).replace(/\//g, '__') + '.mjs');
  writeFileSync(copy, readFileSync(f));
  try { execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' }); }
  catch (e) { fail('syntaxe', `${rel(f)} : ${String(e.stderr).split('\n').find(l => /Error/.test(l)) || 'erreur'}`); }
}
rmSync(tmp, { recursive: true, force: true });

// 2. Imports nommés présents dans le module visé
const exportsOf = new Map();
const namesExported = src => {
  const out = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean).forEach(n => out.add(n));
  if (/export\s+default\b/.test(src)) out.add('default');
  return out;
};
for (const f of JS) exportsOf.set(resolve(f), namesExported(readFileSync(f, 'utf8')));
for (const f of JS) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = resolve(dirname(f), m[2].replace(/\?.*$/, ''));
    const ex = exportsOf.get(target);
    if (!ex) { fail('imports', `${rel(f)} importe un fichier introuvable : ${m[2]}`); continue; }
    for (const n of m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean))
      if (!ex.has(n)) fail('imports', `${rel(f)} importe « ${n} » que ${rel(target)} n'exporte pas`);
  }
}

// 3. Carte d'import et numéros de version
const version = readFileSync(join(ROOT, 'js/config.js'), 'utf8').match(/APP_VERSION = '([\d.]+)'/)?.[1];
const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
const map = JSON.parse(index.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
for (const f of JS) {
  const k = './' + rel(f);
  if (map[k] !== `${k}?v=${version}`) fail('version', `${k} absent de la carte d'import ou pas à la version ${version} (lancer tools/bump_version.py)`);
}
for (const k of Object.keys(map)) if (!JS.some(f => './' + rel(f) === k)) fail('version', `la carte d'import cite un fichier inexistant : ${k}`);
for (const page of ['index.html', 'fiche.html', 'rh.html', 'artiste.html']) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)\?v=([^"]+)"/g))
    if (m[2] !== version) fail('version', `${page} : ${m[1]} en version ${m[2]} au lieu de ${version}`);
}

// 4. Fenêtres natives : interdites (CONVENTIONS §4.5). Le nombre actuel est toléré, il ne doit jamais augmenter.
const countNative = src => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  return (code.match(/(?<![\w$.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/g) || []).length;
};
const now = {};
for (const f of JS) { const n = countNative(readFileSync(f, 'utf8')); if (n) now[rel(f)] = n; }
const total = o => Object.values(o).reduce((a, b) => a + b, 0);
let base = {};
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')).fichiers || {}; } catch { fail('fenêtres', `référence absente : ${rel(BASELINE)}`); }
if (process.argv.includes('--baseline')) {
  const up = Object.entries(now).filter(([f, n]) => n > (base[f] || 0));
  if (up.length && Object.keys(base).length) { console.error('Refus : le nombre de fenêtres natives a augmenté dans ' + up.map(([f]) => f).join(', ')); process.exit(1); }
  writeFileSync(BASELINE, JSON.stringify({ commentaire: 'Fenêtres natives encore présentes (à remplacer, lot B12). Ce nombre ne doit jamais augmenter.', total: total(now), fichiers: now }, null, 2) + '\n');
  console.log(`Référence enregistrée : ${total(now)} fenêtre(s) native(s).`); process.exit(0);
}
for (const [f, n] of Object.entries(now)) if (n > (base[f] || 0)) fail('fenêtres', `${f} : ${n} fenêtre(s) native(s) au lieu de ${base[f] || 0} au plus — utiliser la fenêtre de l'application`);
if (total(now) < total(base)) console.log(`ℹ Fenêtres natives : ${total(now)} (référence ${total(base)}). Mettre à jour la référence : node static/check.mjs --baseline`);

// 5. Secrets : motifs de clés connues dans les fichiers suivis (hors tests et dépendances)
const SECRET = [
  [/xkeysib-[0-9a-f]{20,}/i, 'clé API Brevo'],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'clé secrète Supabase'],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/, 'clé service_role Supabase'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'],
  [/\bghp_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}/, 'jeton GitHub'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'clé Anthropic'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'clé Google'],
];
const scanned = walk(ROOT, p => /\.(js|mjs|gs|ts|html|json|md|sql|py|yml|yaml|txt|css)$/.test(p) && !rel(p).startsWith('tests/'));
for (const f of scanned) {
  const src = readFileSync(f, 'utf8');
  for (const [re, label] of SECRET) if (re.test(src)) fail('secrets', `${rel(f)} contient ce qui ressemble à une ${label} (valeur non affichée)`);
}

// Bilan
console.log(`Contrôles statiques : ${JS.length} modules, version ${version}, ${total(now)} fenêtre(s) native(s) tolérée(s), ${scanned.length} fichiers examinés pour les secrets.`);
if (problems.length) { console.error(`\n${problems.length} problème(s) :\n` + problems.map(p => ' - ' + p).join('\n')); process.exit(1); }
console.log('✓ Aucun problème.');
