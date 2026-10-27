// Lot V1.51 — coréalisation, coproduction, taxe CNM (décisions d'Anthony du 27/10/2026, soir). Données FICTIVES.
//  - CNM : gratuit → taux × cession HT ; payant → taux × TOTALITÉ des recettes HT ; taux de la date sinon Réglages ;
//    structure qui supporte le coût (usage : gratuit → L'ArtBo, payant → organisateur ; coréalisation payante : à attribuer) ;
//    une dépense CNM / SACEM réelle remplace la charge calculée ; plus de bouton « Ajouter la taxe CNM » aux factures.
//  - Coréalisation : MG + part du résultat net au-delà du break ; break validé à la main ; ventes exactes par tarif, sinon
//    fourchette + prorata appliqué seulement après validation ; charges du contrat chacune une fois ; CNM jamais sur le seul au-delà.
//  - Coproduction : structure qui encaisse, positions réelles, reversement, clôture (synthèse, confirmation, rpc), verrou, réouverture motivée.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) {
      for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); }
      touch(table);
    }
  }, tables);
}
const set = (page, id, patch) => page.evaluate(async ([i, p]) => {
  const { S, touch } = await import('./js/state.js');
  Object.assign(S.db.shows.find(s => s.id === i), p); Object.assign(window.__DB.shows.find(s => s.id === i), p); touch('shows');
}, [id, patch]);
const openBudget = (page, id) => page.evaluate(async i => {
  const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  app.go('production'); S.openProd.add(i); S.tab['prod:' + i] = 'budget'; app.render();
}, id);

const BASE = { project_id: 'art-a', structure_id: 'st-1', venue: 'Salle Témoin', city: 'Villeexemple', department: '75', status: 'Confirmée Salle', prod_mode: 'production', vat_rate: 5.5 };

test('v1.51 CNM : gratuit = taux × cession ; taux de la date ; coût supporté par l’organisateur = hors budget ; payant = rien supposé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [
    { ...BASE, id: 'g-1', date: `${Y}-07-01`, contract_type: 'Cession', fee_ht: 10000, ticketing_type: 'Gratuit' },
    { ...BASE, id: 'p-1', date: `${Y}-07-02`, contract_type: 'Cession', fee_ht: 8000, ticketing_type: 'Payant/Prix Libre' },
    { ...BASE, id: 'c-1', date: `${Y}-07-03`, contract_type: 'Co-Réalisation', fee_ht: 3000, ticketing_type: 'Payant/Prix Libre' },
  ] });
  const r = await page.evaluate(async () => {
    const c = await import('./js/corea.js'), b = await import('./js/budget.js'), { byId } = await import('./js/selectors.js');
    const one = id => { const s = byId('shows', id), x = c.cnmOf(s); return [x.amount, x.bearer, b.cnmDue(s)]; };
    const out = [one('g-1'), one('p-1'), one('c-1')];
    byId('shows', 'g-1').cnm_pct = 2; out.push(one('g-1'));
    byId('shows', 'g-1').cnm_bearer = 'organisateur'; out.push(one('g-1'));
    return out;
  });
  expect(r).toEqual([[350, 'artbo', true], [null, 'organisateur', false], [0, null, false], [200, 'artbo', true], [200, 'organisateur', false]]);
  expectClean(ctx);
});

