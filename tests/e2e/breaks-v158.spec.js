// v1.58 — points d'équilibre (« breaks ») et partage des pertes (décisions d'Anthony du 04/11 et du 05/11/2026 ; montants des cas de
// travail, pas des règles universelles). Données FICTIVES. Prix TTC 21,10 € à 5,5 % de TVA = 20 € HT ; taxes mises à 0 pour des
// comptes ronds (CNM 0 %, SACEM 0 %).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const openBudget = (page, id) => page.evaluate(async i => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  app.go('production'); S.openProd.add(i); S.tab['prod:' + i] = 'budget'; app.render(); }, id);
const BASE = { project_id: 'art-a', structure_id: 'st-1', venue: 'Salle Témoin', city: 'Villeexemple', department: '75', status: 'Confirmée Salle',
  prod_mode: 'production', vat_rate: 5.5, cnm_pct: 0, capacity: 1500 };
const PROD = (extra = {}) => ({ vat: 5.5, sacem_pct: 0, tickets: [{ label: 'Plein', qty: 1200, price: 21.1 }], ...extra });
const breaks = (page, id) => page.evaluate(async i => { const b = await import('./js/break.js'); const { byId } = await import('./js/selectors.js');
  const k = b.productionBreaks(byId('shows', i)) || b.coreaBreaks(byId('shows', i));
  return JSON.parse(JSON.stringify(k, (key, v) => key === 'planned' ? undefined : v)); }, id);
const pick = (k, key) => Object.fromEntries(Object.entries(k.readings.find(r => r.key === key).byScenario).map(([sc, r]) => [sc, r.lossMissing ? 'manquant' : r.n]));

test('v1.58 coproduction : résultat partagé, part de L’ArtBo (promo à sa seule charge retirée une fois), résultat global — trois breaks distincts', async ({ page }) => {
  const ctx = await openApp(page);
  // coûts communs 10 000 € ; promotion locale = 8 % de la recette nette, à la charge de L'ArtBo seule ; partage 50 / 50
  await seed(page, { shows: [{ ...BASE, id: 'bk-1', date: `${Y}-03-10`, contract_type: 'Co-Production', partner_id: 'part-1',
      production: PROD({ artbo_share: 50, artbo_loss_share: 50, promo_net_pct: 8, promo_debtor: 'artbo' }) }],
    budget_lines: [{ id: 'bk-l1', project_id: 'art-a', show_id: 'bk-1', category: 'Salle', label: 'Coûts communs', forecast: 10000, payer: 'artbo' }] });
  const k = await breaks(page, 'bk-1');
  // partagé : 20 n − 10 000 ≥ 0 → 500 ; global : 18,4 n − 10 000 ≥ 0 → 544 ; L'ArtBo : 0,5 (20 n − 10 000) − 1,6 n ≥ 0 → 596
  expect(pick(k, 'shared')).toEqual({ mix: 500, low: 500, high: 500 });
  expect(pick(k, 'global')).toEqual({ mix: 544, low: 544, high: 544 });
  // part de L'ArtBo : 50 % des bénéfices, 50 % des pertes (contrat) ; promotion à sa seule charge retirée une fois
  expect(pick(k, 'artbo')).toEqual({ mix: 596, low: 596, high: 596 });
  // budget prévu à 1 200 billets : promo hors partage, retirée une seule fois de la part de L'ArtBo
  const f = await page.evaluate(async () => { const p = await import('./js/production-budget.js'); const { byId } = await import('./js/selectors.js');
    const b = p.productionBudget(byId('shows', 'bk-1')); return { resultDl: b.resultDl, shared: b.shared, artbo: b.artbo, partner: b.partner, promo: b.promo }; });
  expect(f).toEqual({ resultDl: 12080, shared: 14000, artbo: 5080, partner: 7000, promo: 1920 });   // 5 080 + 7 000 = 12 080 (global)
  await openBudget(page, 'bk-1');
  await expect(page.locator('.prod-budget')).toContainText('Points d’équilibre (calculés sur le prévu)');
  await expect(page.locator('.prod-budget')).toContainText('Résultat partagé');
  expectClean(ctx);
});

