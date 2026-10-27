// Lot D1 — coproductions (décision d'Anthony du 27/10/2026, Rockstore) : aucune facture, aucun paiement, aucun acompte, aucune
// commission L'ArtBo ni Pyrprod inventés. Les lignes créées par l'import sont gardées (traçabilité) mais « hors calcul ».
// Côté base : migration 2026-10-27_v1.44_coproduction_hors_calcul.sql (essais SQL de la répétition). Données FICTIVES.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear() + 1;
const COPRO = { id: 'cp-1', project_id: 'art-a', venue: 'Salle Coproduction', date: `${Y}-05-22`, status: 'Confirmée Salle',
  contract_type: 'Co-Production', fee_ht: 5000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15, partner_pct: 30 };
const MOTIF = 'Coproduction : ligne créée par l’import Notion (« N.C »), aucune facture ni paiement réels';
// lignes de l'import : acompte « N.C » noté envoyé / payé, commission notée versée — classées hors calcul (script F)
const IMPORT = [
  { id: 'cp-a', show_id: 'cp-1', kind: 'acompte', label: 'Acompte', pct: 20, invoice_number: 'N.C', sent_at: `${Y - 1}-09-28`, paid_at: `${Y - 1}-09-28`, sort: 10, hors_calcul: MOTIF },
  { id: 'cp-s', show_id: 'cp-1', kind: 'solde', label: 'Solde', pct: 80, sort: 20, hors_calcul: MOTIF },
  { id: 'cp-c', show_id: 'cp-1', kind: 'artbo', label: 'Commission L’ArtBo', paid_at: `${Y - 1}-09-28`, sort: 30, hors_calcul: MOTIF },
  { id: 'cp-p', show_id: 'cp-1', kind: 'partner', label: 'Commission Pyrprod', sort: 40, hors_calcul: MOTIF },
  { id: 'cp-n', show_id: 'cp-1', kind: 'cnm', label: 'Taxe CNM', sort: 50 },
];

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) {
      for (const r of rows) { window.__DB[table].push({ ...r }); (S.db[table] ||= []).push({ ...r }); }
      touch(table);
    }
  }, tables);
}
const etat = page => page.evaluate(async () => {
  const c = await import('./js/calc.js'), b = await import('./js/budget.js'), r = await import('./js/reminders.js');
  const { S } = await import('./js/state.js'); const { byId } = await import('./js/selectors.js');
  const s = byId('shows', 'cp-1');
  return { finance: c.financeOf(S.db.shows.filter(x => x.id === 'cp-1')), comptes: c.paymentsOf('cp-1').map(p => p.kind),
    commission: b.commissionAmount(s), rappels: r.remindersOf(s).map(x => x.title), compte: b.accountOf('art-a').real,
    emise: c.hasFinancialRecord('cp-1') };
});

test('coproduction : les lignes importées hors calcul n’alimentent ni indicateurs, ni commission, ni rappels, ni compte', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await page.evaluate(async () => (await import('./js/budget.js')).accountOf('art-a').real);
  await seed(page, { shows: [COPRO], show_payments: IMPORT });
  const e = await etat(page);
  expect(e.comptes, 'seule la taxe CNM compte').toEqual(['cnm']);
  expect(e.finance.resteProd, 'pas de cession à encaisser').toBe(0);
  expect(e.finance.impayesProd).toBe(0);
  expect(e.commission, 'aucune commission L’ArtBo').toBe(0);
  expect(e.rappels.filter(t => /solde|acompte|Commission|Pyrprod/i.test(t)), 'aucun rappel de facture ou de commission').toEqual([]);
  expect(e.compte, 'compte de l’artiste inchangé').toBe(avant);
  expect(e.emise, 'pas de date « engagée » par une ligne fictive').toBe(false);
  expectClean(ctx);
});

test('coproduction : onglet Factures — aucune facture ni paiement fictifs affichés, lignes importées gardées en traçabilité', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [COPRO], show_payments: IMPORT });
  await page.evaluate(async () => {
    const { S } = await import('./js/state.js'); const { go } = await import('./js/app.js');
    S.year = Number(S.db.shows.find(x => x.id === 'cp-1').date.slice(0, 4)); S.openProd = new Set(['cp-1']); S.tab['prod:cp-1'] = 'factures'; go('production');
  });
  const tab = page.locator('#prod-cp-1 .prod-tab');
  await expect(tab).toContainText('Coproduction : aucune facture de cession');
  for (const id of ['cp-a', 'cp-s', 'cp-c', 'cp-p']) await expect(tab.locator(`[data-id="${id}"]`), id).toHaveCount(0);
  await expect(tab.locator('[data-id="cp-n"]').first()).toBeVisible();
  await expect(tab.locator('details.hors-calcul summary')).toContainText('4 lignes importées, hors calcul');
  await expect(tab).not.toContainText('Total factures');
  expect(await tab.innerText()).not.toMatch(/N\.C/);
  // une ligne hors calcul ne se modifie ni ne se supprime depuis l'application
  const r = await page.evaluate(async () => { const c = await import('./js/calc.js');
    return [c.changeBlocked('show_payments', 'cp-a', { paid_at: null }), c.changeBlocked('show_payments', 'cp-c', null), c.changeBlocked('shows', 'cp-1', null)]; });
  expect(r[0]).toMatch(/hors calcul/); expect(r[1]).toMatch(/hors calcul/); expect(r[2]).toMatch(/hors calcul/);
  expectClean(ctx);
});

