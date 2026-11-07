// v1.60.3 — corrections de la relecture indépendante de bb1a9f8. Données FICTIVES ; aucun envoi.
//  - B1 : archiver une date ne change aucun montant affiché — total « cachets confirmés » de Booking, montants de la fiche artiste,
//         indicateurs de Production identiques avant / après archivage (mention « dont X € de dates archivées » dans Booking) ;
//  - B2 : coréalisation, CNM à la seule charge de L'ArtBo (hors partage) : le résultat n'est pas monotone (0 € à 0 billet, perte de
//         1 à 136 billets) ; l'équilibre est le plus petit nombre de billets à partir duquel le résultat reste ≥ 0 jusqu'à la jauge,
//         jamais « 0 billet ». Les cas monotones (matrice CNM P1–P6, A–E de budgets-v1603.spec.js) sont inchangés.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { (window.__DB[table] ||= []).push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const CONF = { project_id: 'art-a', structure_id: 'st-1', status: 'Confirmée Salle', contract_type: 'Cession', prod_mode: 'booking', vat_rate: 5.5 };

test('v1.60.3 relecture B1 : archiver une date ne change aucun montant (Booking, fiche artiste, Production)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [
    { ...CONF, id: 'b1-a', venue: 'Salle Gardée', date: `${Y}-11-20`, fee_ht: 1000 },
    { ...CONF, id: 'b1-b', venue: 'Salle Archivée', date: `${Y}-11-21`, fee_ht: 2500,
      prod_mode: 'production' }],
    show_payments: [{ id: 'b1-pb', show_id: 'b1-b', kind: 'acompte', label: 'Acompte', pct: 30, amount: 750 }] });
  const lire = () => page.evaluate(async Y => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
    S.year = Y; app.go('booking'); app.render();
    const sub = document.querySelector('.view-head')?.textContent || '';
    const booking = (sub.match(/([\d\s  ]+(?:,\d+)?\s?€) de cachets confirmés/) || [])[1]?.replace(/\s/g, '');
    app.go('projects'); S.projectPage = 'art-a'; S.tab.project = 'overview'; app.render();
    const fiche = [...document.querySelectorAll('.year-tbl tbody tr')].map(tr => [...tr.querySelectorAll('td.num')].slice(-2).map(td => td.textContent.trim()).join(' | '));
    app.go('production'); app.render();
    const prod = [...document.querySelectorAll('.stat-row .stat')].filter(x => !/Relance/.test(x.textContent)).map(x => x.textContent.trim());
    return { booking, sub, fiche, prod }; }, Y);
  const avant = await lire();
  expect(avant.booking, avant.sub).toBeTruthy();
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    Object.assign(S.db.shows.find(s => s.id === 'b1-b'), { archived_at: new Date().toISOString(), archived_reason: 'essai' }); touch('shows'); });
  const apres = await lire();
  expect(apres.booking, 'Booking : même total après archivage').toBe(avant.booking);
  expect(apres.sub).toMatch(/dont 2\s?500\s€ de dates archivées/);
  expect(avant.sub).not.toMatch(/dates archivées/);
  expect(apres.fiche, 'fiche artiste : mêmes montants').toEqual(avant.fiche);
  expect(apres.prod, 'Production : mêmes indicateurs').toEqual(avant.prod);
  expectClean(ctx);
});

test('v1.60.3 relecture B2 : coréalisation, CNM à la charge de L’ArtBo — équilibre durable (≈ 136 billets), jamais 0 billet', async ({ page }) => {
  const ctx = await openApp(page);
  // MG 1 000 € = dépenses 1 000 € ; 16 € HT le billet (16,88 € TTC à 5,5 %) ; CNM 3,5 % supportée par L'ArtBo hors partage ;
  // break validé 100 ; 13 % du résultat net au producteur ; jauge 1 000
  await seed(page, { shows: [{ ...CONF, id: 'b2', venue: 'Salle Coréal', date: `${Y}-05-01`, prod_mode: 'production', contract_type: 'Co-Réalisation',
    fee_ht: 1000, capacity: 1000, break_even: 100, cr_producer_pct: 13, cnm_pct: 3.5, ticket_holder: 'organisateur', cnm_bearer: 'artbo', cnm_in_result: false,
    corea: { break_validated_at: `${Y - 1}-12-01T10:00:00Z`, break_value: 100, tiers: [{ label: 'Plein', price: 16.88, vat: 5.5, planned: 400 }], charges: [] } }],
    budget_lines: [{ id: 'b2-son', project_id: 'art-a', show_id: 'b2', category: 'Technique', label: 'Son', forecast: 1000, payer: 'compte' },
      { id: 'b2-cnm', project_id: 'art-a', show_id: 'b2', category: 'Taxes', label: 'Taxe CNM (billetterie)', supplier: 'CNM', auto: 'cnm', payer: 'compte' }] });
  const x = await page.evaluate(async () => { const br = await import('./js/break.js'); const { byId } = await import('./js/selectors.js');
    return JSON.parse(JSON.stringify(br.coreaBreaks(byId('shows', 'b2')))); });
  expect(x.cnmVar, 'CNM à la seule charge de L’ArtBo, selon les billets testés').toBe(true);
  expect(x.mixUnit).toBe(16);
  // vérification indépendante : résultat(n) = MG + max(0, (n − 100) × 16) × 13 % − 1 000 − 3,5 % × 16 × n
  const r = n => Math.round((1000 + Math.max(0, (n - 100) * 16) * 0.13 - 1000 - 0.035 * 16 * n) * 100) / 100;
  expect(r(0), 'zone positive isolée : 0 € à 0 billet').toBe(0);
  expect([1, 50, 100, 120, 136].every(n => r(n) < 0), 'perte de 1 à 136 billets').toBe(true);
  let attendu = 1000; while (attendu > 0 && r(attendu - 1) >= 0) attendu--;
  expect(attendu).toBe(137);
  expect(x.byScenario.mix.n, 'équilibre prévisionnel').toBe(attendu);
  expect(x.byScenario.mix.n).not.toBe(0);
  // tarif unique : moins cher / plus cher = même prix, même équilibre
  expect(x.byScenario.low.n).toBe(attendu);
  expect(x.byScenario.high.n).toBe(attendu);
  expectClean(ctx);
});
