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
  await set(page, 'co-1', { corea: { tiers, break_validated_at: '2026-10-27T20:00:00Z', break_value: 400, method: { kind: 'prorata', at: '2026-10-27T20:05:00Z', by: 'testeur@example.com', sig: '500|8000|400' } } });
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
  await expect(blk.locator('tr', { hasText: 'Rémunération brute' })).toContainText(/4\s000,00/);
  // commission (20 %, Réglages production) sur MG + part : 800 ; nette 3 200 ; part pas encore validée → pas de ligne de facture
  await expect(blk.locator('tr', { hasText: 'Commission L’ArtBo' })).toContainText(/800,00/);
  await expect(blk.locator('tr', { hasText: 'Rémunération nette' })).toContainText(/3\s200,00/);
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'co-2').corea.method.kind)).toBe('prorata');
  await expect(blk.locator('[data-act="coreaPrepareInvoice"]')).toHaveCount(0);
  await blk.locator('[data-act="coreaValidateShare"]').click();
  await expect(page.locator('dialog.ask')).toContainText(/Commission L’ArtBo \(20\s?%\) : 800,00/);
  await page.locator('dialog.ask button', { hasText: 'Valider la part' }).click();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.id === 'co-2').corea_share)).toBe(1000);
  await blk.locator('[data-act="coreaPrepareInvoice"]').click();
  await page.locator('dialog.ask button', { hasText: 'Préparer la ligne' }).click();
  await expect.poll(() => page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'co-2' && p.kind === 'autre').map(p => [p.label, p.amount]))).toEqual([['Part du résultat (coréalisation)', 1000]]);
  expectClean(ctx);
});

const COPRO = { ...BASE, id: 'cp-9', date: `${Y}-10-01`, contract_type: 'Co-Production', fee_ht: 0, partner_id: 'pa-x', capacity: 600,
  production: { vat: 5.5, sacem_pct: 0, artbo_share: 50, receipts_cashed_at: `${Y}-10-05`, tickets: [{ label: 'Plein', qty: 500, price: 21.1, real_qty: 500 }] } };

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
  await expect(page.locator('fieldset.lock-set[disabled]')).toHaveCount(2);
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

test('v1.51 relecture : taxes réelles payées par chacun (reversement juste), doubles comptages bloquants, prorata lié aux chiffres, étranger', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { partners: [{ id: 'pa-x', name: 'Coprod Fictive' }],
    shows: [{ ...COPRO, id: 'cp-b', ticket_holder: 'partenaire' },
      { ...BASE, id: 'co-b', date: `${Y}-09-03`, contract_type: 'Co-Réalisation', fee_ht: 3000, ticketing_type: 'Payant/Prix Libre', break_even: 400, cr_producer_pct: 50,
        corea: { tiers: [{ label: 'Plein', price: 21.1, vat: 5.5, qty: 500 }], break_validated_at: '2026-10-27T20:00:00Z', break_value: 400 } },
      { ...BASE, id: 'g-b', date: `${Y}-09-04`, contract_type: 'Cession', fee_ht: 10000, ticketing_type: 'Gratuit', department: 'CH' },
      { ...BASE, id: 'g-c', date: `${Y}-09-05`, contract_type: 'Cession', fee_ht: 10000, ticketing_type: 'Gratuit' }],
    budget_lines: [{ id: 'tx-1', show_id: 'cp-b', project_id: 'art-a', category: 'Taxes', label: 'SACEM', supplier: 'SACEM', amount: 880, payer: 'artbo', paid_at: `${Y}-10-02`, sort: 1 },
      { id: 'cn-a', show_id: 'g-c', project_id: 'art-a', category: 'Taxes', label: 'Taxe CNM (entrée gratuite)', supplier: 'CNM', auto: 'cnm', sort: 1 },
      { id: 'cn-m', show_id: 'g-c', project_id: 'art-a', category: 'Taxes', label: 'Taxe CNM', supplier: 'CNM', forecast: 300, sort: 2 }] });
  const r = await page.evaluate(async () => {
    const pb = await import('./js/production-budget.js'), c = await import('./js/corea.js'), b = await import('./js/budget.js'), { byId } = await import('./js/selectors.js');
    const { S } = await import('./js/state.js');
    const k = pb.coprodClose(byId('shows', 'cp-b')).snapshot;
    const co = byId('shows', 'co-b'), out = { copro: [k.result, k.net_encaisse, k.paid_artbo, k.transfer, k.from, k.to] };
    co.corea.method = { kind: 'prorata', at: 'x', sig: c.coreaCalc(co).sig }; out.prorata = c.coreaCalc(co).revenue;
    co.corea.tiers[0].qty = 520; out.apresModif = c.coreaCalc(co).revenue;   // tarifs changés : nouvelle validation nécessaire
    co.corea.tiers[0].qty = 500; co.corea.charges = [{ label: 'Taxe CNM', amount: 350 }]; out.cnmCharge = c.coreaCalc(co).net;
    co.corea.charges = [{ label: 'MG artiste', amount: 3000 }]; out.mgCharge = c.coreaCalc(co).net;
    co.corea.charges = []; co.cr_producer_pct = 120; out.pct = c.coreaCalc(co).share;
    out.etranger = c.cnmOf(byId('shows', 'g-b')).amount;
    out.copieDeBudget = b.lineForecast(S.db.budget_lines.find(l => l.id === 'cn-a'));
    return out;
  });
  // 10 000 HT − CNM calculée 350 − SACEM réelle 880 = 8 770 ; 4 385 chacun. Le coproducteur encaisse et garde 10 000 − 350 = 9 650 ;
  // L'ArtBo a payé la SACEM (880) → le coproducteur reverse 4 385 + 880 = 5 265 à L'ArtBo
  expect(r.copro).toEqual([8770, 9650, 880, 5265, 'partenaire', 'artbo']);
  expect([r.prorata, r.apresModif, r.cnmCharge, r.mgCharge, r.pct, r.etranger, r.copieDeBudget]).toEqual([2000, null, null, null, null, 0, 0]);
  expectClean(ctx);
});