test('coproduction : « Valider les conditions » ne crée ni acompte ni solde d’office ; une opération réelle s’ajoute à la main', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [{ ...COPRO, id: 'cp-2', venue: 'Salle Copro Neuve' }], show_payments: [] });
  const done = page.evaluate(async () => (await import('./js/confirm-flow.js')).validateTerms('cp-2'));
  await expect(page.locator('#modal #terms-n')).toHaveValue('0');
  await page.locator('#modal button[type=submit]').click();
  expect(await done).toBe(true);
  expect(await page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'cp-2').map(p => p.kind))).toEqual([]);
  // date en production classique : acompte et solde proposés comme avant (non-régression)
  await seed(page, { shows: [{ ...COPRO, id: 'pr-1', venue: 'Salle Cession', contract_type: 'Cession' }], show_payments: [] });
  const d2 = page.evaluate(async () => (await import('./js/confirm-flow.js')).validateTerms('pr-1'));
  await expect(page.locator('#modal #terms-n')).toHaveValue('1');
  await page.locator('#modal button[type=submit]').click();
  expect(await d2).toBe(true);
  expect((await page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'pr-1').map(p => p.kind))).sort()).toEqual(['acompte', 'solde']);
  expectClean(ctx);
});

test('coproduction avec une opération réelle ajoutée à la main : elle compte normalement', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [COPRO], show_payments: [...IMPORT, { id: 'cp-r', show_id: 'cp-1', kind: 'autre', label: 'Part coproducteur', amount: 1200, invoice_number: 'F-REEL-1', sent_at: `${Y - 1}-10-01`, sort: 60 }] });
  const e = await etat(page);
  expect(e.comptes).toEqual(['cnm', 'autre']);
  expect(e.emise, 'facture réelle : la date est engagée').toBe(true);
  expectClean(ctx);
});

// Décision d'Anthony (27/10/2026) : le tableau par date du compte artiste ne présente plus un budget prévisionnel de coproduction
// comme un « reste artiste » (Cabaret Sauvage −12 889,98, Rockstore 5 000) ; seuls les montants réalisés s'affichent, hors totaux.
test('coproduction : tableau de l’artiste — aucun « reste artiste » prévisionnel, hors totaux, solde du compte inchangé', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await page.evaluate(async () => (await import('./js/budget.js')).accountOf('art-a'));
  const LIGNES = [
    { id: 'cp-l1', show_id: 'cp-1', project_id: 'art-a', category: 'Salle', label: 'Location salle', forecast: 6000, sort: 1, payer: 'artbo' },
    { id: 'cp-l2', show_id: 'cp-1', project_id: 'art-a', category: 'Promo', label: 'Communication', forecast: 800, amount: 800, paid_at: `${Y}-04-02`, sort: 2, payer: 'artbo' },
  ];
  await seed(page, { shows: [COPRO], show_payments: IMPORT, budget_lines: LIGNES });
  const apres = await page.evaluate(async () => (await import('./js/budget.js')).accountOf('art-a'));
  expect(apres.real, 'solde réel du compte inchangé').toBe(avant.real);
  expect(apres.end, 'solde prévu du compte inchangé').toBe(avant.end);
  await page.evaluate(async () => {
    const { S } = await import('./js/state.js'); const { go } = await import('./js/app.js');
    S.year = Number(S.db.shows.find(x => x.id === 'cp-1').date.slice(0, 4)); S.openBudget = new Set(['art-a']); go('production');
  });
  const row = page.locator('.proj-budget tr', { has: page.locator('a[data-id="cp-1"]') });
  await expect(row).toHaveCount(1);
  const cells = await row.locator('td').allInnerTexts();
  expect(cells[1]).toContain('Coproduction');
  expect(cells[2], 'pas de cachet présenté comme cession').toBe('—');
  expect(cells[3], 'pas de commission').toBe('—');
  expect(cells[4], 'dépenses réellement payées seulement').toContain('800,00');
  expect(cells[5], 'pas de reste artiste prévisionnel').toBe('—');
  const total = await page.locator('.proj-budget .total-row').innerText();
  expect(total, 'totaux sans le budget de la coproduction').not.toContain('5 000,00');
  expect(total).toContain('hors totaux');
  expectClean(ctx);
});
