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

// ---- Cas relevés par la relecture indépendante (2c8ba45) ----

test('relecture 1 : « Conserver » garde aussi un montant de solde saisi à la main', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [
    { id: 'k-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 },
    { id: 'k-s', show_id: 'v-1', kind: 'solde', label: 'Solde', amount: 2000, pct: 60.006, sort: 100 },
  ]);
  const run = page.evaluate(async () => (await import('./js/actions.js')).ACTIONS['change:shows.fee_ht']({ dataset: { id: 'v-1' } }, 4000));
  await page.getByRole('button', { name: 'Conserver les montants saisis' }).click();
  await run;
  expect((await dbPay(page, 'k-s')).amount).toBe(2000);
  expectClean(ctx);
});

test('relecture 2 : cachet, TVA ou % ne peuvent plus changer le montant d’une facture émise (garde-fou central)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [
    { id: 'g-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', pct: 50, invoice_number: 'F-201', sort: 1 },
    { id: 'g-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 50, sort: 100 },
    // date en production : la commission n'est pas une facture, seul son VERSEMENT la fige (lot C1, décision du 26/10)
    { id: 'g-c', show_id: 'v-1', kind: 'artbo', label: 'Commission', paid_at: '2026-02-01', sort: 200 },
  ]);
  const r = await page.evaluate(async () => {
    const { save } = await import('./js/data.js'); const { ACTIONS } = await import('./js/actions.js');
    const out = {};
    await ACTIONS['change:shows.fee_ht']({ dataset: { id: 'v-1' } }, 4000);
    out.feeTable = window.__DB.shows.find(s => s.id === 'v-1').fee_ht;
    out.feeSave = !!(await save('shows', 'v-1', { fee_ht: 5000 }, { rerender: false }));
    out.tva = !!(await save('shows', 'v-1', { vat_rate: 20 }, { rerender: false }));
    out.com = !!(await save('shows', 'v-1', { artbo_pct: 25 }, { rerender: false }));
    out.memeValeur = !!(await save('shows', 'v-1', { fee_ht: 3333, venue: 'Salle Verrou' }, { rerender: false }));   // rien ne change : permis
    out.ligne = !!(await save('show_payments', 'g-a', { amount: 999 }, { rerender: false }));
    out.fee = window.__DB.shows.find(s => s.id === 'v-1').fee_ht; out.state = (await import('./js/selectors.js')).byId('shows', 'v-1').fee_ht;
    return out;
  });
  expect(r).toEqual({ feeTable: 3333, feeSave: false, tva: false, com: false, memeValeur: true, ligne: false, fee: 3333, state: 3333 });
  expect((await dbPay(page, 'g-a')).amount ?? null).toBeNull();
  expectClean(ctx);
});

test('relecture 2 bis : sans facture émise, le cachet change librement', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [{ id: 'f-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 }, { id: 'f-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 50, sort: 100 }]);
  await page.evaluate(async () => (await import('./js/actions.js')).ACTIONS['change:shows.fee_ht']({ dataset: { id: 'v-1' } }, 4000));
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'v-1').fee_ht)).toBe(4000);
  expectClean(ctx);
});

test('relecture 3 : « Valider les conditions » avec un nouveau cachet demande avant de toucher l’acompte en euros', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [
    { id: 'w-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', amount: 1000, pct: 30.003, sort: 1 },
    { id: 'w-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 69.997, sort: 100 },
  ]);
  const done = page.evaluate(async () => (await import('./js/confirm-flow.js')).validateTerms('v-1'));
  await page.locator('#modal [name=fee_ht]').fill('4000');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal2 h2')).toHaveText('Cachet modifié');
  await page.getByRole('button', { name: 'Conserver les montants saisis' }).click();
  expect(await done).toBe(true);
  expect((await dbPay(page, 'w-a')).amount, 'montant saisi conservé').toBe(1000);
  expect((await dbPay(page, 'w-s')).pct, 'solde = reste du nouveau cachet').toBe(75);
  expectClean(ctx);
});

test('relecture 4 : solde émis → un acompte ne se supprime plus depuis le tableau', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [{ id: 'z-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 }, { id: 'z-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 70, sent_at: '2026-03-01', sort: 100 }]);
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.openProd.add('v-1'); S.tab['prod:v-1'] = 'factures'; (await import('./js/app.js')).go('production'); });
  await expect(page.locator('input[data-id="z-a"][data-f="pct"]')).toBeDisabled();
  await expect(page.locator('button[data-act="delPay"][data-id="z-a"]')).toHaveCount(0);
  await page.evaluate(async () => (await import('./js/actions.js')).ACTIONS.delPay({ dataset: { id: 'z-a' } }));
  expect(await page.evaluate(() => window.__DB.show_payments.some(p => p.id === 'z-a'))).toBe(true);
  expectClean(ctx);
});

test('relecture 6 : la fiche complète de la date pose la même question sur le cachet', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [
    { id: 'h-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', amount: 1000, pct: 30.003, sort: 1 },
    { id: 'h-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 69.997, sort: 100 },
  ]);
  const opened = page.evaluate(async () => (await import('./js/forms.js')).editShow('v-1'));   // la promesse se résout à la fermeture
  await page.locator('#modal [name=fee_ht]').fill('4000');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal2 h2')).toHaveText('Cachet modifié');
  await page.locator('#modal2 button[type=submit]').click();   // recalculer
  await expect.poll(() => dbPay(page, 'h-a').then(p => p.amount ?? null)).toBeNull();
  await expect.poll(() => dbPay(page, 'h-s').then(p => p.pct)).toBe(70);   // solde = reste, arrondi à 2 décimales (comportement existant)
  await opened;
  expectClean(ctx);
});