test('v1.58 partage des pertes : jamais déduit du partage des bénéfices ; manquant → information manquante (parts, break, clôture)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [{ ...BASE, id: 'bk-2', date: `${Y}-03-11`, contract_type: 'Co-Production', partner_id: 'part-1', ticket_holder: 'artbo',
      production: PROD({ artbo_share: 50, tickets: [{ label: 'Plein', qty: 400, price: 21.1, real_qty: 300 }], receipts_cashed_at: `${Y}-03-12` }) }],
    budget_lines: [{ id: 'bk-l2', project_id: 'art-a', show_id: 'bk-2', category: 'Salle', label: 'Coûts communs', forecast: 10000, amount: 10000, payer: 'artbo', paid_at: `${Y}-03-01` }] });
  // prévu : 400 billets → 8 000 € − 10 000 € = −2 000 € ; aucune part inventée
  let f = await page.evaluate(async () => { const p = await import('./js/production-budget.js'); const { byId } = await import('./js/selectors.js');
    const s = byId('shows', 'bk-2'); const b = p.productionBudget(s), c = p.coprodClose(s);
    return { artbo: b.artbo, partner: b.partner, lossMissing: b.lossMissing, part: c.snapshot.artbo_part, issues: c.issues }; });
  expect(f.artbo).toBeNull(); expect(f.partner).toBeNull(); expect(f.lossMissing).toBe(true); expect(f.part).toBeNull();
  expect(f.issues.join(' ')).toContain('part des pertes supportée par L’ArtBo');
  let k = await breaks(page, 'bk-2');
  expect(pick(k, 'artbo')).toEqual({ mix: 'manquant', low: 'manquant', high: 'manquant' });
  expect(pick(k, 'shared')).toEqual({ mix: null, low: null, high: null });   // non atteint avec les 400 billets prévus
  await openBudget(page, 'bk-2');
  await expect(page.locator('.prod-budget')).toContainText('information manquante');
  await expect(page.locator('.prod-budget')).toContainText('non atteint avec les 400 billets prévus');
  // % des pertes du contrat saisi (30 %) : différent du partage des bénéfices (50 %), appliqué tel quel
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); const s = S.db.shows.find(x => x.id === 'bk-2');
    s.production = { ...s.production, artbo_loss_share: 30 }; touch('shows'); });
  f = await page.evaluate(async () => { const p = await import('./js/production-budget.js'); const { byId } = await import('./js/selectors.js');
    const s = byId('shows', 'bk-2'); const b = p.productionBudget(s), r = p.productionBudget(s, true), c = p.coprodClose(s);
    return { artbo: b.artbo, partner: b.partner, real: r.artbo, part: c.snapshot.artbo_part, loss: c.snapshot.artbo_loss_share }; });
  expect(f).toEqual({ artbo: -600, partner: -1400, real: -1200, part: -1200, loss: 30 });   // réel : 300 billets → −4 000 €
  k = await breaks(page, 'bk-2');
  expect(pick(k, 'artbo')).toEqual({ mix: null, low: null, high: null });   // perte jusqu'aux 400 billets : non atteint, plus « manquant »
  expectClean(ctx);
});

test('v1.58 production (L’ArtBo seule) : un break par scénario, billet par billet dans les quotas ; cession et booking : aucun', async ({ page }) => {
  const ctx = await openApp(page);
  // deux tarifs : 100 billets à 10,55 € TTC (10 € HT) et 100 à 31,65 € TTC (30 € HT) ; coûts 2 000 €
  await seed(page, { shows: [
      { ...BASE, id: 'bk-3', date: `${Y}-03-12`, contract_type: 'Production', production: PROD({ tickets: [{ label: 'Réduit', qty: 100, price: 10.55 }, { label: 'Plein', qty: 100, price: 31.65 }] }) },
      { ...BASE, id: 'bk-4', date: `${Y}-03-13`, contract_type: 'Cession', fee_ht: 3000 },
      { ...BASE, id: 'bk-5', date: `${Y}-03-14`, contract_type: 'Production', prod_mode: 'booking' }],
    budget_lines: [{ id: 'bk-l3', project_id: 'art-a', show_id: 'bk-3', category: 'Promoteur', label: 'Coûts', forecast: 2000, payer: 'artbo' }] });
  const k = await breaks(page, 'bk-3');
  // les plus chers d'abord : 67 × 30 = 2 010 ≥ 2 000 → 67 ; les moins chers d'abord : 100 × 10 + 34 × 30 = 2 020 → 134 ;
  // répartition prévue (moitié / moitié, billet par billet) : 50 billets = 25 × 10 + 25 × 30 = 1 000 → 100 billets = 2 000 → 100
  expect(pick(k, 'global')).toEqual({ mix: 100, low: 134, high: 67 });
  expect(k.readings.map(r => r.key)).toEqual(['global']);
  expect(await page.evaluate(async () => { const b = await import('./js/break.js'); const { byId } = await import('./js/selectors.js');
    return [b.productionBreaks(byId('shows', 'bk-4')), b.coreaBreaks(byId('shows', 'bk-4')), b.productionBreaks(byId('shows', 'bk-5'))]; })).toEqual([null, null, null]);
  expectClean(ctx);
});

