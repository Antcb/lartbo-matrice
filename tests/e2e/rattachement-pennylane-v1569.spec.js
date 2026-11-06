// v1.56.9 : factures Pennylane du devis à rattacher à la main — données FICTIVES, aucune connexion à Pennylane.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function preparer(page, { linkedOn = null } = {}) {
  await page.evaluate(async linkedOn => {
    const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
    for (const db of [S.db, window.__DB]) {
      const s = db.shows.find(x => x.id === 'sh-1');
      Object.assign(s, { fee_ht: 7500, partner_id: null, pennylane_quote_id: 'devis-fictif', status: 'Confirmée Festival', date: `${new Date().getFullYear() + 1}-04-24`, vat_rate: null, prod_mode: 'production' });
      db.show_payments = db.show_payments.filter(p => p.show_id !== 'sh-1');
      const fact = { invoice_number: 'F-TEST-108', pennylane_id: 'pl-108', invoiced_on: '2026-11-06', pennylane_url: 'https://app.pennylane.com/fictif', amount: 3750 };
      db.show_payments.push({ id: 'pa', show_id: 'sh-1', kind: 'acompte', label: 'Acompte', pct: 50, amount: null, sort: 10, ...(linkedOn === 'pa' ? fact : {}) },
        { id: 'ps', show_id: 'sh-1', kind: 'solde', label: 'Solde', pct: 50, amount: null, sort: 20, ...(linkedOn === 'ps' ? fact : {}) },
        { id: 'pc', show_id: 'sh-1', kind: 'artbo', label: "Commission L'ArtBo", sort: 30 });
      db.pennylane_a_rattacher = linkedOn ? [] : [{ id: 'r1', pennylane_id: 'pl-108', show_id: 'sh-1', invoice_number: 'F-TEST-108', amount_ht: 3750, invoice_date: '2026-11-06',
        url: 'https://app.pennylane.com/fictif', reason: 'Le montant correspond à plusieurs lignes (Acompte, Solde) : à choisir', resolved_at: null }];
      db.pennylane_rattachements = [];
    }
    for (const t of ['shows', 'show_payments', 'pennylane_a_rattacher', 'pennylane_rattachements']) touch(t);
    S.year = new Date().getFullYear() + 1; app.go('production'); S.openProd = new Set(['sh-1']); S.tab['prod:sh-1'] = 'factures'; app.render();
  }, linkedOn);
}
const rpcs = page => page.evaluate(() => window.__calls.filter(c => c.rpc === 'pennylane_rattacher').map(c => c.args));

test('v1.56.9 : facture à rattacher — choix explicite de la ligne, document et lignes affichés, confirmation, aucune écriture directe', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await expect(page.locator('main')).toContainText('Facture Pennylane à rattacher');
  await expect(page.locator('main')).toContainText('F-TEST-108');
  await page.locator('[data-act=pennylaneAttach]').first().click();
  await expect(page.locator('#modal')).toContainText('Lignes de la date');
  await expect(page.locator('#modal')).toContainText('n’est pas modifié');
  await page.locator('#modal select[name=to]').selectOption('pa');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('dialog[open]', { hasText: 'Rattacher la facture ?' })).toBeVisible();
  await page.locator('dialog[open]', { hasText: 'Rattacher la facture ?' }).locator('button', { hasText: 'Annuler' }).click();
  expect(await rpcs(page)).toEqual([]);   // annuler : rien
  await page.locator('#modal button[type=submit]').click();
  await page.locator('dialog[open]', { hasText: 'Rattacher la facture ?' }).locator('button', { hasText: 'Rattacher' }).click();
  await expect.poll(() => rpcs(page)).toEqual([{ p_pennylane_id: 'pl-108', p_payment: 'pa', p_motif: null }]);
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'show_payments' && c.op === 'update').length)).toBe(0);   // seul chemin : la fonction serveur
  expectClean(ctx);
});

test('v1.56.9 : corriger une facture reliée à la mauvaise ligne — motif obligatoire', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { linkedOn: 'ps' });
  await page.locator('tr', { hasText: 'Solde' }).locator('[data-act=pennylaneAttach]').click();
  await expect(page.locator('#modal')).toContainText('Corriger le rattachement');
  await page.locator('#modal select[name=to]').selectOption('pa');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('motif');
  expect(await rpcs(page)).toEqual([]);
  await page.locator('#modal textarea[name=motif]').fill('Facture d’acompte reliée au solde par erreur');
  await page.locator('#modal button[type=submit]').click();
  await page.locator('dialog[open]', { hasText: 'Corriger le rattachement ?' }).locator('button', { hasText: 'Corriger' }).click();
  await expect.poll(() => rpcs(page)).toEqual([{ p_pennylane_id: 'pl-108', p_payment: 'pa', p_motif: 'Facture d’acompte reliée au solde par erreur' }]);
  expectClean(ctx);
});

test('v1.56.9 : solde calculé clairement « non facturé » ; disparaît quand une facture de solde existe', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { linkedOn: 'pa' });
  const solde = page.locator('tr', { hasText: 'Solde' }).first();
  await expect(solde).toContainText('calculé, non facturé');
  await expect(page.locator('tr', { hasText: 'Acompte' }).first()).not.toContainText('calculé, non facturé');
  await preparer(page, { linkedOn: 'ps' });
  await expect(page.locator('tr', { hasText: 'Solde' }).first()).not.toContainText('calculé, non facturé');
  expectClean(ctx);
});

test('v1.56.9 : acompte noté à la main avec le même n° (cas Monestier) — l’acompte est proposé ; facture annulée : plus rattachable', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) { Object.assign(db.show_payments.find(p => p.id === 'pa'), { invoice_number: 'F-TEST-108', sent_at: '2026-11-06' });
      db.pennylane_a_rattacher[0].reason = 'Même montant qu’un acompte déjà noté à la main : est-ce cet acompte ou le solde ?'; }
    touch('show_payments'); touch('pennylane_a_rattacher'); (await import('./js/app.js')).render(); });
  await page.locator('[data-act=pennylaneAttach]').first().click();
  const opts = await page.locator('#modal select[name=to] option').allTextContents();
  expect(opts.some(o => /Acompte .*noté à la main/.test(o))).toBe(true);
  expect(opts.some(o => /^Solde/.test(o))).toBe(true);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) db.pennylane_a_rattacher[0].cancelled_at = '2026-11-07T10:00:00Z';
    touch('pennylane_a_rattacher'); (await import('./js/app.js')).render(); });
  await expect(page.locator('main')).not.toContainText('Facture Pennylane à rattacher');
  expectClean(ctx);
});
