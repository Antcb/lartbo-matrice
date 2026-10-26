// Lot C1 (décisions d'Anthony du 26/10/2026) : règles métier booking / production.
//  - Production : solde à facturer = cession − acomptes EFFECTIVEMENT facturés ; acompte prévu ≠ réduction du solde ;
//    solde figé dès qu'il est émis ; acompte non facturé « caduc » quand le solde l'est (historique gardé).
//  - Indicateurs ① reste à encaisser production, ② factures émises impayées production, ③ commissions booking à encaisser.
//  - Commission de production : pas une facture ; seul son versement (date) la fige.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
const P = (id, fee, extra = {}) => ({ id, project_id: 'art-a', venue: 'Salle ' + id, date: `${Y}-12-01`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: fee, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15, ...extra });
const B = (id, fee) => ({ ...P(id, fee), project_id: 'art-b', prod_mode: 'booking' });

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

test('C1 solde : 10 000 € sans acompte facturé, 7 000 € après un acompte de 30 % facturé ; l’acompte prévu ne réduit pas le solde', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('c-1', 10000)], show_payments: [
    { id: 'c1-a', show_id: 'c-1', kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 },
    { id: 'c1-s', show_id: 'c-1', kind: 'solde', label: 'Solde', pct: 70, sort: 2 },
  ] });
  expect(await calc(page, 'payAmount', '@show_payments:c1-s')).toBe(10000);
  expect(await calc(page, 'acompteState', '@show_payments:c1-a')).toBe('prevu');
  expect(await calc(page, 'planAmount', '@show_payments:c1-s'), 'échéancier du contrat : 70 %').toBe(7000);
  let b = await calc(page, 'billingOf', '@shows:c-1');
  expect([b.ht, b.gap, b.plannedHt]).toEqual([10000, 0, 3000]);
  // l'acompte est facturé (numéro) : le solde à facturer devient 7 000 €
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'c1-a', { invoice_number: 'F-AB-1' }));
  expect(await calc(page, 'payAmount', '@show_payments:c1-s')).toBe(7000);
  expect(await calc(page, 'acompteState', '@show_payments:c1-a')).toBe('facture');
  b = await calc(page, 'billingOf', '@shows:c-1');
  expect([b.ht, b.gap, b.plannedHt]).toEqual([10000, 0, 0]);
  // le solde est facturé : montant figé en base à 7 000 €, inchangé ensuite
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'c1-s', { sent_at: `${new Date().getFullYear()}-11-01` }));
  expect((await dbPay(page, 'c1-s')).amount).toBe(7000);
  expect((await dbPay(page, 'c1-a')).amount ?? null, 'acompte émis : jamais réécrit').toBeNull();
  expectClean(ctx);
});

test('C1 acompte caduc : solde intégral facturé → acompte non facturé caduc, hors indicateurs, historique gardé ; affichage dans l’onglet Factures', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('c-2', 9000)], show_payments: [
    { id: 'c2-a', show_id: 'c-2', kind: 'acompte', label: 'Acompte prévu', pct: 50, sort: 1 },
    { id: 'c2-s', show_id: 'c-2', kind: 'solde', label: 'Solde', pct: 50, sort: 2 },
  ] });
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'c2-s', { invoice_number: 'F-AB-S' }));
  expect((await dbPay(page, 'c2-s')).amount, 'solde intégral').toBe(9000);
  expect(await calc(page, 'acompteState', '@show_payments:c2-a')).toBe('caduc');
  const f = await calc(page, 'financeOf', ['@shows:c-2']);
  expect([f.resteProd, f.impayesProd], '① 9 000 restant, ② 9 000 émis impayés (jamais additionnés)').toEqual([9000, 9000]);
  expect(await dbPay(page, 'c2-a')).toMatchObject({ pct: 50, label: 'Acompte prévu' });
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.year = new Date().getFullYear(); S.openProd.add('c-2'); S.tab['prod:c-2'] = 'factures'; (await import('./js/app.js')).go('production'); });
  await expect(page.locator('tr', { has: page.locator('[data-id="c2-a"][data-f="label"]') }).locator('.badge', { hasText: 'caduc' })).toBeVisible();
  await expect(page.locator('input[data-id="c2-s"][data-f="pct"]')).toBeDisabled();   // solde émis : verrouillé
  expectClean(ctx);
});

