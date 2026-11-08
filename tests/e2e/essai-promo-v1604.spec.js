// v1.60.4 — cas d'essai isolé « ESSAI promo » (retour d'Anthony du 08/11/2026) : les MÊMES données fictives que
// supabase/repetitions/2026-11-08_v1.60.4_essai_promo_coproduction.sql, dans la fausse base ; les montants attendus sont ceux du
// tableau en tête de ce script SQL, calculés à la main (jamais repris du code testé).
//  - trois cas de promotion locale : charge commune / L'ArtBo seule / coproducteur seul ; qui SUPPORTE ≠ qui PAIE ;
//  - résultat partagé, part de chaque partie, résultat global (prévu et réel), points d'équilibre, positions et reversement ;
//  - aucune double déduction : part L'ArtBo + part coproducteur = résultat global ;
//  - isolement : artiste inactif absent de Production par défaut, aucune ligne de facturation, aucune relance.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const ID = n => `e55a1000-0000-4000-a000-0000000000${String(n).padStart(2, '0')}`;
const PROJ = ID(1), PART = ID(2), STRU = ID(3);
const prod = (debtor, payer) => ({ vat: 5.5, sacem_pct: 0, artbo_share: 50, artbo_loss_share: 40, promo_net_pct: 10, promo_dl_pct: 0,
  promo_debtor: debtor, promo_payer: payer, promo_paid_at: '2026-10-15', receipts_cashed_at: '2026-10-20',
  tickets: [{ label: 'Plein', qty: 500, price: 21.1, real_qty: 400, dl_prod: 0, dl_net: 0 }] });
const show = (n, venue, date, holder, debtor, payer) => ({ id: ID(n), project_id: PROJ, structure_id: STRU, venue, city: 'Ville fictive', date,
  status: 'Confirmée Salle', contract_type: 'Co-Production', prod_mode: 'production', prod_mode_manual: true, fee_ht: 0, vat_rate: 5.5,
  partner_id: PART, capacity: 600, cnm_pct: 3.5, ticket_holder: holder, ticketing_enabled: true, communication_enabled: false,
  drive_folder_requested_at: '2026-11-08T10:00:00Z', drive_folder_error: 'essai fictif : ne pas créer de dossier Drive',
  created_at: '2026-11-08T10:00:00Z', production: prod(debtor, payer) });
const lines = (n, show) => [
  { id: ID(n), show_id: show, project_id: PROJ, category: 'Salle', label: 'Location salle (essai)', supplier: 'Fournisseur fictif', payer: 'partenaire', forecast: 3000, amount: 3000, paid_at: '2026-10-14', sort: 1 },
  { id: ID(n + 1), show_id: show, project_id: PROJ, category: 'Promoteur', label: 'Technique (essai)', supplier: 'Fournisseur fictif', payer: 'artbo', forecast: 1500, amount: 1500, paid_at: '2026-10-14', sort: 2 }];
const DATA = {
  projects: [{ id: PROJ, name: 'ESSAI promo', active: false, mode: 'production' }],
  partners: [{ id: PART, name: 'ESSAI promo — coproducteur fictif', default_pct: 0 }],
  structures: [{ id: STRU, name: 'ESSAI promo — salle fictive', city: 'Ville fictive', country: 'France', inactive_at: '2026-11-08' }],
  shows: [show(11, 'ESSAI promo — cas 1 charge commune', '2026-10-10', 'partenaire', 'commun', 'artbo'),
    show(12, 'ESSAI promo — cas 2 L’ArtBo seule', '2026-10-11', 'artbo', 'artbo', 'partenaire'),
    show(13, 'ESSAI promo — cas 3 coproducteur seul', '2026-10-12', 'partenaire', 'partenaire', 'artbo')],
  budget_lines: [...lines(21, ID(11)), ...lines(23, ID(12)), ...lines(25, ID(13))],
};