test('v1.51 CNM : une dépense CNM réelle remplace le calcul (budget de tournée et budget de production) ; taux des Réglages', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, {
    shows: [{ ...BASE, id: 'g-2', date: `${Y}-08-01`, contract_type: 'Cession', fee_ht: 10000, ticketing_type: 'Gratuit' },
      { ...BASE, id: 'pr-9', date: `${Y}-08-02`, contract_type: 'Production', fee_ht: 0, capacity: 500,
        production: { vat: 5.5, sacem_pct: 0, tickets: [{ label: 'Plein', qty: 211, price: 21.1, real_qty: 211 }] } }],
    budget_lines: [{ id: 'bl-a', show_id: 'g-2', project_id: 'art-a', category: 'Taxes', label: 'Taxe CNM (entrée gratuite)', supplier: 'CNM', auto: 'cnm', sort: 1 },
      { id: 'bl-r', show_id: 'g-2', project_id: 'art-a', category: 'Taxes', label: 'Taxe CNM', supplier: 'CNM', amount: 360, sort: 2 },
      { id: 'bl-p', show_id: 'pr-9', project_id: 'art-a', category: 'Taxes', label: 'Déclaration CNM', supplier: 'CNM', amount: 160, sort: 1 },
      { id: 'bl-s', show_id: 'pr-9', project_id: 'art-a', category: 'Salle', label: 'Location', forecast: 1000, amount: 1000, sort: 2 }],
  });
  const r = await page.evaluate(async () => {
    const b = await import('./js/budget.js'), pb = await import('./js/production-budget.js'), { byId } = await import('./js/selectors.js');
    const { S } = await import('./js/state.js');
    const auto = S.db.budget_lines.find(l => l.id === 'bl-a');
    const f = pb.productionBudget(byId('shows', 'pr-9')), re = pb.productionBudget(byId('shows', 'pr-9'), true);
    S.db.settings.find(x => x.key === 'default_cnm_pct').value = 4;
    const f4 = pb.productionBudget(byId('shows', 'pr-9'));
    return { tournee: [b.lineForecast(auto), b.showBudget(byId('shows', 'g-2')).expenses], prevu: [f.ht, f.cnm, f.costs], reel: [re.cnm, re.costs], reglages: f4.cnm };
  });
  // tournée : la ligne automatique tombe à 0, seule la dépense réelle de 360 € compte
  expect(r.tournee).toEqual([0, 360]);
  // production : 211 × 21,10 TTC = 4 452,10 → 4 220 HT ; CNM prévue 3,5 % × 4 220 = 147,70 ; la ligne CNM n'est jamais un coût
  expect(r.prevu).toEqual([4220, 147.7, 1000]);
  expect(r.reel).toEqual([160, 1000]);
  expect(r.reglages).toBe(168.8);
  expectClean(ctx);
});

test('v1.51 coréalisation : break à valider, ventes exactes par tarif, sinon fourchette + prorata seulement après validation ; MG + part', async ({ page }) => {
  const ctx = await openApp(page);
  const tiers = [{ label: 'Plein', price: 21.1, vat: 5.5, qty: 300 }, { label: 'Réduit', price: 10.55, vat: 5.5, qty: 200 }];
  await seed(page, { shows: [{ ...BASE, id: 'co-1', date: `${Y}-09-01`, contract_type: 'Co-Réalisation', fee_ht: 3000, ticketing_type: 'Payant/Prix Libre',
    break_even: 400, cr_producer_pct: 60, corea: { tiers } }] });
  const calc = () => page.evaluate(async () => { const c = await import('./js/corea.js'), { byId } = await import('./js/selectors.js'); const k = c.coreaCalc(byId('shows', 'co-1'));
    return { ht: k.ht, beyond: k.beyond, validated: k.validated, revenue: k.revenue, range: k.range, net: k.net, share: k.share, total: k.total, issues: k.issues }; });
  let k = await calc();
  // 300 × 20 + 200 × 10 = 8 000 € HT ; 100 billets après le break ; break pas validé : aucun partage
  expect([k.ht, k.beyond, k.validated, k.revenue, k.share]).toEqual([8000, 100, false, null, null]);
  await set(page, 'co-1', { corea: { tiers, break_validated_at: '2026-10-27T20:00:00Z', break_value: 400 } });
  k = await calc();
  // fourchette : 100 réduits = 1 000 ; 100 pleins = 2 000 ; prorata 100/500 × 8 000 = 1 600 ; rien n'est retenu sans validation
  expect([k.validated, k.range, k.revenue]).toEqual([true, { min: 1000, max: 2000, prorata: 1600 }, null]);
  await set(page, 'co-1', { corea: { tiers, break_validated_at: '2026-10-27T20:00:00Z', break_value: 400, method: { kind: 'prorata', at: '2026-10-27T20:05:00Z', by: 'testeur@example.com' } } });
  k = await calc();
  expect([k.revenue, k.net, k.share, k.total]).toEqual([1600, 1600, 960, 3960]);
  // ventes exactes : 70 pleins + 30 réduits après le break → 1 700 ; charges du contrat 200 + CNM (3,5 % de 8 000 = 280) → 1 220 ; 60 % = 732
  const exact = [{ ...tiers[0], after: 70 }, { ...tiers[1], after: 30 }];
  await set(page, 'co-1', { cnm_in_result: true, corea: { tiers: exact, break_validated_at: '2026-10-27T20:00:00Z', break_value: 400, charges: [{ label: 'Frais de billetterie', amount: 200 }] } });
  k = await calc();
  expect([k.revenue, k.net, k.share, k.total]).toEqual([1700, 1220, 732, 3732]);
  // ventes après le break incohérentes : rien n'est calculé, message ; break changé : validation caduque
  await set(page, 'co-1', { corea: { tiers: [{ ...tiers[0], after: 70 }, { ...tiers[1], after: 10 }], break_validated_at: '2026-10-27T20:00:00Z', break_value: 400 } });
  k = await calc();
  expect(k.revenue).toBeNull(); expect(k.issues.join(' ')).toContain('80 saisies pour 100 attendues');
  await set(page, 'co-1', { break_even: 450 });
  expect((await calc()).validated).toBe(false);
  // résultat négatif : pas de part, le MG reste acquis
  await set(page, 'co-1', { break_even: 400, cnm_in_result: false, corea: { tiers: exact, break_validated_at: '2026-10-27T20:00:00Z', break_value: 400, charges: [{ label: 'Location technique', amount: 5000 }] } });
  k = await calc();
  expect([k.net, k.share, k.total]).toEqual([-3300, 0, 3000]);
  expectClean(ctx);
});

