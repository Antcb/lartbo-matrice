// v1.61.1 — Solde prévu (décision d'Anthony du 10/11/2026, remplace la règle C1 du 26/10) :
//  « Tu ne mets pas 100 % pour le solde alors qu'un acompte est prévu ! Tu mets les bons % dès le début, et au pire tu réadaptes si
//    un acompte est modifié. »
//  - solde non émis = cession − TOUS les acomptes de la date (prévus et facturés), % = 100 − Σ % d'acompte ;
//  - acompte modifié / retiré (0 %) → le solde se réadapte ; solde émis → figé ; plus d'acompte « caduc » (il reste dû).
// Même règle côté base (payment_amount_for, migration 2026-11-10_v1.61.1_solde_prevu.sql, contrôlée par tests/static/solde-prevu.mjs)
// et Pennylane (regles.ts montantAttendu, tests/static/pennylane-regles.mjs).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
const P = (id, fee, extra = {}) => ({ id, project_id: 'art-a', venue: 'Salle ' + id, date: `${Y}-12-01`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: fee, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 20, ...extra });

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push({ ...r }); S.db[table].push({ ...r }); } touch(table); }
  }, tables);
}
const dbPay = (page, id) => page.evaluate(i => ({ ...window.__DB.show_payments.find(p => p.id === i) }), id);
const calc = (page, fn, ...a) => page.evaluate(async ([f, args]) => {
  const c = await import('./js/calc.js'), { byId } = await import('./js/selectors.js');
  const ref = x => Array.isArray(x) ? x.map(ref) : typeof x === 'string' && x.startsWith('@') ? byId(x.split(':')[0].slice(1), x.split(':')[1]) : x;
  return c[f](...args.map(ref));
}, [fn, a]);
const solde = async (page, id) => [await calc(page, 'billedPct', `@show_payments:${id}`), await calc(page, 'payAmount', `@show_payments:${id}`)];
const ouvrirFactures = (page, id) => page.evaluate(async i => { const { S } = await import('./js/state.js'); S.year = new Date().getFullYear();
  S.openProd.add(i); S.tab['prod:' + i] = 'factures'; (await import('./js/app.js')).go('production'); }, id);
// même chemin que la saisie dans l'onglet Factures (garde-fou, rééquilibrage du solde)
const saisirPct = (page, id, v) => page.evaluate(async ([i, x]) => { const { ACTIONS } = await import('./js/actions.js');
  await ACTIONS['change:show_payments.pct']({dataset: {id: i}}, x); }, [id, v]);

test('capture du 10/11 : cachet 9 000 €, acompte 50 % prévu non facturé → solde 50 % · 4 500 € (et non 100 % · 9 000 €)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('sp-1', 9000)], show_payments: [
    { id: 'sp1-a', show_id: 'sp-1', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 },
    { id: 'sp1-s', show_id: 'sp-1', kind: 'solde', label: 'Solde', pct: 50, sort: 2 },
  ] });
  expect(await solde(page, 'sp1-s')).toEqual([50, 4500]);
  expect(await calc(page, 'acompteState', '@show_payments:sp1-a')).toBe('prevu');
  const b = await calc(page, 'billingOf', '@shows:sp-1');
  expect([b.ht, b.gap, b.plannedHt], 'acompte prévu + solde = cachet').toEqual([9000, 0, 4500]);
  await ouvrirFactures(page, 'sp-1');
  await expect(page.locator('input[data-id="sp1-s"][data-f="pct"]')).toHaveValue('50');
  await expect(page.locator('input[data-id="sp1-s"][data-f="amount"]')).toHaveAttribute('placeholder', '4500');
  await expect(page.locator('tr', { has: page.locator('[data-id="sp1-s"][data-f="label"]') }).locator('.badge', { hasText: 'calculé, non facturé' })).toBeVisible();
  await expect(page.locator('.bill-total.ok')).toHaveCount(1);
  expectClean(ctx);
});