// ─────────── Corrections du 27/10 au soir : commission sur MG + part ; clôture bloquée par un impayé ; promotion locale ───────────
const TIERS = n => [{ label: 'Plein', price: 21.1, vat: 5.5, qty: n }];   // 21,10 TTC = 20 € HT
const COREA = (id, project, qty) => ({ ...BASE, id, project_id: project, date: `${Y}-09-0${id.length}`, contract_type: 'Co-Réalisation', fee_ht: 3000, ticketing_type: 'Payant/Prix Libre',
  break_even: 400, cr_producer_pct: 50, corea: { tiers: TIERS(qty), break_validated_at: '2026-10-27T20:00:00Z', break_value: 400,
    method: { kind: 'prorata', at: '2026-10-27T20:05:00Z', by: 'testeur@example.com', sig: `${qty}|${qty * 20}|400` } } });

test('v1.51 commission en coréalisation : 20 % (Réglages) et 15 % (artiste), avec et sans break dépassé ; jamais deux fois ; jamais une charge', async ({ page }) => {
  const ctx = await openApp(page);
  // « Artiste Lambda » : commission de l'artiste à 15 % même en production (comme The Locos) — paramétrage, aucun nom en dur
  await seed(page, { projects: [{ id: 'art-l', name: 'Artiste Lambda', active: true, mode: 'production', default_artbo_pct: 15 }],
    shows: [COREA('c20', 'art-a', 500), COREA('c15', 'art-l', 500), COREA('c20b', 'art-a', 400), COREA('c15b', 'art-l', 400),
      { ...BASE, id: 'ces', date: `${Y}-09-09`, contract_type: 'Cession', fee_ht: 3000, corea_share: 1000 }],
    show_payments: ['c20', 'c15', 'c20b', 'c15b', 'ces'].map((id, i) => ({ id: 'com-' + id, show_id: id, kind: 'artbo', sort: 90 + i })) });
  const st = () => page.evaluate(async () => {
    const b = await import('./js/budget.js'), c = await import('./js/calc.js'), co = await import('./js/corea.js'), { byId } = await import('./js/selectors.js');
    return Object.fromEntries(['c20', 'c15', 'c20b', 'c15b', 'ces'].map(id => { const s = byId('shows', id), k = co.coreaCalc(s), sb = b.showBudget(s);
      return [id, { share: k?.share ?? null, line: c.payAmount(byId('show_payments', 'com-' + id)), com: b.commissionAmount(s), gross: sb.gross, available: sb.available, net: k?.net ?? null }]; }));
  });
  let r = await st();
  // part calculée (100 billets × 20 € × 50 % = 1 000) pas encore validée : commission provisoire sur le MG seul
  expect([r.c20.share, r.c20.line, r.c20.com, r.c20.gross]).toEqual([1000, 600, 600, 3000]);
  expect([r.c15.share, r.c15.line, r.c15.com]).toEqual([1000, 450, 450]);
  // break non dépassé (400 vendus pour un break de 400) : part nulle
  expect([r.c20b.share, r.c15b.share]).toEqual([0, 0]);
  // parts validées
  for (const [id, v] of [['c20', 1000], ['c15', 1000], ['c20b', 0], ['c15b', 0]]) await set(page, id, { corea_share: v });
  r = await st();
  // 20 % : (3 000 + 1 000) × 20 % = 800 ; nette 3 200 — 15 % : 600 ; nette 3 400
  expect([r.c20.line, r.c20.com, r.c20.gross, r.c20.available]).toEqual([800, 800, 4000, 3200]);
  expect([r.c15.line, r.c15.com, r.c15.gross, r.c15.available]).toEqual([600, 600, 4000, 3400]);
  // sans break dépassé : sur le MG seul (600 / 450)
  expect([r.c20b.line, r.c20b.available, r.c15b.line, r.c15b.available]).toEqual([600, 2400, 450, 2550]);
  // la commission n'entre pas dans le résultat partagé (net inchangé par le taux) ; hors coréalisation, aucune part dans la base
  expect([r.c20.net, r.c15.net]).toEqual([2000, 2000]);
  expect([r.ces.line, r.ces.gross]).toEqual([600, 3000]);
  // une commission figée (versée / facturée) garde son montant : jamais recalculée
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.show_payments.find(p => p.id === 'com-c20').amount = 600; touch('show_payments'); });
  expect((await st()).c20.line).toBe(600);
  // une « charge » commission dans le partage : bloquante
  await set(page, 'c15', { corea: { ...(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'c15').corea)), charges: [{ label: 'Commission agent', amount: 100 }] } });
  const k = await page.evaluate(async () => { const co = await import('./js/corea.js'), { byId } = await import('./js/selectors.js'); return co.coreaCalc(byId('shows', 'c15')); });
  expect(k.net).toBeNull(); expect(k.issues.join(' ')).toContain('jamais une charge du résultat partagé');
  // la part validée ne change pas si une commission émise sans montant figé en dépend (garde de l'application, comme la base)
  const why = await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); const c = await import('./js/calc.js');
    Object.assign(S.db.show_payments.find(p => p.id === 'com-c15'), { paid_at: '2026-10-20' });   // production : commission versée (sans montant figé, comme l'historique) touch('show_payments');
    return c.changeBlocked('shows', 'c15', { corea_share: 1500 }); });
  expect(why).toContain('modifierait leur montant');
  // part validée qui n'est plus calculable (break à revalider) : signalée à l'écran, jamais retirée en silence
  await set(page, 'c20', { break_even: 450 });
  await openBudget(page, 'c20');
  await expect(page.locator('.corea-block')).toContainText('la part n’est plus calculable');
  expectClean(ctx);
});

