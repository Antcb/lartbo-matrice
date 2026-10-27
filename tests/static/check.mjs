// Contrôles sans navigateur (quelques secondes) :
//  1. syntaxe de chaque fichier JavaScript (analyse par acorn) ;
//  2. chaque nom importé existe bien dans le module visé ;
//  3. carte d'import (index.html) complète et à la version de js/config.js ;
//  4. le nombre de fenêtres natives (alert / confirm / prompt) n'augmente pas (référence : baselines/fenetres-natives.json) ;
//  5. aucun secret écrit dans les fichiers du dépôt (tous les fichiers suivis par Git, tests compris) ;
//  6. aucune bibliothèque chargée depuis un service tiers ;
//  7. aucun accès direct au stockage du navigateur hors js/storage.js et js/config.js (séparation production / test) ;
//  8. politique de sécurité (CSP, v1.47) sur chaque page, empreinte de la carte d'import à jour, aucun gestionnaire d'événement en ligne
//     (onclick=… dans les pages ou les gabarits du code), aucun secret de la table settings lu par le navigateur.
// Usage : node static/check.mjs            (contrôle)
//         node static/check.mjs --baseline (réécrit la référence des fenêtres natives, seulement si leur nombre a BAISSÉ)
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { parse, tokenizer } from 'acorn';
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

// 1. Syntaxe et 2. imports : analyse réelle du code (acorn), pas d'expressions régulières
const parsed = new Map();
for (const f of JS) {
  try { parsed.set(resolve(f), { ast: parse(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }), src: readFileSync(f, 'utf8') }); }
  catch (e) { fail('syntaxe', `${rel(f)} : ${e.message}`); }
}
const exportsOf = new Map();
const namesExported = (file, seen = new Set()) => {
  if (exportsOf.has(file)) return exportsOf.get(file);
  if (seen.has(file)) return new Set(); seen.add(file);
  const out = new Set(), m = parsed.get(file);
  if (!m) return out;
  for (const n of m.ast.body) {
    if (n.type === 'ExportNamedDeclaration') {
      if (n.declaration?.id) out.add(n.declaration.id.name);
      n.declaration?.declarations?.forEach(d => d.id.type === 'Identifier' && out.add(d.id.name));
      n.specifiers.forEach(s => out.add(s.exported.name ?? s.exported.value));
    }
    if (n.type === 'ExportDefaultDeclaration') out.add('default');
    if (n.type === 'ExportAllDeclaration') {
      if (n.exported) out.add(n.exported.name);
      else namesExported(resolve(dirname(file), n.source.value.replace(/\?.*$/, '')), seen).forEach(x => x !== 'default' && out.add(x));
    }
  }
  exportsOf.set(file, out); return out;
};
for (const [file, { ast }] of parsed) {
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration' || !/^\.{1,2}\//.test(n.source.value)) continue;
    const target = resolve(dirname(file), n.source.value.replace(/\?.*$/, ''));
    if (!/\.js$/.test(target) || !target.startsWith(join(ROOT, 'js'))) continue;   // bibliothèques copiées (assets/vendor) : hors contrôle
    if (!parsed.has(target)) { fail('imports', `${rel(file)} importe un fichier introuvable : ${n.source.value}`); continue; }
    const ex = namesExported(target);
    for (const s of n.specifiers) {
      const name = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value) : null;
      if (name && !ex.has(name)) fail('imports', `${rel(file)} importe « ${name} » que ${rel(target)} n'exporte pas`);
    }
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
// Comptage sur les jetons du code (chaînes, gabarits et commentaires ignorés) : alert( / window.confirm( / self['prompt'](…
const NATIVE = new Set(['alert', 'confirm', 'prompt']), GLOBAL = new Set(['window', 'globalThis', 'self', 'top', 'parent']);
const countNative = src => {
  const tk = [...tokenizer(src, { ecmaVersion: 'latest', sourceType: 'module' })];
  let n = 0;
  for (let i = 0; i < tk.length; i++) {
    const t0 = tk[i], next = tk[i + 1], prev = tk[i - 1], prev2 = tk[i - 2];
    const isName = t0.type.label === 'name' && NATIVE.has(t0.value);
    if (isName && next?.type.label === '(' && (prev?.type.label !== '.' || (prev2?.type.label === 'name' && GLOBAL.has(prev2.value)))) n++;
    // window['confirm'](…) / window["alert"](…)
    if (t0.type.label === 'string' && NATIVE.has(t0.value) && prev?.type.label === '[' && prev2?.type.label === 'name' && GLOBAL.has(prev2.value)
        && tk[i + 1]?.type.label === ']' && tk[i + 2]?.type.label === '(') n++;
  }
  return n;
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
let files;
try { files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).map(f => join(ROOT, f)); }
catch { files = walk(ROOT, () => true); }
const scanned = files.filter(p => { try { const s = statSync(p); return s.isFile() && s.size < 2_000_000 && !/\.(png|jpe?g|gif|ico|pdf|woff2?|zip|gz)$/i.test(p); } catch { return false; } });
for (const f of scanned) {
  const src = readFileSync(f, 'utf8');
  for (const [re, label] of SECRET) if (re.test(src)) fail('secrets', `${rel(f)} contient ce qui ressemble à une ${label} (valeur non affichée)`);
}

