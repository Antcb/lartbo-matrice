// v1.68.2 — brouillon des fenêtres propre à leur objet (décision d'Anthony du 26/11/2026, lot séparé après la v1.68.1) : sans
// identifiant, une fenêtre gardait un seul brouillon pour TOUS ses objets ; une saisie abandonnée (motif, ligne choisie, n° de facture,
// choix « Remplacer » dans le Drive…) revenait dans la fenêtre d'un autre objet. Fenêtres : « Rattacher / corriger le rattachement »
// d'une facture Pennylane (prioritaire), « Rattacher la pièce », « Copier les lignes d'une autre date », « Pièce déjà dans le dossier
// Drive ». Données FICTIVES, aucune connexion à Pennylane ni au Drive.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear() + 1;
const m = page => page.locator('#modal');
const draftKeys = page => page.evaluate(() => Object.keys(localStorage).filter(k => k.includes('draft.modal.')).map(k => k.slice(k.indexOf('draft.modal.'))));   // préfixe d'environnement retiré
/** Le brouillon d'une fenêtre est suivi 60 ms après son ouverture, puis réappliqué à 400, 1 200 et 2 500 ms (ui/drafts.js) */
const SUIVI = 200, REAPPLIQUE = 2700;

async function preparerPennylane(page) {
  await page.evaluate(async Y => {
    const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
    for (const db of [S.db, window.__DB]) {
      const s = db.shows.find(x => x.id === 'sh-1');
      Object.assign(s, { fee_ht: 7500, partner_id: null, pennylane_quote_id: 'devis-fictif', status: 'Confirmée Festival', date: `${Y}-04-24`, vat_rate: null, prod_mode: 'production' });
      db.show_payments = db.show_payments.filter(p => p.show_id !== 'sh-1');
      db.show_payments.push({ id: 'pa', show_id: 'sh-1', kind: 'acompte', label: 'Acompte', pct: 50, amount: null, sort: 10 },
        { id: 'ps', show_id: 'sh-1', kind: 'solde', label: 'Solde', pct: 50, amount: null, sort: 20,
          invoice_number: 'F-TEST-108', pennylane_id: 'pl-108', invoiced_on: '2026-11-06', pennylane_url: 'https://app.pennylane.com/fictif', amount: 3750 });
      db.pennylane_a_rattacher = [{ id: 'r9', pennylane_id: 'pl-109', show_id: 'sh-1', invoice_number: 'F-TEST-109', amount_ht: 3750, invoice_date: '2026-11-07',
        url: 'https://app.pennylane.com/fictif-109', reason: 'Le montant correspond à plusieurs lignes : à choisir', resolved_at: null }];
      db.pennylane_rattachements = [];
    }
    for (const t of ['shows', 'show_payments', 'pennylane_a_rattacher', 'pennylane_rattachements']) touch(t);
    S.year = Y; app.go('production'); S.openProd = new Set(['sh-1']); S.tab['prod:sh-1'] = 'factures'; app.render();
  }, Y);
}

test('v1.68.2 rattachement Pennylane : motif tapé pour une facture puis abandonné → ne revient pas sur une autre facture ; revient sur la même', async ({ page }) => {
  const ctx = await openApp(page);
  await preparerPennylane(page);
  // correction de la facture F-TEST-108 (reliée au solde) : motif tapé puis fenêtre fermée sans enregistrer
  await page.locator('tr', { hasText: 'Solde' }).locator('[data-act=pennylaneAttach]').click();
  await expect(m(page)).toContainText('Corriger le rattachement');
  await page.waitForTimeout(SUIVI);
  await m(page).locator('textarea[name=motif]').fill('Motif tapé pour F-TEST-108');
  await m(page).locator('[data-act="closeModal"]').last().click();
  await expect(m(page)).not.toBeVisible();
  expect(await draftKeys(page)).toContain('draft.modal.1.Corriger le rattachement.pennylane:pl-108');
  // autre facture (F-TEST-109, à rattacher) : fenêtre vierge, même après les nouvelles applications du brouillon
  await page.locator('[data-act=pennylaneAttach][data-pid="pl-109"]').click();
  await expect(m(page)).toContainText('F-TEST-109');
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator('textarea[name=motif]')).toHaveValue('');
  await expect(m(page).locator('.draft-bar')).toHaveCount(0);
  await m(page).locator('[data-act="closeModal"]').last().click();
  // même facture rouverte : la saisie abandonnée revient (comportement des brouillons, inchangé)
  await page.locator('tr', { hasText: 'Solde' }).locator('[data-act=pennylaneAttach]').click();
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator('textarea[name=motif]')).toHaveValue('Motif tapé pour F-TEST-108');
  await expect(m(page).locator('.draft-bar')).toBeVisible();
  expect(await page.evaluate(() => window.__calls.filter(c => c.rpc === 'pennylane_rattacher').length)).toBe(0);
  expectClean(ctx);
});