test('v1.51 coréalisation (écran) : valider le break puis le prorata ; la part se prépare en ligne de facture à la demande', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [{ ...BASE, id: 'co-2', date: `${Y}-09-02`, contract_type: 'Co-Réalisation', fee_ht: 3000, ticketing_type: 'Payant/Prix Libre',
    break_even: 400, cr_producer_pct: 50, corea: { tiers: [{ label: 'Plein', price: 21.1, vat: 5.5, qty: 500 }] } }] });
  await openBudget(page, 'co-2');
  const blk = page.locator('.corea-block');
  await expect(blk).toContainText('Partage non calculé : le break doit être validé');
  await blk.locator('[data-act="coreaValidateBreak"]').click();
  await page.locator('dialog.ask button', { hasText: 'Valider le break' }).click();
  await expect(blk.locator('[data-act="coreaValidateProrata"]')).toBeVisible();
  await blk.locator('[data-act="coreaValidateProrata"]').click();
  await page.locator('dialog.ask button', { hasText: 'Valider le prorata' }).click();
  // 100 billets × 20 € HT = 2 000 ; 50 % = 1 000 ; rémunération = MG 3 000 + 1 000
  await expect(blk).toContainText('Méthode retenue pour cette date : prorata des ventes');
  await expect(blk.locator('tr', { hasText: 'Rémunération du producteur' })).toContainText(/4\s000,00/);
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'co-2').corea.method.kind)).toBe('prorata');
  await blk.locator('[data-act="coreaPrepareInvoice"]').click();
  await page.locator('dialog.ask button', { hasText: 'Préparer la ligne' }).click();
  await expect.poll(() => page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'co-2' && p.kind === 'autre').map(p => [p.label, p.amount]))).toEqual([['Part du résultat (coréalisation)', 1000]]);
  expectClean(ctx);
});

const COPRO = { ...BASE, id: 'cp-9', date: `${Y}-10-01`, contract_type: 'Co-Production', fee_ht: 0, partner_id: 'pa-x', capacity: 600,
  production: { vat: 5.5, sacem_pct: 0, artbo_share: 50, tickets: [{ label: 'Plein', qty: 500, price: 21.1, real_qty: 500 }] } };

