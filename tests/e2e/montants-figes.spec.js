// Lot D1 (demandes d'Anthony du 26/10/2026) : montants figés dès l'émission ou le versement, avertissement avant de changer le
// cachet / un % d'une date qui a des lignes émises, artiste sans compte dédié. Données FICTIVES uniquement.
// Même règle côté base : migration 2026-10-26_v1.42_montants_figes_journal.sql (déclencheurs show_payments_freeze, shows_frozen_guard).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
const DATE = { id: 'f-1', project_id: 'art-a', venue: 'Salle Figée', date: `${Y}-12-05`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 10000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15, partner_pct: 30 };

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) {
      for (const r of rows) { window.__DB[table].push({ ...r }); S.db[table].push({ ...r }); }
      touch(table);
    }
  }, tables);
}
const dbPay = (page, id) => page.evaluate(i => ({ ...window.__DB.show_payments.find(p => p.id === i) }), id);
const dbShow = (page, id) => page.evaluate(i => ({ ...window.__DB.shows.find(s => s.id === i) }), id);
const save = (page, table, id, patch) => page.evaluate(async ([t, i, p]) => !!(await (await import('./js/data.js')).save(t, i, p)), [table, id, patch]);
const LIGNES = [
  { id: 'g-a', show_id: 'f-1', kind: 'acompte', label: 'Acompte', pct: 50, sort: 10 },
  { id: 'g-s', show_id: 'f-1', kind: 'solde', label: 'Solde', pct: 50, sort: 20 },
  { id: 'g-c', show_id: 'f-1', kind: 'artbo', label: 'Commission L’ArtBo', sort: 30 },
  { id: 'g-p', show_id: 'f-1', kind: 'partner', label: 'Commission partenaire', sort: 40 },
];

test('D1 : une facture émise, une commission versée, une part partenaire versée gardent le montant du moment', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DATE], show_payments: LIGNES });
  expect(await save(page, 'show_payments', 'g-a', { sent_at: `${Y}-10-01`, invoice_number: 'F-TEST-1' })).toBe(true);
  expect(await save(page, 'show_payments', 'g-c', { paid_at: `${Y}-10-02` })).toBe(true);
  expect(await save(page, 'show_payments', 'g-p', { paid_at: `${Y}-10-03` })).toBe(true);
  expect((await dbPay(page, 'g-a')).amount, 'acompte figé à l’émission').toBe(5000);
  expect((await dbPay(page, 'g-c')).amount, 'commission figée au versement').toBe(1500);
  expect((await dbPay(page, 'g-p')).amount, 'part partenaire figée au versement').toBe(450);
  expect((await dbPay(page, 'g-s')).amount ?? null, 'solde pas encore émis : toujours calculé').toBeNull();
  expectClean(ctx);
});

test('D1 : changer le cachet d’une date qui a des lignes émises demande confirmation ; les montants émis ne bougent pas', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DATE], show_payments: [
    { ...LIGNES[0], sent_at: `${Y}-10-01`, invoice_number: 'F-TEST-2', amount: 5000 },
    LIGNES[1], { ...LIGNES[2], paid_at: `${Y}-10-02`, amount: 1500 }, { ...LIGNES[3], paid_at: `${Y}-10-03`, amount: 450 } ] });
  // 1) avertissement refusé (fenêtre fermée) : rien n'est écrit
  let run = save(page, 'shows', 'f-1', { fee_ht: 12000 });
  await expect(page.locator('#modal h2')).toHaveText('Factures déjà émises sur cette date');
  await expect(page.locator('#modal')).toContainText('F-TEST-2');
  await page.getByRole('button', { name: 'Annuler' }).click();
  expect(await run, 'refusé').toBe(false);
  expect((await dbShow(page, 'f-1')).fee_ht).toBe(10000);
  // 2) avertissement accepté : le cachet change, les lignes émises gardent leur montant, le solde non émis suit
  run = save(page, 'shows', 'f-1', { fee_ht: 12000 });
  await page.locator('#modal button[type=submit]').click();
  expect(await run).toBe(true);
  expect((await dbShow(page, 'f-1')).fee_ht).toBe(12000);
  expect([(await dbPay(page, 'g-a')).amount, (await dbPay(page, 'g-c')).amount, (await dbPay(page, 'g-p')).amount]).toEqual([5000, 1500, 450]);
  const solde = await page.evaluate(async () => (await import('./js/calc.js')).payAmount(window.__DB.show_payments.find(p => p.id === 'g-s')));
  expect(solde, 'solde = nouvelle cession − acompte facturé').toBe(7000);
  expectClean(ctx);
});

test('D1 : un cachet sans ligne émise se change sans avertissement', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DATE], show_payments: LIGNES });
  expect(await save(page, 'shows', 'f-1', { fee_ht: 11000 })).toBe(true);
  await expect(page.locator('#modal[open]')).toHaveCount(0);
  expectClean(ctx);
});

test('D1 : artiste sans compte dédié — aucun solde de compte artiste affiché', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { projects: [{ id: 'art-v', name: 'Artiste Sans Compte', active: true, mode: 'production' }],
    shows: [{ ...DATE, id: 'f-v', project_id: 'art-v', venue: 'Salle Sans Compte' }],
    show_payments: [{ id: 'v-a', show_id: 'f-v', kind: 'acompte', label: 'Acompte', amount: 5000, payee: 'artbo', paid_at: `${Y}-10-01`, sent_at: `${Y}-09-01`, sort: 10 },
      { id: 'v-c', show_id: 'f-v', kind: 'artbo', label: 'Commission L’ArtBo', amount: 1500, paid_at: `${Y}-10-02`, sort: 30 }] });
  const html = await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.openBudget = new Set(['art-v']);
    return (await import('./js/views/budget.js')).projectBudgetHTML('art-v'); });
  expect(html).toContain('Pas de compte dédié');
  expect(html).not.toContain('solde réel');
  expectClean(ctx);
});

test('D1 (relecture) : un % qui ne touche aucune ligne émise se change sans avertissement ; sinon avertissement', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DATE], show_payments: [{ ...LIGNES[0], sent_at: `${Y}-10-01`, invoice_number: 'F-TEST-3', amount: 5000 }, LIGNES[1], LIGNES[2], LIGNES[3]] });
  expect(await save(page, 'shows', 'f-1', { artbo_pct: 18 }), 'seul l’acompte est émis : la commission n’est pas concernée').toBe(true);
  await expect(page.locator('#modal[open]')).toHaveCount(0);
  await page.evaluate(async y => (await import('./js/data.js')).save('show_payments', 'g-c', { paid_at: `${y}-10-02` }), Y);
  const run = save(page, 'shows', 'f-1', { artbo_pct: 20 });
  await expect(page.locator('#modal h2')).toHaveText('Factures déjà émises sur cette date');
  await expect(page.locator('#modal')).toContainText('Commission');
  await page.getByRole('button', { name: 'Annuler' }).click();
  expect(await run).toBe(false);
  expect((await dbShow(page, 'f-1')).artbo_pct).toBe(18);
  expect((await dbPay(page, 'g-c')).amount, 'commission figée au versement, au % du moment').toBe(1800);
  expectClean(ctx);
});
