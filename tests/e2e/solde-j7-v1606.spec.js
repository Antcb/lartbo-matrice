// v1.60.6 — Facture de solde : retour à J-7 (demande d'Anthony du 09/11/2026).
// « Facture à envoyer » d'une facture de SOLDE d'une date qui a un jour de concert : jamais avant le jour du rappel du solde
// (jour ouvré de J-7, soldeReminderDay) ; échéance = max(facture faite + 3 j décalé au lundi, J-7). Acomptes, autres lignes et
// date sans jour de concert : inchangés. Même règle côté serveur : supabase/migrations/2026-11-09_v1.60.6_solde_j7.sql.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const P = (id, extra = {}) => ({ id, project_id: 'art-a', venue: 'Salle ' + id, date: iso(23), status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 10000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15, ...extra });
// premier décalage n ≥ 30 tel que (aujourd'hui + n − 7) soit un samedi
const satOffset = () => { for (let n = 30; ; n++){ const d = new Date(); d.setDate(d.getDate() + n - 7); if (d.getDay() === 6) return n; } };

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push({ ...r }); S.db[table].push({ ...r }); } touch(table); }
  }, tables);
}
const send = (page, id) => page.evaluate(async i => {
  const r = await import('./js/reminders.js'), s = (await import('./js/selectors.js')).byId('shows', i);
  return r.remindersOf(s).filter(x => x.key === 'facture_envoi').map(x => [x.title, x.due, x.late]);
}, id);
const j7 = (page, d) => page.evaluate(async x => (await import('./js/reminders.js')).soldeReminderDay(x), d);

test('v1.60.6 solde fait tôt : « Facture à envoyer » au jour du rappel du solde (J-7), pas 3 jours après ; acompte inchangé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('j7-1')], show_payments: [
    { id: 'j7-1a', show_id: 'j7-1', kind: 'acompte', label: 'Acompte', pct: 30, invoice_number: 'F-A1', invoiced_on: iso(-4), sort: 1 },
    { id: 'j7-1s', show_id: 'j7-1', kind: 'solde', label: 'Solde', pct: 70, invoice_number: 'F-S1', invoiced_on: iso(-4), sort: 2 },
  ] });
  const r = await send(page, 'j7-1'), jour = await j7(page, iso(23));
  const so = r.find(x => x[0] === 'Facture à envoyer : Solde (F-S1)'), ac = r.find(x => x[0] === 'Facture à envoyer : Acompte (F-A1)');
  expect(so, 'rappel du solde présent').toBeTruthy();
  expect(so[1], 'échéance = jour ouvré de J-7').toBe(jour);
  expect(so[2], 'pas en retard avant J-7').toBe(false);
  expect(ac[2], 'acompte fait il y a 4 jours : en retard comme avant (3 jours)').toBe(true);
  expect(ac[1] < jour).toBe(true);
  // étapes « en retard » (rouge) : l'acompte oui, le solde non
  const late = await page.evaluate(async () => [...(await import('./js/reminders.js')).lateSteps((await import('./js/selectors.js')).byId('shows', 'j7-1'))]);
  expect(late).toContain('acompte');
  expect(late).not.toContain('solde');
  expectClean(ctx);
});

test('v1.60.6 solde fait après J-7 : règle des 3 jours ; J-7 un samedi : vendredi ; date sans jour de concert : inchangée', async ({ page }) => {
  const ctx = await openApp(page);
  const we = satOffset();
  await seed(page, { shows: [P('j7-2', { date: iso(5) }), P('j7-3', { date: iso(we) }), P('j7-4', { date: null })], show_payments: [
    { id: 'j7-2s', show_id: 'j7-2', kind: 'solde', label: 'Solde', pct: 100, invoice_number: 'F-S2', invoiced_on: iso(-4), sort: 1 },
    { id: 'j7-3s', show_id: 'j7-3', kind: 'solde', label: 'Solde', pct: 100, invoice_number: 'F-S3', invoiced_on: iso(-4), sort: 1 },
    { id: 'j7-4s', show_id: 'j7-4', kind: 'solde', label: 'Solde', pct: 100, invoice_number: 'F-S4', invoiced_on: iso(-4), sort: 1 },
  ] });
  const tard = (await send(page, 'j7-2'))[0];
  expect(tard[2], 'solde fait après J-7 : en retard 3 jours après').toBe(true);
  const sam = (await send(page, 'j7-3'))[0];
  expect(sam[1], 'J-7 un samedi → vendredi précédent').toBe(iso(we - 8));
  expect(new Date(sam[1] + 'T12:00:00').getDay()).toBe(5);
  const sans = (await send(page, 'j7-4'))[0];
  expect(sans[2], 'sans jour de concert : 3 jours après, en retard').toBe(true);
  expectClean(ctx);
});