test('C1 indicateurs : ① reste à encaisser production, ② factures émises impayées production, ③ commissions booking — jamais les factures de l’artiste', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('i-1', 10000), P('i-2', 5000), B('i-3', 8000)], show_payments: [
    // i-1 : acompte 3 000 facturé et payé, solde à facturer 7 000 (pas encore émis)
    { id: 'i1-a', show_id: 'i-1', kind: 'acompte', pct: 30, invoice_number: 'F-1', paid_at: `${Y}-01-01`, sort: 1 },
    { id: 'i1-s', show_id: 'i-1', kind: 'solde', pct: 70, sort: 2 },
    // i-2 : acompte 2 500 émis impayé, acompte prévu 500, solde à facturer 2 500
    { id: 'i2-a', show_id: 'i-2', kind: 'acompte', pct: 50, invoice_number: 'F-2', sort: 1 },
    { id: 'i2-b', show_id: 'i-2', kind: 'acompte', pct: 10, sort: 2 },
    { id: 'i2-s', show_id: 'i-2', kind: 'solde', pct: 40, sort: 3 },
    // i-3 booking : factures de l'artiste (émises, impayées) + commission L'ArtBo émise impayée (15 % de 8 000) + une payée
    { id: 'i3-a', show_id: 'i-3', kind: 'acompte', pct: 50, invoice_number: 'ART-1', sent_at: `${Y}-01-02`, sort: 1 },
    { id: 'i3-s', show_id: 'i-3', kind: 'solde', pct: 50, invoice_number: 'ART-2', sent_at: `${Y}-01-03`, sort: 2 },
    { id: 'i3-c', show_id: 'i-3', kind: 'artbo', invoice_number: 'F-AB-3', sent_at: `${Y}-01-04`, sort: 3 },
  ] });
  const f = await calc(page, 'financeOf', ['@shows:i-1', '@shows:i-2', '@shows:i-3']);
  expect({ reste: f.resteProd, impayes: f.impayesProd, commissions: f.commissionsBooking, n: [f.factures, f.commissions] })
    .toEqual({ reste: 7000 + 5000, impayes: 2500, commissions: 1200, n: [1, 1] });
  expect(await calc(page, 'payAmount', '@show_payments:i2-s'), 'solde i-2 = 5 000 − 2 500 facturés').toBe(2500);
  expect(await calc(page, 'tracked', '@show_payments:i3-s')).toBe(false);
  expect(await calc(page, 'tracked', '@show_payments:i3-c')).toBe(true);
  expectClean(ctx);
});

test('C1 commission de production : un numéro saisi ne la rend pas « émise » ; seul le versement la fige ; hors factures impayées', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('m-1', 6000)], show_payments: [
    { id: 'm1-c', show_id: 'm-1', kind: 'artbo', label: 'Commission', invoice_number: 'F-AB-2026-03-51', sort: 3 },   // ancien n° de l'acompte (historique)
  ] });
  expect(await calc(page, 'isInvoiced', '@show_payments:m1-c')).toBe(false);
  expect(await calc(page, 'billLockReason', '@show_payments:m1-c')).toBe('');
  expect((await calc(page, 'financeOf', ['@shows:m-1'])).impayesProd).toBe(0);
  // le cachet peut changer (la commission non versée n'est pas une facture) ; ancien numéro conservé tel quel (aucune modification auto)
  expect(!!(await page.evaluate(async () => (await import('./js/data.js')).save('shows', 'm-1', { fee_ht: 6500 }, { rerender: false })))).toBe(true);
  expect((await dbPay(page, 'm1-c')).invoice_number).toBe('F-AB-2026-03-51');
  // versée : figée (montant), et sa date de versement ne s'efface pas ; le vieux numéro, lui, peut être vidé
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'm1-c', { paid_at: `${new Date().getFullYear()}-02-01` }));
  expect(await calc(page, 'billLockReason', '@show_payments:m1-c')).toBe('Commission déjà versée : elle ne se modifie plus.');
  const r = await page.evaluate(async () => { const { save } = await import('./js/data.js');
    return { cachet: !!(await save('shows', 'm-1', { fee_ht: 7000 }, { rerender: false })), vider: !!(await save('show_payments', 'm1-c', { paid_at: null }, { rerender: false })),
      numero: !!(await save('show_payments', 'm1-c', { invoice_number: null }, { rerender: false })) }; });
  expect(r).toEqual({ cachet: false, vider: false, numero: true });
  expectClean(ctx);
});