// ---- Seconde relecture (e547b04) ----

test('relecture bis 1 : passer une date facturée de booking à production est refusé (TVA de la commission)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [{ id: 'm-c', show_id: 'v-1', kind: 'artbo', label: 'Commission', pct: 15, invoice_number: 'F-301', sort: 1 }]);
  const r = await page.evaluate(async () => {
    const { S } = await import('./js/state.js'); const { save } = await import('./js/data.js');
    const s = S.db.shows.find(x => x.id === 'v-1'); s.prod_mode = 'booking'; window.__DB.shows.find(x => x.id === 'v-1').prod_mode = 'booking';
    return { refuse: !(await save('shows', 'v-1', { prod_mode: 'production' }, { rerender: false })), mode: window.__DB.shows.find(x => x.id === 'v-1').prod_mode };
  });
  expect(r).toEqual({ refuse: true, mode: 'booking' });
  expectClean(ctx);
});

test('relecture bis 2 : une date qui porte une facture émise ne se supprime pas (ni une ligne verrouillée)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [{ id: 'q-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', pct: 50, paid_at: '2026-04-01', sort: 1 }, { id: 'q-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 50, sort: 100 }]);
  const r = await page.evaluate(async () => {
    const { remove } = await import('./js/data.js');
    return { date: await remove('shows', 'v-1'), ligne: await remove('show_payments', 'q-a'), libre: await remove('show_payments', 'q-s') };
  });
  expect(r).toEqual({ date: false, ligne: false, libre: true });
  expect(await page.evaluate(() => window.__DB.shows.some(s => s.id === 'v-1'))).toBe(true);
  expectClean(ctx);
});

// ---- Troisième relecture (cc765a9) : un refus n'est jamais suivi d'un faux succès ----

test('relecture ter : refus du garde-fou → aucun message de réussite, la fiche reste ouverte', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [{ id: 'r-c', show_id: 'v-1', kind: 'artbo', label: 'Commission', pct: 15, invoice_number: 'F-401', sort: 1 },
    { id: 'r-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 100, invoice_number: 'F-402', sort: 100 }]);
  // case « booking uniquement » : refus, pas de « Date en production »
  await page.evaluate(async () => {
    const { S } = await import('./js/state.js'); S.db.shows.find(x => x.id === 'v-1').prod_mode = 'booking'; window.__DB.shows.find(x => x.id === 'v-1').prod_mode = 'booking';
    const { BUDGET_ACTIONS } = await import('./js/budget-actions.js');
    await BUDGET_ACTIONS.toggleBookingOnly({ dataset: { id: 'v-1' }, checked: false });
  });
  expect(await lastToast(page)).not.toMatch(/Date en production/);
  expect(await page.evaluate(() => window.__DB.shows.find(x => x.id === 'v-1').prod_mode)).toBe('booking');
  // fiche : statut « Annulée » + nouveau cachet → refus, pas de fenêtre « Cachet modifié », la fiche reste ouverte
  const opened = page.evaluate(async () => (await import('./js/forms.js')).editShow('v-1'));
  await page.locator('#modal [name=fee_ht]').fill('4000');
  await page.locator('#modal #fld-status').selectOption('Annulée');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal2')).not.toBeVisible();
  expect(await page.evaluate(() => window.__DB.shows.find(x => x.id === 'v-1'))).toMatchObject({ fee_ht: 3333, status: 'Confirmée Salle' });
  await page.keyboard.press('Escape');
  await opened;
  expectClean(ctx);
});

// ---- Point 2 d'Anthony (24/10) : une facture émise ne se déverrouille pas en effaçant ce qui la rend émise ----

test('déverrouillage impossible : numéro, dates et identifiant Pennylane ne s’effacent pas (modifiables, jamais vidés)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, [{ id: 'u-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte', pct: 50, invoice_number: 'F-501', sent_at: '2026-05-01', pennylane_id: '777', paid_at: '2026-05-10', sort: 1 }]);
  const r = await page.evaluate(async () => {
    const { save } = await import('./js/data.js'); const ok = async p => !!(await save('show_payments', 'u-a', p, { rerender: false }));
    return {
      numeroVide: await ok({ invoice_number: null }), numeroBlanc: await ok({ invoice_number: '  ' }), envoiVide: await ok({ sent_at: null }),
      payeVide: await ok({ paid_at: null }), pennylaneVide: await ok({ pennylane_id: '' }), tousVides: await ok({ invoice_number: null, sent_at: null, pennylane_id: null, paid_at: null }),
      numeroCorrige: await ok({ invoice_number: 'F-501b' }), envoiCorrige: await ok({ sent_at: '2026-05-02' }), libelle: await ok({ label: 'Acompte 1', payee: 'compte' }),
    };
  });
  expect(r).toEqual({ numeroVide: false, numeroBlanc: false, envoiVide: false, payeVide: false, pennylaneVide: false, tousVides: false,
    numeroCorrige: true, envoiCorrige: true, libelle: true });
  expect(await dbPay(page, 'u-a')).toMatchObject({ invoice_number: 'F-501b', sent_at: '2026-05-02', pennylane_id: '777', paid_at: '2026-05-10', pct: 50 });
  expectClean(ctx);
});
