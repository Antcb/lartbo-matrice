// V1-A lot A1 : une facture émise (envoyée, payée, numérotée ou liée à Pennylane) ne se modifie plus ;
// un acompte saisi en euros est conservé ; le cachet ne réécrit jamais un montant saisi sans le demander.
// Règles : CONVENTIONS §6.4 (Q4), §6.5 (Q5), Q22. Constats d'audit A-01, A-02.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const SHOW = { id: 'v-1', project_id: 'art-a', venue: 'Salle Verrou', date: `${new Date().getFullYear()}-12-05`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 3333, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15 };

/** Ajoute la date d'essai et ses lignes, à la fois dans la fausse base et dans l'état de l'application */
async function seed(page, pays) {
  await page.evaluate(async ([show, rows]) => {
    const { S, touch } = await import('./js/state.js');
    window.__DB.shows.push({ ...show }); S.db.shows.push({ ...show }); touch('shows');
    for (const r of rows) { window.__DB.show_payments.push({ ...r }); S.db.show_payments.push({ ...r }); }
    touch('show_payments');
  }, [SHOW, pays]);
}
const dbPay = (page, id) => page.evaluate(i => ({ ...window.__DB.show_payments.find(p => p.id === i) }), id);
const lastToast = page => page.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(e => e.textContent).join(' | '));

test('définition unique d’une facture émise', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [{ id: 'd-s', show_id: 'v-1', kind: 'solde', pct: 70, invoice_number: 'F-9', sort: 2 }, { id: 'd-a', show_id: 'v-1', kind: 'acompte', pct: 30, sort: 1 }]);
  const r = await page.evaluate(async () => {
    const c = await import('./js/calc.js');
    return {
      vide: c.isInvoiced({}), envoyee: c.isInvoiced({ sent_at: '2026-01-01' }), payee: c.isInvoiced({ paid_at: '2026-01-01' }),
      numerotee: c.isInvoiced({ invoice_number: 'F-1' }), pennylane: c.isInvoiced({ pennylane_id: '42' }),
      soldeFacture: c.soldeInvoiced('v-1'), acompteBloque: !!c.billLockReason({ id: 'd-a', show_id: 'v-1', kind: 'acompte', pct: 30 }),
      autreDate: c.soldeInvoiced('sh-1'),
    };
  });
  expect(r).toEqual({ vide: false, envoyee: true, payee: true, numerotee: true, pennylane: true, soldeFacture: true, acompteBloque: true, autreDate: false });
  expectClean(ctx);
});

test('A-01 : une facture numérotée par Pennylane (sans date d’envoi) est verrouillée partout', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [
    { id: 'n-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', pct: 50, invoice_number: 'F-101', pennylane_id: '901', sort: 1 },
    { id: 'n-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 50, invoice_number: 'F-102', pennylane_id: '902', sort: 2 },
  ]);
  // tableau Factures : champs désactivés, pas de suppression
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.openProd.add('v-1'); S.tab['prod:v-1'] = 'factures'; (await import('./js/app.js')).go('production'); });
  await expect(page.locator('input[data-id="n-a"][data-f="pct"]')).toBeDisabled();
  await expect(page.locator('input[data-id="n-a"][data-f="amount"]')).toBeDisabled();
  await expect(page.locator('input[data-id="n-s"][data-f="vat_rate"]')).toBeDisabled();
  await expect(page.locator('button[data-act="delPay"][data-id="n-a"]')).toHaveCount(0);
  // tous les chemins de modification refusent, rien n'est écrit
  await page.evaluate(async () => {
    const { ACTIONS, rebalanceSolde } = await import('./js/actions.js');
    await ACTIONS['change:show_payments.pct']({ dataset: { id: 'n-a' } }, 30);
    await ACTIONS['change:show_payments.amount']({ dataset: { id: 'n-a' } }, 1000);
    await ACTIONS['change:show_payments.amount_ttc']({ dataset: { id: 'n-a' } }, 1000);
    await ACTIONS['change:show_payments.vat_rate']({ dataset: { id: 'n-s' } }, 20);
    await ACTIONS.delPay({ dataset: { id: 'n-a' } });
    await ACTIONS.addPay({ dataset: { id: 'v-1', kind: 'acompte' } });
    await rebalanceSolde('v-1');
  });
  for (const [id, pct] of [['n-a', 50], ['n-s', 50]]) {
    const p = await dbPay(page, id);
    expect(p.pct, id).toBe(pct); expect(p.amount ?? null, id).toBeNull(); expect(p.vat_rate ?? null, id).toBeNull();
  }
  expect(await page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'v-1').length), 'aucune ligne ajoutée ni supprimée').toBe(2);
  expect(await lastToast(page)).toMatch(/déjà (émise|facturé)/);
  expectClean(ctx);
});

