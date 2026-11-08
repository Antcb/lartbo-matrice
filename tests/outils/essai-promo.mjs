#!/usr/bin/env node
/*
 * Essai « ESSAI promo » (v1.60.4, décision d'Anthony du 08/11/2026) — HORS PRODUCTION, LECTURE SEULE.
 *
 * Usage (depuis le dossier tests/, après `npm ci`) :
 *   node outils/essai-promo.mjs extrait.json
 *
 * extrait.json : { "table": [lignes…] } des lignes RÉELLEMENT ENREGISTRÉES par supabase/repetitions/2026-11-08_v1.60.4_essai_promo_coproduction.sql
 * dans une base jetable (ou le projet de test), APRÈS ses déclencheurs : shows, budget_lines, show_payments, projects, partners,
 * structures, settings (tables lues par l'application ; seulement les identifiants e55a1000-… et les réglages, aucune donnée réelle).
 *
 * L'application elle-même (index.html, mêmes fonctions de calcul que l'écran) est ouverte dans un Chromium sans écran, sur la FAUSSE
 * base des tests remplie avec l'extrait : aucun accès réseau extérieur, rien n'est écrit (mémoire seulement). Port libre choisi par le
 * système (pas 4173). Pour chaque scénario : résultats ATTENDUS (calcul à la main, tableau en tête du script SQL) et OBTENUS, puis
 * le texte réellement affiché dans la clôture du budget (« Reversement »). Code de sortie 1 au moindre écart.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [input] = process.argv.slice(2);
if (!input){ console.error('Usage : node outils/essai-promo.mjs extrait.json'); process.exit(2); }
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MOCK = await readFile(new URL('../fixtures/mock-supabase.js', import.meta.url), 'utf8');
const data = JSON.parse(await readFile(input, 'utf8'));
const TABLES = ['shows', 'budget_lines', 'show_payments', 'projects', 'partners', 'structures', 'settings'];
const seed = Object.fromEntries(TABLES.map(t => [t, Array.isArray(data[t]) ? data[t] : []]));
seed.app_users = [{ email: 'testeur@example.com', display_name: 'Essai promo' }];

const ID = n => `e55a1000-0000-4000-a000-0000000000${n}`;
// ATTENDU — calcul à la main (en-tête de 2026-11-08_v1.60.4_essai_promo_coproduction.sql). Réel : 400 billets ; prévu : 500.
const EXPECT = {
  [ID(11)]: { cas: 'cas 1 — charge commune (supportée en commun, payée par L’ArtBo, billetterie chez le coproducteur)',
    prevu: { resultat_global: 4185, resultat_partage: 4185, part_artbo: 2092.5, part_coprod: 2092.5 },
    reel: { resultat_global: 2448, resultat_partage: 2448, part_artbo: 1224, part_coprod: 1224, promo: 772, avance_promo: 0,
      position_artbo: -2272, position_coprod: 4720, reversement: 3496, de: 'partenaire', vers: 'artbo' },
    breaks: { partage: 260, artbo: 260, global: 260 } },
  [ID(12)]: { cas: 'cas 2 — L’ArtBo seule (supportée par L’ArtBo, payée par le coproducteur, billetterie chez L’ArtBo)',
    prevu: { resultat_global: 4185, resultat_partage: 5150, part_artbo: 1610, part_coprod: 2575 },
    reel: { resultat_global: 2448, resultat_partage: 3220, part_artbo: 838, part_coprod: 1610, promo: 772, avance_promo: 772,
      position_artbo: 6220, position_coprod: -3772, reversement: 5382, de: 'artbo', vers: 'partenaire' },
    breaks: { partage: 234, artbo: 292, global: 260 } },
  [ID(13)]: { cas: 'cas 3 — coproducteur seul (supportée par le coproducteur, payée par L’ArtBo, billetterie chez le coproducteur)',
    prevu: { resultat_global: 4185, resultat_partage: 5150, part_artbo: 2575, part_coprod: 1610 },
    reel: { resultat_global: 2448, resultat_partage: 3220, part_artbo: 1610, part_coprod: 838, promo: 772, avance_promo: 772,
      position_artbo: -2272, position_coprod: 4720, reversement: 3882, de: 'partenaire', vers: 'artbo' },
    breaks: { partage: 234, artbo: 234, global: 260 } },
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(ROOT + sep) || req.method !== 'GET') { res.writeHead(403).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let got;
try {
  const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1440, height: 900 } });
  await context.routeWebSocket(/.*/, ws => ws.close());
  await context.route('**/*', route => {
    const u = route.request().url();
    if (/\/assets\/vendor\/supabase-js-[^/]+\/supabase\.js/.test(u)) return route.fulfill({ body: MOCK, contentType: 'text/javascript' });
    if (u.startsWith(BASE + '/')) return route.continue();
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(s => { window.__SEED_OVERRIDE = s; window.SharedWorker = function () { throw new Error('interdit'); }; }, seed);
  await page.goto(BASE + '/index.html');
  await page.waitForSelector('nav.tabs', { timeout: 30000 });
  got = await page.evaluate(async ids => {
    const { productionBudget, coprodClose } = await import('./js/production-budget.js'), { productionBreaks } = await import('./js/break.js');
    const { byId } = await import('./js/selectors.js'), { remindersOf } = await import('./js/reminders.js'), { paymentsOf } = await import('./js/calc.js');
    const { S, setProjects } = await import('./js/state.js'), app = await import('./js/app.js');
    const out = {};
    for (const id of ids){
      const s = byId('shows', id); if (!s){ out[id] = null; continue; }
      const f = productionBudget(s), k = coprodClose(s), x = k.snapshot, b = productionBreaks(s);
      const brk = key => [...new Set(Object.values(b.readings.find(r => r.key === key).byScenario).map(v => v.n))].join('/');
      // écran : budget de la date dans Production (artiste d'essai choisi)
      setProjects([s.project_id]); S.year = Number(s.date.slice(0, 4)); S.openProd.clear(); S.openProd.add(id); S.tab['prod:' + id] = 'budget'; app.go('production');
      const block = document.querySelector(`#prod-${id} .coprod-block`);
      out[id] = {
        supportee_par: s.production?.promo_debtor, payee_par: s.production?.promo_payer, billetterie_encaissee_par: s.ticket_holder,
        prevu: { resultat_global: f.resultDl, resultat_partage: f.shared, part_artbo: f.artbo, part_coprod: f.partner },
        reel: { resultat_global: x.result, resultat_partage: x.shared_result, part_artbo: x.artbo_part, part_coprod: x.partner_part, promo: x.promo,
          avance_promo: x.promo_advance, position_artbo: x.pos_artbo, position_coprod: x.pos_partner, reversement: x.transfer, de: x.from, vers: x.to },
        breaks: { partage: Number(brk('shared')), artbo: Number(brk('artbo')), global: Number(brk('global')) },
        cloture_possible: k.ok, provisoire: k.provisional, factures: paymentsOf(id).length, relances: remindersOf(s, { all: true }).length,
        ecran: block ? [...block.querySelectorAll('tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim()).filter(t => /Reversement|Part de|Résultat/.test(t)).join(' | ') : 'bloc de clôture absent' };
    }
    return out;
  }, Object.keys(EXPECT));
  if (errors.length) { console.error('Erreurs JavaScript : ' + errors.join(' ; ')); process.exitCode = 1; }
} finally { await browser.close(); server.close(); }

const eur = v => v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let bad = 0;
for (const [id, e] of Object.entries(EXPECT)){
  const g = got[id];
  console.log(`\n${e.cas}  [${id}]`);
  if (!g){ console.log('  ÉCART : date absente de l’extrait'); bad++; continue; }
  console.log(`  supportée par ${g.supportee_par} · payée par ${g.payee_par} · billetterie encaissée par ${g.billetterie_encaissee_par}`);
  for (const part of ['prevu', 'reel', 'breaks']) for (const [k, v] of Object.entries(e[part])){
    const o = g[part][k], ok = typeof v === 'number' ? Math.abs(Number(o) - v) < 0.005 : o === v;
    if (!ok) bad++;
    console.log(`  ${ok ? 'OK    ' : 'ÉCART '} ${part.padEnd(6)} ${k.padEnd(17)} attendu ${String(typeof v === 'number' && part !== 'breaks' ? eur(v) : v).padStart(10)} · obtenu ${String(typeof o === 'number' && part !== 'breaks' ? eur(o) : o).padStart(10)}`);
  }
  const sum = Math.round((g.reel.part_artbo + g.reel.part_coprod) * 100) / 100, sumP = Math.round((g.prevu.part_artbo + g.prevu.part_coprod) * 100) / 100;
  const noDouble = sum === g.reel.resultat_global && sumP === g.prevu.resultat_global;
  if (!noDouble) bad++;
  console.log(`  ${noDouble ? 'OK    ' : 'ÉCART '} pas de double déduction : parts ${eur(g.reel.part_artbo)} + ${eur(g.reel.part_coprod)} = ${eur(sum)} = résultat global (prévu : ${eur(sumP)})`);
  const iso = g.factures === 0 && g.relances === 0 && g.cloture_possible && !g.provisoire;
  if (!iso) bad++;
  console.log(`  ${iso ? 'OK    ' : 'ÉCART '} 0 ligne de facturation, 0 relance, clôture possible, reversement définitif`);
  console.log(`  écran : ${g.ecran}`);
}
console.log(`\n${bad ? `${bad} ÉCART(S)` : 'Aucun écart'} — lecture seule : aucune donnée modifiée, aucun service contacté.`);
process.exitCode = bad ? 1 : process.exitCode;