// Attendus (tableau du script SQL). Réel : 400 billets → HT 8 000, CNM 280, nette 7 720, promo 772, résultat global 2 448.
// Prévu : 500 billets → HT 10 000, CNM 350, nette 9 650, promo 965, résultat global 4 185.
const EXPECT = {
  [ID(11)]: { planned: { shared: 4185, artbo: 2092.5, partner: 2092.5 },
    real: { result: 2448, shared_result: 2448, artbo_part: 1224, partner_part: 1224, net_encaisse: 7720, paid_artbo: 2272, paid_partner: 3000,
      pos_artbo: -2272, pos_partner: 4720, promo_advance: 0, transfer: 3496, from: 'partenaire', to: 'artbo' },
    breaks: { shared: 260, artbo: 260, global: 260 } },
  [ID(12)]: { planned: { shared: 5150, artbo: 1610, partner: 2575 },
    real: { result: 2448, shared_result: 3220, artbo_part: 838, partner_part: 1610, net_encaisse: 7720, paid_artbo: 1500, paid_partner: 3772,
      pos_artbo: 6220, pos_partner: -3772, promo_advance: 772, transfer: 5382, from: 'artbo', to: 'partenaire' },
    breaks: { shared: 234, artbo: 292, global: 260 } },
  [ID(13)]: { planned: { shared: 5150, artbo: 2575, partner: 1610 },
    real: { result: 2448, shared_result: 3220, artbo_part: 1610, partner_part: 838, net_encaisse: 7720, paid_artbo: 2272, paid_partner: 3000,
      pos_artbo: -2272, pos_partner: 4720, promo_advance: 772, transfer: 3882, from: 'partenaire', to: 'artbo' },
    breaks: { shared: 234, artbo: 234, global: 260 } },
};

async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { (window.__DB[table] ||= []).push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const calc = (page, id) => page.evaluate(async i => {
  const { productionBudget, coprodClose } = await import('./js/production-budget.js'), { productionBreaks } = await import('./js/break.js');
  const { byId } = await import('./js/selectors.js'), { remindersOf } = await import('./js/reminders.js'), { paymentsOf } = await import('./js/calc.js');
  const s = byId('shows', i), f = productionBudget(s), r = productionBudget(s, true), k = coprodClose(s), b = productionBreaks(s);
  const brk = Object.fromEntries(b.readings.map(x => [x.key, [...new Set(Object.values(x.byScenario).map(v => v.n))]]));
  return { f: { ht: f.ht, cnm: f.cnm, net: f.net, promo: f.promo, result: f.resultDl, shared: f.shared, artbo: f.artbo, partner: f.partner },
    r: { ht: r.ht, cnm: r.cnm, net: r.net, promo: r.promo, costs: r.costs }, ok: k.ok, provisional: k.provisional, issues: k.issues, x: k.snapshot, brk,
    reminders: remindersOf(s, { all: true }).length, payments: paymentsOf(i).length };
}, id);

test('v1.60.4 ESSAI promo : trois cas (commune / L’ArtBo seule / coproducteur seul) — résultats, parts, breaks, reversement, sans double déduction', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  for (const [id, e] of Object.entries(EXPECT)) {
    const k = await calc(page, id);
    expect(k.f, `${id} prévu`).toEqual({ ht: 10000, cnm: 350, net: 9650, promo: 965, result: 4185, ...e.planned });
    expect(k.r, `${id} réel`).toEqual({ ht: 8000, cnm: 280, net: 7720, promo: 772, costs: 4500 });
    expect(k.x, `${id} clôture`).toMatchObject(e.real);
    // aucune double déduction : les deux parts font exactement le résultat global (prévu et réel)
    expect(Math.round((k.x.artbo_part + k.x.partner_part) * 100) / 100).toBe(k.x.result);
    expect(Math.round((k.f.artbo + k.f.partner) * 100) / 100).toBe(k.f.result);
    // position + reversement = part due, pour chacun
    const sign = k.x.from === 'partenaire' ? 1 : -1;
    expect(Math.round((k.x.pos_artbo + sign * k.x.transfer) * 100) / 100).toBe(k.x.artbo_part);
    expect(Math.round((k.x.pos_partner - sign * k.x.transfer) * 100) / 100).toBe(k.x.partner_part);
    // un seul tarif : les trois scénarios donnent le même équilibre
    expect(k.brk, `${id} breaks`).toEqual({ shared: [e.breaks.shared], artbo: [e.breaks.artbo], global: [e.breaks.global] });
    // dossier complet : clôture possible, reversement définitif ; isolement : aucune ligne de facturation, aucune relance
    expect(k.issues).toEqual([]); expect(k.ok).toBe(true); expect(k.provisional).toBe(false);
    expect(k.payments).toBe(0); expect(k.reminders).toBe(0);
  }
  expectClean(ctx);
});

