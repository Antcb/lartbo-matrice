// v1.68 — point n°23 (décisions d'Anthony du 26/11/2026) : « Déverrouiller pour corriger » une facture émise. Données FICTIVES.
//  - par défaut la facture reste verrouillée (montant, %, TVA désactivés ; fermer la fenêtre ne change rien) ;
//  - correction : montant HT, % du cachet, TVA de la ligne, type (acompte / solde / autre) ; motif obligatoire ; confirmation ;
//  - après l'enregistrement : reverrouillée, signalée « corrigée », tracée (auteur, motif, avant / après) ;
//  - n°, envoi, paiement, Pennylane, « Arrive sur » et date du concert inchangés ; factures payées comprises ;
//  - jamais une commission de production ; aucun appel à Pennylane.
// Les refus de la base (protection des factures émises) sont essayés sur une vraie base PostgreSQL :
// supabase/repetitions/2026-11-26_v1.68_correction_facture_essai.sql.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
const SHOW = { id: 'v-1', project_id: 'art-a', venue: 'Salle Correction', date: `${Y}-12-05`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 4000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15 };
const PAYS = [
  { id: 'f-a', show_id: 'v-1', kind: 'acompte', label: 'Acompte 30 %', pct: 30, amount: 1200, invoice_number: 'F-2026-201', sent_at: `${Y}-10-01`,
    pennylane_id: 'pl-201', pennylane_url: 'https://pennylane.example/201', payee: 'compte', sort: 1 },
  { id: 'f-s', show_id: 'v-1', kind: 'solde', label: 'Solde', pct: 70, amount: 2800, invoice_number: 'F-2026-202', sent_at: `${Y}-10-02`, paid_at: `${Y}-10-20`, sort: 2 },
  { id: 'f-c', show_id: 'v-1', kind: 'artbo', label: 'Commission', pct: 15, amount: 600, paid_at: `${Y}-10-21`, sort: 3 },
  { id: 'f-o', show_id: 'v-1', kind: 'autre', label: 'Frais non émis', amount: 50, sort: 4 },
];

async function seed(page) {
  await page.evaluate(async ([show, rows]) => {
    const { S, touch } = await import('./js/state.js');
    window.__DB.shows.push({ ...show }); S.db.shows.push({ ...show }); touch('shows');
    for (const r of rows) { window.__DB.show_payments.push({ ...r }); S.db.show_payments.push({ ...r }); }
    touch('show_payments');
  }, [SHOW, PAYS]);
}
const dbPay = (page, id) => page.evaluate(i => ({ ...window.__DB.show_payments.find(p => p.id === i) }), id);
const openBilling = page => page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  S.openProd.add('v-1'); S.tab['prod:v-1'] = 'factures'; app.go('production'); app.render(); });
const row = (page, id) => page.locator(`tr:has([data-id="${id}"][data-f="label"])`);
const rpcCalls = page => page.evaluate(() => window.__calls.filter(c => c.rpc === 'facture_corriger').length);
const pennylaneCalls = page => page.evaluate(() => window.__calls.filter(c => c.fn === 'pennylane' || /pennylane/i.test(c.url || '') && c.fn).length);

test('v1.68 facture émise : verrouillée par défaut, « Déverrouiller pour corriger » seulement sur les factures émises', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  await openBilling(page);
  const a = row(page, 'f-a');
  await expect(a.locator('input[data-f="amount"]')).toBeDisabled();
  await expect(a.locator('input[data-f="pct"]')).toBeDisabled();
  await expect(a.locator('input[data-f="vat_rate"]')).toBeDisabled();
  await expect(a.locator('[data-act="fixInvoice"]')).toHaveText('Déverrouiller pour corriger');
  await expect(row(page, 'f-s').locator('[data-act="fixInvoice"]')).toHaveCount(1);       // payée : même parcours
  await expect(row(page, 'f-c').locator('[data-act="fixInvoice"]')).toHaveCount(0);       // commission de production : règles inchangées
  await expect(row(page, 'f-o').locator('[data-act="fixInvoice"]')).toHaveCount(0);       // non émise : modifiable directement
  await expect(row(page, 'f-o').locator('[data-act="delPay"]')).toHaveCount(1);
  // ouvrir puis fermer : rien ne change, aucun appel
  await a.locator('[data-act="fixInvoice"]').click();
  const m = page.locator('#modal');
  await expect(m).toContainText('Modifiable ici (suivi MATRICE)');
  await expect(m).toContainText('À corriger dans Pennylane si le document est faux');
  await expect(m).toContainText('Rien n’est envoyé, modifié, annulé ni réémis dans Pennylane');
  await expect(m.locator('[name=amount]')).toHaveValue('1200');
  await m.locator('[data-close], button.ghost').first().click();
  await expect(m).not.toBeVisible();
  expect(await rpcCalls(page)).toBe(0);
  expect(await dbPay(page, 'f-a')).toMatchObject({ amount: 1200, pct: 30 });
  await expect(row(page, 'f-a').locator('input[data-f="amount"]')).toBeDisabled();
  expectClean(ctx);
});