test('v1.58 coréalisation : équilibre du spectacle non calculable, break du contrat à part, équilibre de L’ArtBo selon ses conditions', async ({ page }) => {
  const ctx = await openApp(page);
  // MG 1 000 € ; dépenses prévues de la date 3 000 € ; break du contrat 100 billets ; 50 % du résultat net ; charges déductibles 500 €
  await seed(page, { shows: [{ ...BASE, id: 'bk-6', date: `${Y}-03-15`, contract_type: 'Co-Réalisation', fee_ht: 1000, capacity: 1000,
      break_even: 100, cr_producer_pct: 50, cnm_in_result: false,
      corea: { tiers: [{ label: 'Plein', price: 21.1, vat: 5.5, qty: 0 }], charges: [{ label: 'Frais de billetterie', amount: 500 }] } }],
    budget_lines: [{ id: 'bk-l6', project_id: 'art-a', show_id: 'bk-6', category: 'Staff', label: 'Cachets', qty: 3, unit_cost: 1000, payer: 'compte' }] });
  // break pas encore validé : aucun calcul (règle du 27/10)
  let k = await breaks(page, 'bk-6');
  expect(k.spectacle).toContain('non calculable : données manquantes');
  expect(k.missing).toContain('validation du break du contrat');
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); const s = S.db.shows.find(x => x.id === 'bk-6');
    s.corea = { ...s.corea, break_validated_at: new Date().toISOString(), break_value: 100 }; touch('shows'); });
  k = await breaks(page, 'bk-6');
  // 1 000 + 0,5 × (20 × (n − 100) − 500) − 3 000 ≥ 0 → n ≥ 325 (un seul tarif : les trois scénarios coïncident)
  expect([k.byScenario.mix.n, k.byScenario.low.n, k.byScenario.high.n]).toEqual([325, 325, 325]);
  expect(k.contract).toMatchObject({ value: 100, validated: true });
  await openBudget(page, 'bk-6');
  await expect(page.locator('.prod-budget')).toContainText('Équilibre du spectacle non calculable');
  await expect(page.locator('.prod-budget')).toContainText('ce n’est pas un équilibre économique');
  expectClean(ctx);
});

test('v1.58.1 relecture : clôture d’avant la v1.58 en perte affichée au % de l’époque ; production avec partenaire de commission : L’ArtBo porte la perte ; % hors 0–100 refusé', async ({ page }) => {
  const ctx = await openApp(page);
  const snap = { result: -1000, shared_result: -1000, artbo_share: 60, artbo_part: -600, partner_part: -400, partner: 'Coprod Fictif', net_encaisse: 0, paid_artbo: 0, paid_partner: 0, transfer: 0, from: null, to: null };
  await seed(page, { shows: [
      { ...BASE, id: 'bk-7', date: `${Y}-03-16`, contract_type: 'Co-Production', partner_id: 'part-1', production: PROD({ artbo_share: 60 }),
        result_closed: snap, result_closed_at: `${Y}-03-17T10:00:00Z`, result_closed_by: 'equipe@exemple.invalid' },
      { ...BASE, id: 'bk-8', date: `${Y}-03-18`, contract_type: 'Production', partner_id: 'part-1', production: PROD({ tickets: [{ label: 'Plein', qty: 100, price: 21.1 }] }) }],
    budget_lines: [{ id: 'bk-l8', project_id: 'art-a', show_id: 'bk-8', category: 'Salle', label: 'Coûts', forecast: 5000, payer: 'artbo' }] });
  await openBudget(page, 'bk-7');
  const blk = page.locator('.coprod-block');
  await expect(blk).toContainText('pertes : 60 %, % appliqué à la clôture');
  await expect(blk).not.toContainText('% non renseigné');
  // production (pas une coproduction) : le partenaire de commission ne partage pas le résultat ; perte portée par L'ArtBo
  const f = await page.evaluate(async () => { const p = await import('./js/production-budget.js'); const { byId } = await import('./js/selectors.js');
    const b = p.productionBudget(byId('shows', 'bk-8')); return { artbo: b.artbo, partner: b.partner, lossMissing: b.lossMissing }; });
  expect(f).toEqual({ artbo: -3000, partner: 0, lossMissing: false });
  await openBudget(page, 'bk-8');
  const lossIn = page.locator('[data-prod-show="bk-8"][data-prod-path="artbo_loss_share"]');
  await lossIn.fill('150'); await lossIn.dispatchEvent('change');
  await expect(page.locator('.toast')).toContainText('entre 0 et 100');
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'bk-8').production.artbo_loss_share ?? null)).toBeNull();
  expectClean(ctx);
});