test('v1.60.4 ESSAI promo : affichage dans Production (artiste choisi) et isolement par défaut (artiste inactif masqué)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  // par défaut (aucun artiste choisi, inactifs masqués) : aucune date d'essai dans Production
  await page.evaluate(async () => { const { S, setProjects } = await import('./js/state.js'); const a = await import('./js/app.js');
    setProjects([]); S.showInactive = false; S.year = 2026; a.go('production'); });
  await expect(page.locator('.prod-row[id^="prod-e55a1000"]')).toHaveCount(0);
  await expect(page.locator('#main')).not.toContainText('ESSAI promo');
  // artiste « ESSAI promo » choisi : les trois dates ; cas 2 (L'ArtBo seule, payée par le coproducteur)
  await page.evaluate(async id => { const { S, setProjects } = await import('./js/state.js'); const a = await import('./js/app.js');
    setProjects(['e55a1000-0000-4000-a000-000000000001']); S.openProd.clear(); S.openProd.add(id); S.tab['prod:' + id] = 'budget'; a.render(); }, ID(12));
  await expect(page.locator('.prod-row[id^="prod-e55a1000"]')).toHaveCount(3);
  const row = page.locator(`#prod-${ID(12)}`);
  await expect(row.locator('select[data-prod-path="promo_debtor"]').last()).toHaveValue('artbo');
  await expect(row.locator('select[data-prod-path="promo_payer"]')).toHaveValue('partenaire');
  const block = row.locator('.coprod-block');
  await expect(block.locator('tr', { hasText: 'Résultat global réel' })).toContainText(/2\s448,00\s€/);
  await expect(block.locator('tr', { hasText: 'Résultat partagé' })).toContainText(/3\s220,00\s€/);
  await expect(block.locator('tr', { hasText: 'Part de L’ArtBo' })).toContainText(/838,00\s€/);
  await expect(block.locator('tr', { hasText: 'Part de ESSAI promo — coproducteur fictif' })).toContainText(/1\s610,00\s€/);
  await expect(block).toContainText(/Dont avance de promotion locale : 772,00\s€ payés par le coproducteur pour le compte de L’ArtBo/);
  await expect(block.locator('tr.bill-total', { hasText: 'Reversement' })).toContainText(/5\s382,00\s€/);
  await expect(block.locator('.warn-badge', { hasText: 'provisoire' })).toHaveCount(0);
  await expect(block.locator('[data-act="closeResult"]')).toBeEnabled();
  const brk = row.locator('table:has(th:text("Billets payants nécessaires"))');
  await expect(brk.locator('tr', { hasText: 'Résultat partagé' }).locator('td.num').first()).toHaveText(/234 billets/);
  await expect(brk.locator('tr', { hasText: 'Part de L’ArtBoristerie' }).locator('td.num').first()).toHaveText(/292 billets/);
  await expect(brk.locator('tr', { hasText: 'Résultat économique global' }).locator('td.num').first()).toHaveText(/260 billets/);
  // dossier Drive : jamais demandé automatiquement (message d'essai affiché)
  await expect(row).toContainText('essai fictif : ne pas créer de dossier Drive');
  expectClean(ctx);
});