test('v1.51 clôture de coproduction : une dépense restant à payer bloque ; promotion locale : débiteur et payeur saisis, jamais présumés', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { partners: [{ id: 'pa-x', name: 'Coprod Fictive' }],
    shows: [{ ...COPRO, ticket_holder: 'artbo', production: { ...COPRO.production, promo_net_pct: 10 } }],
    budget_lines: [{ id: 'cl-1', show_id: 'cp-9', project_id: 'art-a', category: 'Salle', label: 'Location salle', forecast: 3000, amount: 3000, payer: 'partenaire', paid_at: `${Y}-10-02`, sort: 1 },
      { id: 'cl-2', show_id: 'cp-9', project_id: 'art-a', category: 'Promoteur', label: 'Technique', forecast: 1000, amount: 1000, payer: 'artbo', sort: 2 }] });
  const close = () => page.evaluate(async () => { const { coprodClose } = await import('./js/production-budget.js'), { byId } = await import('./js/selectors.js');
    const k = coprodClose(byId('shows', 'cp-9')); return { ok: k.ok, issues: k.issues.join(' | '), x: k.snapshot }; });
  let k = await close();
  // recettes encaissées (date notée dans COPRO) : pas de blocage à ce titre
  expect(k.issues).not.toContain('pas encore notées encaissées');
  // technique non payée + promo sans débiteur, payeur ni date : clôture bloquée ; le résultat prévisionnel reste calculé
  expect(k.ok).toBe(false);
  expect(k.issues).toContain('1 dépense réelle pas encore payée');
  expect(k.issues).toContain('Promotion locale : indique à qui elle incombe');
  expect(k.issues).toContain('Promotion locale : indique qui l’a réellement payée');
  expect(k.issues).toContain('pas encore payée : note sa date de paiement');
  // 10 000 HT − CNM 350 = 9 650 ; promo 10 % = 965 ; résultat 9 650 − 4 000 − 965 = 4 685
  expect([k.x.promo, k.x.result]).toEqual([965, 4685]);
  await openBudget(page, 'cp-9');
  await expect(page.locator('.coprod-block [data-act="closeResult"]')).toBeDisabled();
  await expect(page.locator('.coprod-block')).toContainText('pas encore payée');
  // saisie à l'écran : promo charge commune, payée par le coproducteur ; technique payée
  await page.locator('.coprod-block select[data-prod-path="promo_debtor"]').selectOption('commun');
  await page.locator('.coprod-block select[data-prod-path="promo_payer"]').selectOption('partenaire');
  await page.locator('.coprod-block input[data-prod-path="promo_paid_at"]').fill(`${Y}-10-03`);
  await page.locator('.coprod-block input[data-prod-path="promo_paid_at"]').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => { const p = window.__DB.shows.find(s => s.id === 'cp-9').production; return [p.promo_debtor, p.promo_payer, p.promo_paid_at, p.promo_net_pct]; }))
    .toEqual(['commun', 'partenaire', `${Y}-10-03`, 10]);
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) db.budget_lines.find(l => l.id === 'cl-2').paid_at = '2026-10-02'; touch('budget_lines'); });
  k = await close();
  // charge commune : 4 685 / 2 = 2 342,50 chacun ; L'ArtBo garde 9 650 (promo non présumée chez elle), a payé 1 000 → position 8 650
  // le coproducteur a payé 3 000 + 965 de promo ; L'ArtBo reverse 8 650 − 2 342,50 = 6 307,50
  expect(k.ok).toBe(true);
  expect(k.x).toMatchObject({ result: 4685, shared_result: 4685, artbo_part: 2342.5, partner_part: 2342.5, net_encaisse: 9650, paid_artbo: 1000, paid_partner: 3965, transfer: 6307.5, from: 'artbo', to: 'partenaire' });
  // promo à la charge de L'ArtBo seule : hors du résultat partagé (5 650 / 2 = 2 825), retirée de sa part → 1 860 ; coproducteur 2 825
  await set(page, 'cp-9', { production: { ...(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'cp-9').production)), promo_debtor: 'artbo' } });
  k = await close();
  expect(k.x).toMatchObject({ result: 4685, shared_result: 5650, artbo_part: 1860, partner_part: 2825, transfer: 6790, from: 'artbo' });
  // promotion locale négative (taux négatif) : bloquante
  await set(page, 'cp-9', { production: { ...(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'cp-9').production)), promo_net_pct: -10 } });
  k = await close();
  expect(k.ok).toBe(false); expect(k.issues).toContain('Promotion locale négative');
  expectClean(ctx);
});

