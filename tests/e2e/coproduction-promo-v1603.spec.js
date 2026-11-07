// v1.60.3 — coproduction : promotion locale et reversement provisoire (retours d'Anthony du 07/11/2026). Données FICTIVES.
//  - La partie qui SUPPORTE la promotion (charge commune, L'ArtBo seule, coproducteur seul) se choisit dès le prévisionnel ;
//    elle reste distincte de qui la paie (promo_payer) et de qui encaisse la billetterie (ticket_holder).
//  - Cause du « Aucune promotion locale » malgré 10 % prévus : la clôture testait le montant RÉEL de la promotion, nul tant que
//    les billets vendus ne sont pas saisis (js/views/budget.js, ancien test `!k.r.promo && !x.promo`) ; le choix était aussi masqué.
//  - Reversement marqué provisoire tant qu'un paiement ou un encaissement nécessaire manque (règles de calcul inchangées).
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
const setProd = (page, id, patch) => page.evaluate(async ([i, p]) => {
  const { S, touch } = await import('./js/state.js');
  for (const db of [S.db, window.__DB]) { const s = db.shows.find(x => x.id === i); s.production = { ...s.production, ...p }; }
  touch('shows');
}, [id, patch]);
const openBudget = (page, id) => page.evaluate(async i => {
  const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  app.go('production'); S.openProd.clear(); S.openProd.add(i); S.tab['prod:' + i] = 'budget'; app.render();
}, id);
const forecast = page => page.evaluate(async () => { const { productionBudget } = await import('./js/production-budget.js'), { byId } = await import('./js/selectors.js');
  const f = productionBudget(byId('shows', 'cp-p')); return { promo: f.promo, result: f.resultDl, shared: f.shared, artbo: f.artbo, partner: f.partner }; });
const close = page => page.evaluate(async () => { const { coprodClose } = await import('./js/production-budget.js'), { byId } = await import('./js/selectors.js');
  const k = coprodClose(byId('shows', 'cp-p')); return { ok: k.ok, provisional: k.provisional, pending: k.pending.join(' | '), x: k.snapshot }; });

const COPRO = { project_id: 'art-a', structure_id: 'st-1', venue: 'Salle Témoin', city: 'Villeexemple', department: '75', status: 'Confirmée Salle',
  prod_mode: 'production', vat_rate: 5.5, id: 'cp-p', date: `${Y}-10-01`, contract_type: 'Co-Production', fee_ht: 0, partner_id: 'pa-y', capacity: 600,
  ticket_holder: 'partenaire',
  production: { vat: 5.5, sacem_pct: 0, artbo_share: 50, artbo_loss_share: 30, promo_net_pct: 10, tickets: [{ label: 'Plein', qty: 500, price: 21.1 }] } };
const LINE = { id: 'pl-1', show_id: 'cp-p', project_id: 'art-a', category: 'Salle', label: 'Location salle', forecast: 3000, sort: 1 };

test('v1.60.3 promotion locale : supportée par L’ArtBo seule choisie dès le prévisionnel ; distincte du payeur et de l’encaisseur ; plus de « Aucune promotion locale » malgré 10 %', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { partners: [{ id: 'pa-y', name: 'Coprod Témoin' }], shows: [COPRO], budget_lines: [LINE] });
  await openBudget(page, 'cp-p');
  // prévisionnel : 10 000 HT − CNM 350 = 9 650 ; promo 10 % = 965 ; résultat 9 650 − 3 000 − 965 = 5 685 ; débiteur non renseigné
  const sel = page.locator('fieldset.lock-set select[data-prod-path="promo_debtor"]');
  await expect(sel).toHaveCount(1);
  await expect(page.locator('fieldset.lock-set', { hasText: 'Résultat hors DL' })).toContainText('Promo locale supportée par');
  await expect(page.locator('fieldset.lock-set', { hasText: 'Résultat hors DL' })).toContainText('à choisir avant la clôture');   // date sans created_at : nouveau dossier (cas le plus sûr)
  // clôture : aucun billet vendu saisi → promotion PRÉVUE affichée, pas « Aucune promotion locale »
  await expect(page.locator('.coprod-block')).not.toContainText('Aucune promotion locale');
  await expect(page.locator('.coprod-block')).toContainText(/Promotion locale \(prévue 965,00\s€ ; réel calculé quand les billets vendus seront saisis\)/);
  await expect(page.locator('.coprod-block select[data-prod-path="promo_debtor"]')).toHaveCount(1);
  await expect(page.locator('.coprod-block select[data-prod-path="promo_payer"]')).toHaveCount(1);
  // choix « L'ArtBoristerie seule » dans le prévisionnel : enregistré seul (payeur et encaisseur inchangés)
  await sel.selectOption('artbo');
  await expect.poll(() => page.evaluate(() => { const s = window.__DB.shows.find(x => x.id === 'cp-p');
    return [s.production.promo_debtor, s.production.promo_payer ?? null, s.ticket_holder, s.production.promo_net_pct]; })).toEqual(['artbo', null, 'partenaire', 10]);
  // hors du résultat partagé (5 685 + 965 = 6 650 → 3 325 chacun), retirée une seule fois de la part de L'ArtBo : 2 360
  expect(await forecast(page)).toEqual({ promo: 965, result: 5685, shared: 6650, artbo: 2360, partner: 3325 });
  await expect(page.locator('fieldset.lock-set', { hasText: 'Résultat hors DL' })).not.toContainText('à choisir avant la clôture');
  await expect(page.locator('fieldset.lock-set', { hasText: 'Résultat hors DL' })).toContainText('Résultat partagé');
  await expect(page.locator('.coprod-block select[data-prod-path="promo_debtor"]')).toHaveValue('artbo');
  // coproducteur seul : symétrique
  await sel.selectOption('partenaire');
  await expect.poll(() => forecast(page)).toEqual({ promo: 965, result: 5685, shared: 6650, artbo: 3325, partner: 2360 });
  // aucun % de promotion : « Aucune promotion locale » (comportement validé conservé)
  await setProd(page, 'cp-p', { promo_net_pct: 0 });
  await openBudget(page, 'cp-p');
  await expect(page.locator('.coprod-block')).toContainText('Aucune promotion locale');
  expectClean(ctx);
});