test('A-02 : « Valider les conditions » sans changement garde l’acompte saisi en euros', async ({ page }) => {
  const ctx = await openApp(page);
  // 1 000 € saisis sur un cachet de 3 333 € (le % stocké en découle)
  await seed(page, [
    { id: 'e-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', amount: 1000, pct: 30.003, sort: 1 },
    { id: 'e-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 69.997, sort: 100 },
  ]);
  const done = page.evaluate(async () => (await import('./js/confirm-flow.js')).validateTerms('v-1'));
  await page.locator('#modal button[type=submit]').click();
  expect(await done).toBe(true);
  const a = await dbPay(page, 'e-a');
  expect(a.amount, 'montant saisi conservé').toBe(1000);
  expect(a.pct).toBe(30.003);
  // % changé volontairement dans la fenêtre : il remplace le montant (comportement voulu)
  const again = page.evaluate(async () => (await import('./js/confirm-flow.js')).validateTerms('v-1'));
  await page.locator('#modal [data-terms-ac="0"]').fill('40');
  await page.locator('#modal button[type=submit]').click();
  expect(await again).toBe(true);
  const b = await dbPay(page, 'e-a');
  expect(b.amount ?? null).toBeNull(); expect(b.pct).toBe(40);
  expect((await dbPay(page, 'e-s')).pct, 'solde = reste').toBe(60);
  expectClean(ctx);
});

test('solde déjà facturé : les acomptes ne changent plus dans « Valider les conditions »', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [
    { id: 'l-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 },
    { id: 'l-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 70, invoice_number: 'F-7', sort: 100 },
  ]);
  const done = page.evaluate(async () => (await import('./js/confirm-flow.js')).validateTerms('v-1'));
  await expect(page.locator('#modal [data-terms-ac="0"]')).toBeDisabled();
  await expect(page.locator('#modal #terms-n')).toBeDisabled();
  await page.locator('#modal [data-terms-due="0"]').fill('à la signature');
  await page.locator('#modal button[type=submit]').click();
  expect(await done).toBe(true);
  const a = await dbPay(page, 'l-a'), s = await dbPay(page, 'l-s');
  expect([a.pct, s.pct, a.due_label]).toEqual([30, 70, 'à la signature']);
  expectClean(ctx);
});

test('Q5 : changer le cachet demande avant d’écraser un montant saisi à la main', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [
    { id: 'c-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', amount: 1000, pct: 30.003, sort: 1 },
    { id: 'c-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 69.997, sort: 100 },
    { id: 'c-x', show_id: 'v-1', kind: 'acompte', label: 'Acompte 2', amount: 500, pct: 15, sent_at: '2026-01-01', sort: 2 },
  ]);
  // 1) conserver
  let run = page.evaluate(async () => (await import('./js/actions.js')).ACTIONS['change:shows.fee_ht']({ dataset: { id: 'v-1' } }, 4000));
  await expect(page.locator('#modal h2')).toHaveText('Cachet modifié');
  await page.getByRole('button', { name: 'Conserver les montants saisis' }).click();
  await run;
  expect((await dbPay(page, 'c-a')).amount, 'montant saisi conservé').toBe(1000);
  expect((await dbPay(page, 'c-x')).amount, 'facture émise jamais touchée').toBe(500);
  // 2) recalculer
  run = page.evaluate(async () => (await import('./js/actions.js')).ACTIONS['change:shows.fee_ht']({ dataset: { id: 'v-1' } }, 5000));
  await page.locator('#modal button[type=submit]').click();
  await run;
  expect((await dbPay(page, 'c-a')).amount ?? null, 'recalcul choisi').toBeNull();
  expect((await dbPay(page, 'c-x')).amount, 'facture émise jamais touchée').toBe(500);
  expectClean(ctx);
});