test('C1 compte dédié : l’acompte prévu n’est jamais compté deux fois (déjà compris dans le solde à facturer)', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await page.evaluate(async () => (await import('./js/budget.js')).accountOf('art-a').inTodo);
  await seed(page, { shows: [P('a-1', 10000)], show_payments: [
    { id: 'a1-a', show_id: 'a-1', kind: 'acompte', pct: 30, payee: 'compte', sort: 1 },
    { id: 'a1-s', show_id: 'a-1', kind: 'solde', pct: 70, payee: 'compte', sort: 2 },
  ] });
  const apres = await page.evaluate(async () => (await import('./js/budget.js')).accountOf('art-a').inTodo);
  expect(apres - avant, 'à recevoir = la cession, pas 13 000').toBe(10000);
  expectClean(ctx);
});

test('C1 saisies conservées : solde saisi à la main (Belvédère) gardé et figé tel quel ; contrat sur l’échéancier prévu', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('v-9', 4500)], show_payments: [
    { id: 'v9-a', show_id: 'v-9', kind: 'acompte', pct: 20, invoice_number: 'F-AB-A', sort: 1 },
    { id: 'v9-s', show_id: 'v-9', kind: 'solde', pct: 80, amount: 3600, sort: 2 },
  ] });
  expect(await calc(page, 'payAmount', '@show_payments:v9-s')).toBe(3600);
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'v9-s', { invoice_number: 'F-AB-S' }));
  expect((await dbPay(page, 'v9-s')).amount).toBe(3600);
  // contrat d'une date dont l'acompte n'est pas encore facturé : échéancier PRÉVU (30 % / 70 %), pas le solde recalculé (10 000 €)
  await seed(page, { shows: [P('k-9', 10000)], show_payments: [
    { id: 'k9-a', show_id: 'k-9', kind: 'acompte', pct: 30, sort: 1 }, { id: 'k9-s', show_id: 'k-9', kind: 'solde', pct: 70, sort: 2 } ] });
  const vars = await page.evaluate(async () => (await import('./js/contract.js')).contractVars((await import('./js/selectors.js')).byId('shows', 'k-9')));
  // acompte 3 000 × 1,055 et solde PRÉVU 7 000 × 1,055 (jamais le solde recalculé de 10 000 €)
  expect(vars.seq.find(x => x.find === 'XXXX€ TTC').values.map(v => v.replace(/\s/g, ' '))).toEqual(['3 165€ TTC', '7 385€ TTC']);
  expectClean(ctx);
});

// ── Corrections de la relecture indépendante (B2, B3, B4, cession vide) ──
const save = (page, t, id, patch) => page.evaluate(async ([a, b, c]) => (await import('./js/data.js')).save(a, b, c), [t, id, patch]);