test('acompte passé à 30 % → solde 70 % · 6 300 € ; retiré (0 %) → 100 % · 9 000 € ; facturé → solde inchangé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('sp-2', 9000)], show_payments: [
    { id: 'sp2-a', show_id: 'sp-2', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 },
    { id: 'sp2-s', show_id: 'sp-2', kind: 'solde', label: 'Solde', pct: 50, sort: 2 },
  ] });
  await saisirPct(page, 'sp2-a', 30);
  expect(await solde(page, 'sp2-s')).toEqual([70, 6300]);
  expect((await dbPay(page, 'sp2-s')).pct, '% du solde au contrat réadapté').toBe(70);
  await saisirPct(page, 'sp2-a', 0);
  expect(await solde(page, 'sp2-s')).toEqual([100, 9000]);
  expect(await calc(page, 'acompteRetire', '@show_payments:sp2-a')).toBe(true);
  await saisirPct(page, 'sp2-a', 50);
  expect(await solde(page, 'sp2-s')).toEqual([50, 4500]);
  // l'acompte est facturé : le solde ne bouge pas
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'sp2-a', { invoice_number: 'F-AC-1' }));
  expect((await dbPay(page, 'sp2-a')).amount, 'acompte figé à son émission').toBe(4500);
  expect(await solde(page, 'sp2-s')).toEqual([50, 4500]);
  // montant de solde saisi à la main : il fait foi
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'sp2-s', { amount: 4400, pct: 48.8889 }));
  expect(await calc(page, 'payAmount', '@show_payments:sp2-s')).toBe(4400);
  expectClean(ctx);
});

test('solde émis : figé au montant du moment ; l’acompte non facturé reste dû et ne peut que se retirer', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('sp-3', 9000, { contract_sent: `${Y}-11-01` })], show_payments: [
    { id: 'sp3-a', show_id: 'sp-3', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1, payee: 'compte' },
    { id: 'sp3-s', show_id: 'sp-3', kind: 'solde', label: 'Solde', pct: 50, sort: 2, payee: 'compte' },
  ] });
  expect(await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'sp3-s', { invoice_number: 'F-SO-1', sent_at: `${new Date().getFullYear()}-11-02` }))).toBeTruthy();
  expect((await dbPay(page, 'sp3-s')).amount, 'solde figé à 4 500 €').toBe(4500);
  expect(await calc(page, 'acompteState', '@show_payments:sp3-a')).toBe('prevu');
  // l'acompte reste dû : rappel « facture d'acompte à faire » et à recevoir sur le compte
  const rel = () => page.evaluate(async () => (await import('./js/reminders.js')).remindersOf((await import('./js/selectors.js')).byId('shows', 'sp-3')).map(x => x.step));
  expect(await rel()).toContain('acompte');
  // changer son % : refusé (le solde émis ne se réadapte plus), données inchangées
  await saisirPct(page, 'sp3-a', 30);
  expect((await dbPay(page, 'sp3-a')).pct).toBe(50);
  expect(await calc(page, 'changeBlocked', 'show_payments', 'sp3-a', { pct: 30, amount: null })).toContain('peut seulement être retiré');
  // ajouter un acompte : refusé
  expect(await calc(page, 'soldeInvoiced', 'sp-3')).toBe(true);
  // retrait (0 %) : permis ; le solde émis garde son montant ; plus de rappel d'acompte
  await saisirPct(page, 'sp3-a', 0);
  expect((await dbPay(page, 'sp3-a')).pct).toBe(0);
  expect((await dbPay(page, 'sp3-s')).amount, 'solde émis inchangé').toBe(4500);
  expect(await rel()).not.toContain('acompte');
  expectClean(ctx);
});

test('acompte facturé puis solde : solde = cession − acompte facturé (inchangé par rapport à avant)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('sp-4', 9000)], show_payments: [
    { id: 'sp4-a', show_id: 'sp-4', kind: 'acompte', label: 'Acompte', pct: 50, amount: 4500, invoice_number: 'F-A4', sort: 1 },
    { id: 'sp4-b', show_id: 'sp-4', kind: 'acompte', label: 'Acompte 2', pct: 20, sort: 2 },
    { id: 'sp4-s', show_id: 'sp-4', kind: 'solde', label: 'Solde', pct: 30, sort: 3 },
    { id: 'sp4-h', show_id: 'sp-4', kind: 'acompte', label: 'Import', pct: 40, sort: 4, hors_calcul: 'ligne d’import (essai)' },
  ] });
  expect(await solde(page, 'sp4-s'), 'deux acomptes (facturé + prévu) ; ligne hors calcul ignorée').toEqual([30, 2700]);
  expectClean(ctx);
});