test('v1.60.3 reversement provisoire tant que paiements ou encaissements manquent ; définitif ensuite ; montants et clôture inchangés', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { partners: [{ id: 'pa-y', name: 'Coprod Témoin' }],
    shows: [{ ...COPRO, production: { ...COPRO.production, promo_debtor: 'artbo', tickets: [{ label: 'Plein', qty: 500, price: 21.1, real_qty: 500 }] } }],
    budget_lines: [{ ...LINE, amount: 3000, payer: 'partenaire' }] });
  let k = await close(page);
  expect(k.provisional).toBe(true);
  for (const m of ['date d’encaissement de la billetterie', 'date de paiement de dépenses réelles', 'payeur de la promotion locale', 'date de paiement de la promotion locale'])
    expect(k.pending).toContain(m);
  // montants : calcul inchangé (promo à la charge de L'ArtBo seule, payée par personne pour l'instant)
  expect(k.x).toMatchObject({ result: 5685, shared_result: 6650, artbo_part: 2360, partner_part: 3325 });
  await openBudget(page, 'cp-p');
  await expect(page.locator('.coprod-block .warn-badge', { hasText: 'provisoire' })).toHaveCount(1);
  await expect(page.locator('.coprod-block')).toContainText('Reversement provisoire : à renseigner');
  await expect(page.locator('.coprod-block')).toContainText('Estimation provisoire :');
  await expect(page.locator('.coprod-block [data-act="closeResult"]')).toBeDisabled();
  // tout est renseigné : reversement définitif (plus de mention provisoire), clôture possible
  await setProd(page, 'cp-p', { receipts_cashed_at: `${Y}-10-05`, promo_payer: 'artbo', promo_paid_at: `${Y}-10-03` });
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) db.budget_lines.find(l => l.id === 'pl-1').paid_at = '2026-10-02'; touch('budget_lines'); });
  k = await close(page);
  expect(k.provisional).toBe(false); expect(k.ok).toBe(true);
  // L'ArtBo : position −965 (promo payée) ; coproducteur : 9 650 − 3 000 ; L'ArtBo doit recevoir 2 360 + 965 = 3 325
  expect(k.x).toMatchObject({ pos_artbo: -965, pos_partner: 6650, transfer: 3325, from: 'partenaire', to: 'artbo' });
  await openBudget(page, 'cp-p');
  await expect(page.locator('.coprod-block .warn-badge', { hasText: 'provisoire' })).toHaveCount(0);
  await expect(page.locator('.coprod-block')).not.toContainText('Estimation provisoire');
  await expect(page.locator('.coprod-block [data-act="closeResult"]')).toBeEnabled();
  // parts non calculables (pertes sans % du contrat) : « information manquante », jamais « aucun » reversement
  await setProd(page, 'cp-p', { artbo_loss_share: null, promo_net_pct: 200, promo_debtor: 'commun' });
  k = await close(page);
  expect(k.x.artbo_part).toBeNull();
  await openBudget(page, 'cp-p');
  await expect(page.locator('.coprod-block tr.bill-total', { hasText: 'Reversement' })).toContainText('information manquante');
  expectClean(ctx);
});

