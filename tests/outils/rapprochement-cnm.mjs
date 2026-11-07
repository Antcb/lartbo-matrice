#!/usr/bin/env node
/*
 * Rapprochement CNM des coréalisations — LECTURE SEULE (précisions d'Anthony du 07/11/2026).
 *
 * Usage (depuis le dossier tests/, après `npm ci`) :
 *   node outils/rapprochement-cnm.mjs extrait.json [sortie.csv]
 *
 * extrait.json : un objet { "table": [lignes…] } exporté de la base (aucun secret n'y est nécessaire). Tables lues :
 *   shows, budget_lines, show_payments, commission_transfers, projects, structures, settings, partners — toutes les colonnes de
 *   préférence (les calculs sont ceux de l'application). Colonnes réellement lues :
 *   shows : id, project_id, date, venue, status, contract_type, prod_mode, fee_ht, artbo_pct, partner_id, corea, corea_share,
 *           cnm_in_result, cnm_bearer, cnm_pct, ticket_holder, ticketing_type, department, structure_id, break_even,
 *           cr_producer_pct, capacity ;
 *   budget_lines : id, show_id, project_id, category, label, supplier, auto, qty, unit_cost, forecast, amount, payer, paid_at,
 *           reimbursed_at, sort, created_at ;
 *   show_payments : id, show_id, kind, label, pct, amount, hors_calcul, paid_at, sent_at, invoice_number, pennylane_id ;
 *   commission_transfers : id, payment_id, amount, transferred_at ; projects : id, name, mode, artist_payee, default_artbo_pct ;
 *   structures : id, country ; settings : key, value ; partners : id, name, default_pct.
 *
 * Fonctionnement : l'application elle-même (index.html, mêmes fonctions de calcul) est ouverte dans un Chromium sans écran, sur la
 * FAUSSE base des tests remplie avec l'extrait. Aucun accès réseau extérieur (tout est bloqué), aucune écriture ailleurs qu'en mémoire
 * (la fausse base n'envoie rien). Le serveur de fichiers local est ouvert sur un port libre choisi par le système (pas 4173).
 *
 * Sortie : une ligne par coréalisation où la CNM est concernée (case « déduite du résultat partagé », ligne CNM dans le budget, coût
 * attribué à L'ArtBo, ou ancienne ligne de facturation CNM), au format CSV (séparateur « ; », décimales à virgule) + un résumé.
 * « Calcul corrigé » = dépenses et reste artiste si la CNM n'était déduite qu'une fois (via le partage) — PROPOSITION à vérifier
 * contrat par contrat ; rien n'est modifié.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [input, output] = process.argv.slice(2);
if (!input){ console.error('Usage : node outils/rapprochement-cnm.mjs extrait.json [sortie.csv]'); process.exit(2); }
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MOCK = await readFile(new URL('../fixtures/mock-supabase.js', import.meta.url), 'utf8');
const data = JSON.parse(await readFile(input, 'utf8'));
const TABLES = ['shows', 'budget_lines', 'show_payments', 'commission_transfers', 'projects', 'structures', 'settings', 'partners'];
const seed = Object.fromEntries(TABLES.map(t => [t, Array.isArray(data[t]) ? data[t] : []]));
seed.app_users = [{ email: 'testeur@example.com', display_name: 'Outil de rapprochement' }];   // session de la fausse base

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
let rows = [], skipped = [];
try {
  const context = await browser.newContext();
  await context.routeWebSocket(/.*/, ws => ws.close());
  await context.route('**/*', route => {
    const u = route.request().url();
    if (/\/assets\/vendor\/supabase-js-[^/]+\/supabase\.js/.test(u)) return route.fulfill({ body: MOCK, contentType: 'text/javascript' });
    if (u.startsWith(BASE + '/')) return route.continue();
    return route.fulfill({ status: 204, body: '' });   // tout le reste : bloqué (aucun service réel)
  });
  const page = await context.newPage();
  await page.addInitScript(s => { window.__SEED_OVERRIDE = s; window.SharedWorker = function () { throw new Error('interdit'); }; }, seed);
  await page.goto(BASE + '/index.html');
  await page.waitForSelector('nav.tabs', { timeout: 30000 });
  ({ rows, skipped } = await page.evaluate(async () => {
    const b = await import('./js/budget.js'), c = await import('./js/corea.js'), br = await import('./js/break.js'), v = await import('./js/views/budget.js');
    const { S } = await import('./js/state.js'); const { byId } = await import('./js/selectors.js');
    const cnmPays = s => (S.db.show_payments || []).filter(p => p.show_id === s.id && p.kind === 'cnm');
    const concerned = s => s.cnm_in_result || b.linesOf(s.id).some(c.isCnmLine) || c.cnmBearer(s) === 'artbo' || cnmPays(s).length;
    const coreas = S.db.shows.filter(s => c.isCorea(s) && concerned(s));
    const out = [];
    for (const s of coreas.filter(x => x.prod_mode !== 'booking')){
      const p = byId('projects', s.project_id), k = c.coreaCalc(s), cn = c.cnmOf(s), bud = b.showBudget(s), ar = v.artistResult(s, bud);
      const lines = b.linesOf(s.id).filter(c.isCnmLine), twice = lines.filter(b.cnmViaShare);
      const cnmAsExpense = Math.round(twice.reduce((a, l) => a + b.lineValue(l), 0) * 100) / 100;
      const paid = lines.filter(l => l.paid_at);
      const payer = paid.length ? paid.map(l => `${b.payerLabel(l.payer || 'compte', p)} le ${l.paid_at}${l.amount != null ? ' (' + l.amount + ')' : ''}`).join(' + ') : 'à préciser';
      const reimb = [...lines.filter(l => l.reimbursed_at).map(l => `remboursé le ${l.reimbursed_at}`),
        ...cnmPays(s).map(x => `ligne de facture CNM ${x.amount ?? 'montant calculé'}${x.paid_at ? ' payée le ' + x.paid_at : ' non payée'}`)].join(' + ') || '—';
      const kb = br.coreaBreaks(s);
      out.push({ date: s.date, artiste: p?.name || '', lieu: s.venue || '', statut: s.status || '',
        recette_ht: k.ht, cnm: cn.amount, cnm_reelle_saisie: cn.real, deduite_du_partage: s.cnm_in_result ? 'oui' : 'non',
        cout_supporte_par: s.cnm_bearer || (c.cnmBearer(s) ? c.cnmBearer(s) + ' (usage)' : 'à attribuer'), redevable_legal: cn.debtor || 'à renseigner',
        payeur_effectif: payer, remboursement: reimb, part_producteur_calculee: k.share, part_producteur_validee: k.validatedShare,
        commission: b.commissionAmount(s), depenses_actuel: bud.expenses, dont_cnm_en_depense: cnmAsExpense,
        reste_artiste_actuel: b.availableForArtist(s), solde_verse: ar.hasVerse ? 'oui' : 'non', solde_verse_montant: ar.verse,
        double_deduction: s.cnm_in_result && cnmAsExpense ? 'oui' : 'non',
        depenses_corrige: Math.round((bud.expenses - cnmAsExpense) * 100) / 100, reste_artiste_corrige: Math.round((b.availableForArtist(s) + cnmAsExpense) * 100) / 100,
        ecart_reste: cnmAsExpense, ecart_apres_versement: ar.hasVerse ? Math.round((b.availableForArtist(s) + cnmAsExpense - ar.verse) * 100) / 100 : null,
        break_previsionnel: kb?.byScenario?.mix?.n ?? (kb?.missing || '—'), id: s.id });
    }
    return { rows: out.sort((a, z) => String(a.date).localeCompare(String(z.date))), skipped: coreas.filter(x => x.prod_mode === 'booking').map(x => `${x.date} ${x.venue || ''} (booking : pas de budget)`) };
  }));
} finally { await browser.close(); server.close(); }

const COLS = Object.keys(rows[0] || { date: 0 });
// texte commençant par = + - @ (ou tabulation / retour chariot) : préfixé d'une apostrophe, jamais interprété comme une formule par le
// tableur (relecture v1.60.3) ; les nombres restent des nombres
const safe = s => /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
const cell = v => v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : (s => /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)(safe(String(v)));
const csv = '﻿' + [COLS.join(';'), ...rows.map(r => COLS.map(k => cell(r[k])).join(';'))].join('\n') + '\n';
if (output) await writeFile(output, csv); else process.stdout.write(csv);
const dbl = rows.filter(r => r.double_deduction === 'oui');
console.error(`Coréalisations où la CNM est concernée : ${rows.length} · double déduction possible : ${dbl.length} (dont solde artiste déjà versé : ${dbl.filter(r => r.solde_verse === 'oui').length}) · payeur effectif à préciser : ${rows.filter(r => r.payeur_effectif === 'à préciser').length}`);
if (skipped.length) console.error(`Non traitées (booking, sans budget) : ${skipped.join(' ; ')}`);
console.error('Lecture seule : aucune donnée modifiée, aucun service contacté.');