test('v1.68 correction enregistrée : motif obligatoire, champs MATRICE corrigés, reste inchangé, reverrouillée et tracée, aucun appel à Pennylane', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  await openBilling(page);
  await row(page, 'f-a').locator('[data-act="fixInvoice"]').click();
  const m = page.locator('#modal');
  await m.locator('[name=amount]').fill('1400');
  await m.locator('[name=pct]').fill('35');
  await m.locator('[name=vat_rate]').fill('5.5');
  // sans motif : refusé, rien n'est envoyé à la base
  await m.locator('button[type=submit]').click();
  await expect(page.locator('body')).toContainText('Indique le motif de la correction');
  expect(await rpcCalls(page)).toBe(0);
  await m.locator('[name=motif]').fill('Facture Pennylane émise à 35 %');
  await m.locator('button[type=submit]').click();
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('montant 1 200,00 € → 1 400,00 € HT');
  await expect(dlg).toContainText('Pennylane n’est pas modifié');
  await dlg.locator('button', { hasText: 'Enregistrer la correction' }).click();
  await expect(m).not.toBeVisible();
  expect(await rpcCalls(page)).toBe(1);
  const p = await dbPay(page, 'f-a');
  expect(p).toMatchObject({ amount: 1400, pct: 35, vat_rate: 5.5, kind: 'acompte', invoice_number: 'F-2026-201', sent_at: `${Y}-10-01`,
    pennylane_id: 'pl-201', pennylane_url: 'https://pennylane.example/201', payee: 'compte', show_id: 'v-1' });
  expect(p.paid_at ?? null).toBe(null);
  const hist = await page.evaluate(() => window.__DB.facture_corrections);
  expect(hist).toHaveLength(1);
  expect(hist[0]).toMatchObject({ payment_id: 'f-a', motif: 'Facture Pennylane émise à 35 %', before: { amount: 1200, pct: 30 }, after: { amount: 1400, pct: 35, vat_rate: 5.5 } });
  // reverrouillée et signalée
  const a = row(page, 'f-a');
  await expect(a.locator('input[data-f="amount"]')).toBeDisabled();
  await expect(a.locator('input[data-f="amount"]')).toHaveValue('1400');
  await expect(a.locator('.badge', { hasText: 'corrigée' })).toHaveAttribute('title', /Facture Pennylane émise à 35 %/);
  // une modification directe reste refusée par l'application
  const why = await page.evaluate(async () => (await import('./js/calc.js')).changeBlocked('show_payments', 'f-a', { amount: 1500 }));
  expect(why).toContain('ne se modifie plus');
  expect(await pennylaneCalls(page)).toBe(0);
  expectClean(ctx);
});

test('v1.68 facture payée : type corrigé (solde → autre ligne), paiement conservé ; historique visible à la correction suivante', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  await openBilling(page);
  await row(page, 'f-s').locator('[data-act="fixInvoice"]').click();
  const m = page.locator('#modal');
  await m.locator('[name=kind]').selectOption('autre');
  await m.locator('[name=motif]').fill('Ligne mal typée à l’import');
  await m.locator('button[type=submit]').click();
  await page.locator('dialog.ask button', { hasText: 'Enregistrer la correction' }).click();
  await expect(m).not.toBeVisible();
  expect(await dbPay(page, 'f-s')).toMatchObject({ kind: 'autre', amount: 2800, paid_at: `${Y}-10-20`, invoice_number: 'F-2026-202', sent_at: `${Y}-10-02` });
  // nouvelle ouverture : la correction précédente est listée ; « aucun changement » refusé sans appel
  await row(page, 'f-s').locator('[data-act="fixInvoice"]').click();
  await expect(m).toContainText('Corrections précédentes');
  await expect(m).toContainText('Ligne mal typée à l’import');
  await m.locator('[name=motif]').fill('rien');
  await m.locator('button[type=submit]').click();
  await expect(page.locator('body')).toContainText('Aucun changement à enregistrer');
  expect(await rpcCalls(page)).toBe(1);
  expectClean(ctx);
});

test('v1.68 refus de la base affiché, ligne inchangée ; commission en booking : type figé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  await page.evaluate(() => { window.__RPC_ERROR = { facture_corriger: { code: 'P0001', message: 'Résultat clôturé : les recettes qualifiées de cette date sont verrouillées.' } }; });
  await openBilling(page);
  await row(page, 'f-a').locator('[data-act="fixInvoice"]').click();
  const m = page.locator('#modal');
  await m.locator('[name=amount]').fill('1300');
  await m.locator('[name=motif]').fill('essai');
  await m.locator('button[type=submit]').click();
  await page.locator('dialog.ask button', { hasText: 'Enregistrer la correction' }).click();
  await expect(page.locator('body')).toContainText('Résultat clôturé');
  expect(await dbPay(page, 'f-a')).toMatchObject({ amount: 1200 });
  expect(await page.evaluate(() => window.__DB.facture_corrections.length)).toBe(0);
  // commission d'une date en booking : facture, corrigeable, sans choix du type
  const r = await page.evaluate(async () => { const c = await import('./js/calc.js');
    const { S, touch } = await import('./js/state.js'); S.db.shows.push({ id: 'v-b', project_id: 'art-b', prod_mode: 'booking', fee_ht: 2000, status: 'Confirmée Salle' }); touch('shows');
    const p = { id: 'f-b', show_id: 'v-b', kind: 'artbo', invoice_number: 'F-2026-300', amount: 300 };
    return { booking: c.canFixInvoice(p), prod: c.canFixInvoice({ ...p, show_id: 'v-1', paid_at: '2026-10-01' }), horsCalcul: c.canFixInvoice({ ...p, hors_calcul: 'import' }),
      acompteArtiste: c.canFixInvoice({ ...p, kind: 'acompte' }) }; });
  expect(r).toEqual({ booking: true, prod: false, horsCalcul: false, acompteArtiste: false });   // acompte / solde en booking : factures de l'artiste
  expectClean(ctx);
});