test('C1 relecture B2 : « Conditions » et mail gardent l’échéancier prévu au contrat (acompte 30 % · solde 70 %)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('r-2', 10000)], show_payments: [
    { id: 'r2-a', show_id: 'r-2', kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 },
    { id: 'r2-s', show_id: 'r-2', kind: 'solde', label: 'Solde', pct: 70, sort: 2 },
  ] });
  expect(await calc(page, 'billPct', '@show_payments:r2-s'), '% au contrat').toBe(70);
  expect(await calc(page, 'billedPct', '@show_payments:r2-s'), 'part réelle (onglet Factures)').toBe(100);
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.year = new Date().getFullYear(); S.openProd.add('r-2'); S.tab['prod:r-2'] = 'conditions'; (await import('./js/app.js')).go('production'); });
  const steps = page.locator('.steps').filter({ hasText: 'Acomptes' });
  await expect(steps).toContainText('Acompte 30 %');
  await expect(steps).toContainText('solde 70 %');
  expectClean(ctx);
});

test('C1 relecture B3 : un acompte caduc ne s’émet plus (jamais au-delà de la cession)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('r-3', 10000)], show_payments: [
    { id: 'r3-a', show_id: 'r-3', kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 },
    { id: 'r3-s', show_id: 'r-3', kind: 'solde', label: 'Solde', pct: 70, sort: 2 },
  ] });
  expect(await save(page, 'show_payments', 'r3-s', { invoice_number: 'F-S' })).toBeTruthy();
  for (const f of ['invoice_number', 'sent_at', 'paid_at', 'pennylane_id']) {
    expect(await save(page, 'show_payments', 'r3-a', { [f]: f === 'sent_at' || f === 'paid_at' ? `${Y}-11-02` : 'X-1' }), f).toBeFalsy();
  }
  const a = await dbPay(page, 'r3-a'); expect([a.invoice_number ?? null, a.sent_at ?? null, a.paid_at ?? null, a.pennylane_id ?? null]).toEqual([null, null, null, null]);
  const b = await calc(page, 'billingOf', '@shows:r-3');
  expect([b.ht, b.gap]).toEqual([10000, 0]);
  expect((await calc(page, 'financeOf', ['@shows:r-3'])).impayesProd).toBe(10000);
  // libellé encore modifiable (historique)
  expect(await save(page, 'show_payments', 'r3-a', { label: 'Acompte (caduc)' })).toBeTruthy();
  expect(ctx.errors).toEqual([]);
});

test('C1 relecture B4 : le mode d’une date dont un acompte / solde est émis ne change plus (production ↔ booking)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('r-4', 10000), B('r-5', 5000), P('r-6', 4000)], show_payments: [
    { id: 'r4-s', show_id: 'r-4', kind: 'solde', label: 'Solde', pct: 100, sort: 1, sent_at: `${Y}-10-01`, invoice_number: 'F-4' },
    { id: 'r5-a', show_id: 'r-5', kind: 'acompte', label: 'Acompte artiste', pct: 50, sort: 1, invoice_number: 'ART-1' },
    { id: 'r6-a', show_id: 'r-6', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 },
  ] });
  expect(await calc(page, 'changeBlocked', 'shows', 'r-4', { prod_mode: 'booking' })).toContain('mode booking / production ne change plus');
  expect(await calc(page, 'changeBlocked', 'shows', 'r-5', { prod_mode: 'production' })).toContain('mode booking / production ne change plus');
  expect(await calc(page, 'changeBlocked', 'shows', 'r-6', { prod_mode: 'booking' }), 'aucune facture émise : libre').toBe('');
  expect(await calc(page, 'changeBlocked', 'shows', 'r-4', { prod_mode: 'production' }), 'même mode : rien ne change').toBe('');
  expect(await save(page, 'shows', 'r-4', { prod_mode: 'booking', prod_mode_manual: true })).toBeFalsy();
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'r-4').prod_mode)).toBe('production');
  expect(ctx.errors).toEqual([]);
});

test('C1 relecture : cession vide → le solde n’est jamais figé à 0 € quand il est numéroté', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('r-7', null)], show_payments: [{ id: 'r7-s', show_id: 'r-7', kind: 'solde', label: 'Solde', pct: 100, sort: 1 }] });
  expect(await save(page, 'show_payments', 'r7-s', { invoice_number: 'F-7' })).toBeTruthy();
  expect((await dbPay(page, 'r7-s')).amount ?? null).toBeNull();
  expectClean(ctx);
});