test('v1.68.2 « Rattacher la pièce » et « Copier les lignes d’une autre date » : brouillon propre à la pièce / à la date de destination', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async Y => {
    const { S, touch } = await import('./js/state.js');
    const shows = [1, 2, 3].map(i => ({ id: `d-${i}`, project_id: 'art-a', venue: `Salle ${i}`, date: `${Y}-0${i}-10`, status: 'Confirmée Salle', contract_type: 'Cession', fee_ht: 4000, prod_mode: 'production' }));
    const pays = [1, 2].flatMap(i => [{ id: `a-${i}`, show_id: `d-${i}`, kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 }, { id: `s-${i}`, show_id: `d-${i}`, kind: 'solde', label: 'Solde', pct: 70, sort: 2 }]);
    const atts = [1, 2].map(i => ({ id: `att-${i}`, project_id: 'art-a', name: `piece-${i}.pdf`, path: `budget/d-${i}/piece-${i}.pdf` }));
    const lines = [{ id: 'bl-1', show_id: 'd-3', project_id: 'art-a', category: 'Technique', label: 'Son', forecast: 100, sort: 1 }];
    for (const db of [S.db, window.__DB]) { db.shows.push(...structuredClone(shows)); db.show_payments.push(...structuredClone(pays)); db.attachments.push(...structuredClone(atts)); db.budget_lines.push(...structuredClone(lines)); }
    for (const t of ['shows', 'show_payments', 'attachments', 'budget_lines']) touch(t);
  }, Y);
  const act = (name, dataset) => page.evaluate(async ([n, d]) => { const { ACTIONS } = await import('./js/actions.js'); ACTIONS[n]({ dataset: d }); }, [name, dataset]);
  // pièce 1 : n° de facture tapé puis abandonné ; pièce 2 : champ vide
  await act('attachPiece', { id: 'att-1', show: 'd-1' });
  await expect(m(page)).toContainText('piece-1.pdf');
  await page.waitForTimeout(SUIVI);
  await m(page).locator('input[name=invoice_number]').fill('F-PIECE-1');
  await m(page).locator('[data-act="closeModal"]').last().click();
  await act('attachPiece', { id: 'att-2', show: 'd-2' });
  await expect(m(page)).toContainText('piece-2.pdf');
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator('input[name=invoice_number]')).toHaveValue('');
  await m(page).locator('[data-act="closeModal"]').last().click();
  // copie vers la date 1 : choix « Seulement les salariés » abandonné ; copie vers la date 2 : valeur proposée d'office
  await act('copyBudget', { id: 'd-1' });
  await expect(m(page)).toContainText('Copier les lignes');
  await page.waitForTimeout(SUIVI);
  await m(page).locator('select[name=what]').selectOption('staff');
  await m(page).locator('[data-act="closeModal"]').last().click();
  await act('copyBudget', { id: 'd-2' });
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator('select[name=what]')).toHaveValue('all');
  const keys = await draftKeys(page);
  expect(keys).toContain('draft.modal.1.Rattacher la pièce.piece:att-1');
  expect(keys).toContain('draft.modal.1.Copier les lignes d’une autre date.copie:d-1');
  expect(keys.filter(k => k.endsWith('.new'))).toEqual([]);
  expectClean(ctx);
});

test('v1.68.2 « Pièce déjà dans le dossier Drive » : brouillon propre au fichier (un « Remplacer » choisi ailleurs ne revient pas)', async () => {
  // fenêtre interne au rangement Drive (askDuplicate, appelée par le script Google) : contrôle du code, la même clé que les autres
  const src = readFileSync(new URL('../../js/budget-actions.js', import.meta.url), 'utf8');
  const ask = src.slice(src.indexOf('function askDuplicate'), src.indexOf('function askDuplicate') + 1200);
  expect(ask).toMatch(/values: \{id: 'drive:' \+ \(dup\.url \|\| dup\.name\) \+ ':' \+ name, decision:/);
});