// Décision d'Anthony du 07/11/2026 : dossiers existants sans choix explicite = calcul historique (charge commune), affiché
// « charge commune — règle existante à confirmer », clôture non bloquée à ce titre ; nouveaux dossiers (créés depuis le 07/11/2026,
// ou création inconnue) : choix obligatoire avant la clôture ; résultats déjà clôturés inchangés.
test('v1.60.3 promotion sans choix : dossier existant = charge commune à confirmer (non bloquant) ; nouveau dossier = choix exigé ; clôturé inchangé', async ({ page }) => {
  const ctx = await openApp(page);
  const ready = { ...COPRO.production, receipts_cashed_at: `${Y}-10-05`, promo_payer: 'partenaire', promo_paid_at: `${Y}-10-03`, tickets: [{ label: 'Plein', qty: 500, price: 21.1, real_qty: 500 }] };
  const line = id => ({ ...LINE, id: 'pl-' + id, show_id: id, amount: 3000, payer: 'partenaire', paid_at: `${Y}-10-02` });
  const snap = { holder: 'partenaire', promo: 965, result: 5685, shared_result: 5685, promo_debtor: 'commun', promo_payer: 'partenaire', artbo_share: 50, artbo_loss_share: 30,
    artbo_part: 2842.5, partner_part: 2842.5, partner: 'Coprod Témoin', net_encaisse: 9650, paid_artbo: 0, paid_partner: 3965, pos_artbo: 0, pos_partner: 5685, transfer: 2842.5, from: 'partenaire', to: 'artbo' };
  await seed(page, { partners: [{ id: 'pa-y', name: 'Coprod Témoin' }],
    shows: [{ ...COPRO, id: 'cp-old', created_at: '2026-10-20T10:00:00Z', production: ready },
      { ...COPRO, id: 'cp-new', created_at: '2026-11-07T09:00:00Z', production: ready },
      { ...COPRO, id: 'cp-done', created_at: '2026-10-20T10:00:00Z', production: { ...ready, promo_debtor: 'commun' }, result_closed_at: `${Y}-10-10T10:00:00Z`, result_closed: snap }],
    budget_lines: [line('cp-old'), line('cp-new'), line('cp-done')] });
  const k = await page.evaluate(async () => { const { coprodClose, productionBudget } = await import('./js/production-budget.js'), { byId } = await import('./js/selectors.js');
    const one = id => { const s = byId('shows', id), c = coprodClose(s), f = productionBudget(s); return { ok: c.ok, provisional: c.provisional, issues: c.issues.join(' | '), x: c.snapshot, shared: f.shared }; };
    return { old: one('cp-old'), neu: one('cp-new') }; });
  // existant : calcul historique (charge commune : résultat partagé = résultat global), clôture possible, règle tracée dans la synthèse
  expect(k.old.issues).toBe(''); expect(k.old.ok).toBe(true); expect(k.old.provisional).toBe(false);
  expect(k.old.x).toMatchObject({ result: 5685, shared_result: 5685, artbo_part: 2842.5, partner_part: 2842.5, promo_debtor: null, promo_debtor_rule: 'commun_historique' });
  expect(k.old.shared).toBe(5685);
  // nouveau : mêmes montants, mais clôture bloquée tant que le choix n'est pas fait ; reversement provisoire
  expect(k.neu.ok).toBe(false); expect(k.neu.provisional).toBe(true);
  expect(k.neu.issues).toContain('Promotion locale : indique à qui elle incombe selon le contrat');
  expect(k.neu.issues).toContain('choix obligatoire avant la clôture');
  expect(k.neu.x.promo_debtor_rule).toBeUndefined();
  await openBudget(page, 'cp-old');
  await expect(page.locator('fieldset.lock-set', { hasText: 'Résultat hors DL' })).toContainText('Charge commune — règle existante à confirmer');
  await expect(page.locator('.coprod-block')).toContainText('Charge commune — règle existante à confirmer');
  await expect(page.locator('.coprod-block [data-act="closeResult"]')).toBeEnabled();
  await openBudget(page, 'cp-new');
  await expect(page.locator('fieldset.lock-set', { hasText: 'Résultat hors DL' })).toContainText('à choisir avant la clôture');
  await expect(page.locator('.coprod-block [data-act="closeResult"]')).toBeDisabled();
  // un choix explicite sur un dossier existant remplace la règle historique
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) db.shows.find(s => s.id === 'cp-old').production.promo_debtor = 'artbo'; touch('shows'); });
  expect(await page.evaluate(async () => { const { coprodClose } = await import('./js/production-budget.js'), { byId } = await import('./js/selectors.js');
    const x = coprodClose(byId('shows', 'cp-old')).snapshot; return [x.promo_debtor, x.promo_debtor_rule ?? null, x.shared_result, x.artbo_part]; })).toEqual(['artbo', null, 6650, 2360]);
  // déjà clôturé : synthèse enregistrée affichée telle quelle
  await openBudget(page, 'cp-done');
  await expect(page.locator('.coprod-block')).toContainText('Charge commune (déduite du résultat partagé)');
  await expect(page.locator('.coprod-block tr.bill-total', { hasText: 'Reversement' })).toContainText('2 842,50');
  await expect(page.locator('.coprod-block .warn-badge', { hasText: 'provisoire' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'cp-done').result_closed)).toEqual(snap);
  expectClean(ctx);
});