// 6. Bibliothèques : aucun script chargé depuis un service tiers (copies locales vérifiées dans assets/vendor, lot S9)
const EXT_SCRIPT_HTML = /<script[^>]+src=["']\s*(?:https?:)?\/\//i;
const EXT_STYLE_HTML = /<link(?=[^>]*rel=["']?stylesheet)[^>]*href=["']?\s*(?:https?:)?\/\/(?!fonts\.googleapis\.com\/)/i;
const EXT_IMPORT_HTML = /<script[^>]*>[^<]*\bimport\b[^<]*["'`]\s*(?:https?:)?\/\//i;
const EXT_SCRIPT_JS = /(?:\.src\s*=|import\s*\(|importScripts\s*\(|setAttribute\(\s*["']src["']\s*,|\bfrom|^\s*import)\s*["'`]\s*(?:https?:)?\/\//im;
for (const page of ['index.html', 'fiche.html', 'rh.html', 'artiste.html']) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  if (EXT_SCRIPT_HTML.test(html)) fail('bibliothèques', `${page} charge un script depuis un service tiers (utiliser assets/vendor)`);
  if (EXT_STYLE_HTML.test(html)) fail('bibliothèques', `${page} charge une feuille de style depuis un service tiers (seules les polices Google sont admises)`);
  if (EXT_IMPORT_HTML.test(html)) fail('bibliothèques', `${page} importe un module depuis un service tiers (utiliser assets/vendor)`);
}
for (const f of JS) if (EXT_SCRIPT_JS.test(readFileSync(f, 'utf8'))) fail('bibliothèques', `${rel(f)} charge un script depuis un service tiers (utiliser assets/vendor)`);

// 7. Stockage du navigateur (lot S0-R8) : production et test ne doivent jamais partager de données gardées dans le navigateur.
// Seuls js/storage.js (clés séparées par environnement) et js/config.js (clé artbo.env) y accèdent directement.
// Analyse des jetons du code (commentaires et textes ignorés), plus les scripts écrits dans les pages HTML.
// Aussi : cookies, Cache API, navigator.storage, et les noms écrits dans un texte ou un gabarit (window[`localStorage`]).
// Exception connue, hors js/ : la bibliothèque Supabase (assets/vendor) range la session sous une clé propre à chaque projet.
const STORE = new Set(['localStorage', 'sessionStorage', 'indexedDB', 'caches']), STORE_OK = new Set(['js/storage.js', 'js/config.js']);
const STORE_TXT = /\b(localStorage|sessionStorage|indexedDB)\b/;
const storeUses = src => {
  const tk = [...tokenizer(src, { ecmaVersion: 'latest', sourceType: 'module' })];
  return tk.filter((t, i) => (t.type.label === 'name' && STORE.has(t.value) && !(t.value === 'caches' && tk[i - 1]?.type.label === '.'))
    || ((t.type.label === 'string' || t.type.label === 'template') && STORE_TXT.test(t.value))
    || (t.type.label === 'name' && ((t.value === 'cookie' && tk[i - 2]?.value === 'document') || (t.value === 'storage' && tk[i - 2]?.value === 'navigator')) && tk[i - 1]?.type.label === '.')).length;
};
for (const f of JS) if (!STORE_OK.has(rel(f)) && storeUses(readFileSync(f, 'utf8')))
  fail('stockage', `${rel(f)} accède directement au stockage du navigateur : passer par js/storage.js (séparation production / test)`);
for (const page of readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type=["']importmap)[^>]*>([\s\S]*?)<\/script>/gi))
    if (/\b(localStorage|sessionStorage|indexedDB)\b/.test(m[1])) fail('stockage', `${page} : un script de la page accède directement au stockage du navigateur (passer par js/storage.js)`);
  if (/\son\w+\s*=\s*["'][^"']*\b(localStorage|sessionStorage|indexedDB)\b/i.test(html)) fail('stockage', `${page} : un attribut d'événement accède au stockage du navigateur`);
}

// 8. Politique de sécurité (lot Sécurité v1.47) : la CSP interdit les scripts en ligne sauf la carte d'import (empreinte) ;
// un gestionnaire en ligne (onclick=, onsubmit=…) serait bloqué en production — il doit passer par addEventListener.
const { createHash } = await import('node:crypto');
for (const page of readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  if (!csp) { fail('sécurité', `${page} : politique de sécurité (CSP) absente — lancer tools/bump_version.py`); continue; }
  const im = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  if (im != null && !csp.includes(`'sha256-${createHash('sha256').update(im, 'utf8').digest('base64')}'`)) fail('sécurité', `${page} : empreinte de la carte d'import absente de la CSP — lancer tools/bump_version.py`);
  if (/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp)) fail('sécurité', `${page} : la CSP autorise des scripts en ligne ou eval`);
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) fail('sécurité', `${page} : gestionnaire d'événement en ligne (on…=) interdit par la CSP`);
}
for (const f of JS) {
  const src = readFileSync(f, 'utf8');
  if (/<[a-z][^>`]*\son(click|submit|change|input|load|error|keydown|keyup|focus|blur|mouse\w+)\s*=\s*["']/i.test(src)) fail('sécurité', `${rel(f)} : gestionnaire d'événement en ligne dans un gabarit (interdit par la CSP)`);
  if (/setting\(\s*['"](brevo_api_key|brevo_hook_secret|drive_webhook_secret)['"]/.test(src)) fail('sécurité', `${rel(f)} : lecture d'un secret de la table settings par le navigateur (illisible depuis la v1.47)`);
}

// 9. Dates et formats (lot v1.49, CONVENTIONS §1.2, §1.6, §2.2–2.4) : aucune « date du jour » en UTC, aucun jour coupé dans un
// horodatage, aucune copie des fonctions officielles (ajout de jours, arrondi), aucun montant ou pourcentage formaté à la main
for (const f of JS.filter(p => !p.endsWith('js/utils.js'))) {
  const src = readFileSync(f, 'utf8');
  if (/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(src)) fail('dates', `${rel(f)} : date du jour en UTC (utiliser today())`);
  if (/_at\??\.slice\(0,\s*10\)|created_at\s*\|\|\s*''\)\.slice\(0,\s*10\)/.test(src)) fail('dates', `${rel(f)} : jour coupé dans un horodatage (utiliser dayOf() ou fmtDate(horodatage))`);
  if (/const\s+(r2|addDays|addD|inDays|plusDays)\s*=\s*\(?[\w,\s]*\)?\s*=>\s*\{?\s*(Math\.round|const x = new Date)/.test(src)) fail('formats', `${rel(f)} : copie d'une fonction officielle (r2, addDays dans js/utils.js)`);
  if (/new Date\([^)]*\)\.toLocaleDateString\(\s*['"](sv-SE|fr-FR)['"]\s*\)/.test(src)) fail('dates', `${rel(f)} : date du jour ou d'un horodatage selon le fuseau de l'ordinateur (utiliser today() / fmtDate())`);
  if (/\$\{(?![^}]*\b(pin|cIn)\()[^}]*\}\s%/.test(src) && !/utils\.js$/.test(f)) fail('formats', `${rel(f)} : pourcentage formaté à la main (utiliser pct() ; seule l'unité après une case de saisie reste « % »)`);
  if (/toLocaleString\(\s*['"]fr-FR['"]\s*,\s*\{\s*style:\s*['"]currency/.test(src)) fail('formats', `${rel(f)} : montant formaté à la main (utiliser eur2 / eur)`);
}

// Bilan
console.log(`Contrôles statiques : ${JS.length} modules, version ${version}, ${total(now)} fenêtre(s) native(s) tolérée(s), ${scanned.length} fichiers examinés pour les secrets.`);
if (problems.length) { console.error(`\n${problems.length} problème(s) :\n` + problems.map(p => ' - ' + p).join('\n')); process.exit(1); }
console.log('✓ Aucun problème.');