// ─────────── Décisions définitives du 27/10 (22 h 36) : coréalisation en booking, versement provisoire, régularisation ───────────
const openTab = (page, id, tab) => page.evaluate(async ([i, t]) => {
  const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  app.go('production'); S.openProd.add(i); S.tab['prod:' + i] = t; app.render();
}, [id, tab]);
const BOOK = (id, project) => ({ ...BASE, id, project_id: project, prod_mode: 'booking', date: `${Y}-11-0${id.length}`, contract_type: 'Co-Réalisation', fee_ht: 3000, break_even: 400 });
const PROJS = [{ id: 'art-p20', name: 'Artiste Vingt', active: true, mode: 'booking', default_artbo_pct: 20 }, { id: 'art-l', name: 'Artiste Lambda', active: true, mode: 'production', default_artbo_pct: 15 }];

test('v1.51 coréalisation en booking (Conditions) : part saisie puis validée ; commission provisoire puis définitive ; 20 % et 15 % ; avec et sans break dépassé ; Factures cohérent', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { projects: PROJS, shows: [BOOK('b20', 'art-p20'), BOOK('b15', 'art-l'), BOOK('b20z', 'art-p20')],
    show_payments: ['b20', 'b15', 'b20z'].map((id, i) => ({ id: 'cb-' + id, show_id: id, kind: 'artbo', sort: 90 + i })) });
  const amounts = () => page.evaluate(async () => { const c = await import('./js/calc.js'), { byId } = await import('./js/selectors.js');
    return ['b20', 'b15', 'b20z'].map(id => c.payAmount(byId('show_payments', 'cb-' + id))); });
  // pas de budget de production imposé : pas d'onglet Budget en booking
  await openTab(page, 'b20', 'conditions');
  await expect(page.locator('[data-act="prodTab"][data-tab="budget"], .tabs [data-tab="budget"]')).toHaveCount(0);
  const blk = page.locator('.corea-block');
  await expect(blk).toContainText('MG HT (cachet)');
  await expect(blk).toContainText(/600,00.*provisoire : sur le MG seul/);
  expect(await amounts()).toEqual([600, 450, 600]);
  // part saisie (break dépassé) puis validée explicitement : (3 000 + 1 000) × 20 % = 800
  await blk.locator('input[data-corea-path="booking_share"]').fill('1000');
  await blk.locator('input[data-corea-path="booking_share"]').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.id === 'b20').corea?.booking_share)).toBe(1000);
  expect((await amounts())[0]).toBe(600);   // saisie seule : rien de définitif
  await blk.locator('[data-act="coreaValidateShare"]').click();
  await expect(page.locator('dialog.ask')).toContainText(/Commission L’ArtBo \(20\s?%\) : 800,00/);
  await page.locator('dialog.ask button', { hasText: 'Valider la part' }).click();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.id === 'b20').corea_share)).toBe(1000);
  await expect(blk).toContainText(/800,00.*définitive/);
  // 15 % (paramétrage de l'artiste) : (3 000 + 1 000) × 15 % = 600 ; break non dépassé : part 0 → MG seul (600)
  await set(page, 'b15', { corea_share: 1000, corea: { booking_share: 1000 } });
  await set(page, 'b20z', { corea_share: 0, corea: { booking_share: 0 } });
  expect(await amounts()).toEqual([800, 600, 600]);
  // Factures reprend exactement les montants validés dans Conditions ; aucune facture créée
  await openTab(page, 'b20', 'factures');
  await expect(page.locator('.prod-bill')).toContainText('sur MG + part validée (4 000,00');
  expect(await page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'b20').length)).toBe(1);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'pennylane').length)).toBe(0);
  expectClean(ctx);
});