test('v1.51 coproduction : clôture refusée tant que tout n’est pas cohérent ; synthèse, reversement, rpc close_result ; pas de devis Pennylane', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { partners: [{ id: 'pa-x', name: 'Coprod Fictive' }], shows: [{ ...COPRO }],
    budget_lines: [{ id: 'cl-1', show_id: 'cp-9', project_id: 'art-a', category: 'Salle', label: 'Location salle', forecast: 3000, amount: 3000, payer: 'partenaire', paid_at: `${Y}-10-02`, sort: 1 },
      { id: 'cl-2', show_id: 'cp-9', project_id: 'art-a', category: 'Promoteur', label: 'Technique', forecast: 1000, sort: 2 }] });
  await openBudget(page, 'cp-9');
  const blk = page.locator('.coprod-block');
  await expect(blk).toContainText('Indique qui encaisse les recettes');
  await expect(blk).toContainText('1 dépense seulement prévue');
  await expect(blk.locator('[data-act="closeResult"]')).toBeDisabled();
  // données complètes : technique payée par L'ArtBo, recettes encaissées par L'ArtBo
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) Object.assign(db.budget_lines.find(l => l.id === 'cl-2'), { amount: 1000, payer: 'artbo', paid_at: '2026-10-02' });
    touch('budget_lines'); });
  await set(page, 'cp-9', { ticket_holder: 'artbo' });
  await openBudget(page, 'cp-9');
  // recette 500 × 20 = 10 000 HT ; CNM 350 ; résultat 10 000 − 350 − 4 000 = 5 650 ; 50/50 = 2 825 chacun
  // L'ArtBo garde 9 650 net et a payé 1 000 → position 8 650 ; part due 2 825 → L'ArtBo reverse 5 825 au coproducteur
  await expect(blk).toContainText(/L’ArtBoristerie reverse 5\s825,00/);
  await blk.locator('[data-act="closeResult"]').click();
  await expect(page.locator('dialog.ask')).toContainText(/Résultat global réel : 5\s650,00/);
  await page.locator('dialog.ask button', { hasText: 'Clôturer le résultat' }).click();
  const call = await page.evaluate(() => window.__calls.find(c => c.rpc === 'close_result'));
  expect(call.args.p_show).toBe('cp-9');
  expect(call.args.p_snapshot).toMatchObject({ result: 5650, artbo_part: 2825, partner_part: 2825, transfer: 5825, from: 'artbo', to: 'partenaire', holder: 'artbo' });
  // pas de devis Pennylane pour une coproduction
  expect(await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
    S.tab['prod:cp-9'] = 'factures'; app.render(); return document.querySelectorAll('[data-act="pennylaneQuote"]').length; })).toBe(0);
  expectClean(ctx);
});

test('v1.51 coproduction clôturée : saisies désactivées, réouverture avec motif obligatoire (rpc reopen_result) ; plus de bouton CNM aux factures', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { partners: [{ id: 'pa-x', name: 'Coprod Fictive' }], shows: [{ ...COPRO, ticket_holder: 'artbo', result_closed_at: '2026-10-27T20:00:00Z', result_closed_by: 'testeur@example.com',
    result_closed: { result: 100, artbo_share: 50, artbo_part: 50, partner_part: 50, partner: 'Coprod Fictive', net_encaisse: 100, paid_artbo: 0, paid_partner: 0, transfer: 50, from: 'artbo', to: 'partenaire' } }] });
  await openBudget(page, 'cp-9');
  await expect(page.locator('fieldset.lock-set[disabled]')).toHaveCount(1);
  await expect(page.locator('fieldset.lock-set input').first()).toBeDisabled();
  await expect(page.locator('.coprod-block')).toContainText('Clôturé le 27/10/2026');
  await page.locator('[data-act="reopenResult"]').click();
  await page.locator('dialog.ask input, dialog.ask textarea').first().fill('Facture du technicien reçue après la clôture');
  await page.locator('dialog.ask button', { hasText: 'Rouvrir le résultat' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls.find(c => c.rpc === 'reopen_result')?.args)).toEqual({ p_show: 'cp-9', p_reason: 'Facture du technicien reçue après la clôture' });
  expect(await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
    S.tab['prod:sh-1'] = 'factures'; S.openProd.add('sh-1'); app.render(); return document.querySelectorAll('[data-kind="cnm"]').length; })).toBe(0);
  expectClean(ctx);
});