test('v1.51 versement / facturation avant validation : avertissement non bloquant, confirmation explicite ; régularisation affichée après validation, montant historique conservé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { projects: PROJS, shows: [BOOK('b20', 'art-p20'), { ...COREA('p15', 'art-l', 500) }],
    show_payments: [{ id: 'cb-b20', show_id: 'b20', kind: 'artbo', sort: 90 }, { id: 'cp-p15', show_id: 'p15', kind: 'artbo', sort: 90 }] });
  // booking : facture notée envoyée avant validation → question ; « Annuler » n'écrit rien
  await page.evaluate(async () => { const d = await import('./js/data.js'); window.__p = d.save('show_payments', 'cb-b20', { sent_at: '2026-10-20', invoice_number: 'F-TEST-9' }); });
  await expect(page.locator('dialog.ask')).toContainText('n’est pas encore validée');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  await page.evaluate(() => window.__p);
  expect(await page.evaluate(() => window.__DB.show_payments.find(p => p.id === 'cb-b20').sent_at ?? null)).toBeNull();
  // confirmé à titre provisoire : enregistré, montant figé sur le MG seul (600)
  await page.evaluate(async () => { const d = await import('./js/data.js'); window.__p = d.save('show_payments', 'cb-b20', { sent_at: '2026-10-20', invoice_number: 'F-TEST-9' }); });
  await page.locator('dialog.ask button', { hasText: 'à titre provisoire' }).click();
  await page.evaluate(() => window.__p);
  await expect.poll(() => page.evaluate(() => { const p = window.__DB.show_payments.find(x => x.id === 'cb-b20'); return [p.sent_at, Number(p.amount)]; })).toEqual(['2026-10-20', 600]);
  // production : versement de commission avant validation → même question, puis la fenêtre de versement
  await openTab(page, 'p15', 'factures');
  await page.locator('[data-act="addTransfer"][data-id="cp-p15"]').click();
  await expect(page.locator('dialog.ask')).toContainText('commission versée maintenant ne porte que sur le MG');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  expect(await page.evaluate(() => window.__DB.commission_transfers.length)).toBe(0);
  // validation de la part en booking après facturation : montant historique conservé, régularisation affichée (facturée / encaissée)
  await set(page, 'b20', { corea: { booking_share: 1000 } });
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); for (const db of [S.db, window.__DB]) db.show_payments.find(p => p.id === 'cb-b20').paid_at = '2026-10-25'; touch('show_payments'); });
  await openTab(page, 'b20', 'conditions');
  await page.locator('.corea-block [data-act="coreaValidateShare"]').click();
  await expect(page.locator('dialog.ask')).toContainText(/déjà facturée à 600,00.*\+200,00/);
  await page.locator('dialog.ask button', { hasText: 'Valider la part' }).click();
  await expect(page.locator('.corea-block')).toContainText(/Commission retenue : 600,00\s€ · facturée : oui · encaissée : 600,00\s€.*Régularisation à prévoir : \+200,00/);
  expect(await page.evaluate(() => Number(window.__DB.show_payments.find(p => p.id === 'cb-b20').amount))).toBe(600);
  expect(await page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'b20').length)).toBe(1);   // aucune régularisation créée
  expectClean(ctx);
});

test('v1.51 clôture de coproduction : recettes pas encore encaissées bloquantes ; aucune promotion locale = pas de blocage ; avance comptée une fois', async ({ page }) => {
  const ctx = await openApp(page);
  const prod = { ...COPRO.production }; delete prod.receipts_cashed_at;
  await seed(page, { partners: [{ id: 'pa-x', name: 'Coprod Fictive' }], shows: [{ ...COPRO, ticket_holder: 'partenaire', production: prod }],
    budget_lines: [{ id: 'cl-1', show_id: 'cp-9', project_id: 'art-a', category: 'Salle', label: 'Location salle', amount: 3000, payer: 'partenaire', paid_at: `${Y}-10-02`, sort: 1 }] });
  const close = () => page.evaluate(async () => { const { coprodClose } = await import('./js/production-budget.js'), { byId } = await import('./js/selectors.js');
    const k = coprodClose(byId('shows', 'cp-9')); return { ok: k.ok, issues: k.issues.join(' | '), x: k.snapshot }; });
  let k = await close();
  expect(k.ok).toBe(false); expect(k.issues).toContain('pas encore notées encaissées : note la date d’encaissement par le coproducteur');
  expect(k.x.result).toBe(6650);   // prévisionnel toujours calculé : 10 000 − 350 − 3 000
  await openBudget(page, 'cp-9');
  await expect(page.locator('.coprod-block')).toContainText('Aucune promotion locale');
  await page.locator('.coprod-block input[data-prod-path="receipts_cashed_at"]').fill(`${Y}-10-06`);
  await page.locator('.coprod-block input[data-prod-path="receipts_cashed_at"]').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.id === 'cp-9').production.receipts_cashed_at)).toBe(`${Y}-10-06`);
  k = await close();
  expect(k.ok).toBe(true);   // aucune promotion locale : rien à renseigner
  // avance : promo due par le coproducteur seul, payée par L'ArtBo → comptée une fois (position de L'ArtBo), retirée de la part du coproducteur
  await set(page, 'cp-9', { production: { ...(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'cp-9').production)), promo_net_pct: 10, promo_debtor: 'partenaire', promo_payer: 'artbo', promo_paid_at: `${Y}-10-03` } });
  k = await close();
  // promo 965 ; résultat 6 650 − 965 = 5 685 ; partagé 6 650 → 3 325 / 3 325 − 965 = 2 360 ; positions : L'ArtBo −965, coproducteur 9 650 − 3 000 = 6 650
  expect(k.ok).toBe(true);
  expect(k.x).toMatchObject({ result: 5685, artbo_part: 3325, partner_part: 2360, promo_advance: 965, pos_artbo: -965, pos_partner: 6650, transfer: 4290, from: 'partenaire', to: 'artbo' });
  expect(k.x.artbo_part + k.x.partner_part).toBe(k.x.pos_artbo + k.x.pos_partner);
  expectClean(ctx);
});
