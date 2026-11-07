// v1.60.3 — jauge et budgets incomplets, coréalisation (retours des essais d'Anthony du 07/11/2026). Données FICTIVES ; aucun envoi.
//  - jauge ouverte modifiable dans le budget de la date (coréalisation comprise) ; après saisie : proposition (fenêtre de l'application)
//    de compléter les seuls coûts VIDES depuis le budget type, jamais un montant déjà saisi ;
//  - « Budget incomplet — coûts à renseigner » dans la synthèse, le reste artiste, la vue d'ensemble et l'export ;
//  - aucun point d'équilibre calculé (donc jamais « 0 billet ») tant qu'un coût connu en quantité reste à 0 € ;
//  - coréalisation : charges en « Montant HT (€) » expliquées ; break des Conditions proposé s'il est non ambigu, jamais validé seul ;
//    vérification indépendante du break économique (deux tarifs, CNM déduite).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { (window.__DB[table] ||= []).push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const openBudget = (page, id) => page.evaluate(async i => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  app.go('production'); S.openProd.add(i); S.tab['prod:' + i] = 'budget'; app.render(); }, id);
const breaks = (page, id) => page.evaluate(async i => { const b = await import('./js/break.js'); const { byId } = await import('./js/selectors.js');
  const k = b.productionBreaks(byId('shows', i)) || b.coreaBreaks(byId('shows', i)); return JSON.parse(JSON.stringify(k, (key, v) => key === 'planned' ? undefined : v)); }, id);
const dbLines = (page, show) => page.evaluate(s => window.__DB.budget_lines.filter(l => l.show_id === s).map(l => ({ id: l.id, label: l.label, qty: l.qty ?? null, unit_cost: l.unit_cost ?? null })), show);
const T = { mus_n: 2, multi_n: 1, tech_n: 1, mus_small: 250, mus_small_brut: 160, mus_large: 320, multi_small: 300, multi_large: 380, tech: 290 };
const SPECT = [{ id: 'sp-b', project_id: 'art-a', name: 'Spectacle témoin', active: true, budget_template: T, sort: 1 }];
const COREA = { project_id: 'art-a', structure_id: 'st-1', venue: 'Salle Témoin', city: 'Villeexemple', department: '75', status: 'Confirmée Salle',
  prod_mode: 'production', contract_type: 'Co-Réalisation', vat_rate: 5.5 };

test('v1.60.3 jauge saisie dans le budget d’une coréalisation : budget incomplet signalé, coûts vides complétés après confirmation, saisies gardées', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { spectacles: SPECT, shows: [{ ...COREA, id: 'bg-1', date: `${Y}-02-10`, spectacle_id: 'sp-b', fee_ht: 4000 }] });
  await page.evaluate(async () => { const t = await import('./js/budget-template.js'); const { byId } = await import('./js/selectors.js');
    await t.applyTemplate(byId('shows', 'bg-1'), { quiet: true }); });
  // sans jauge : musiciens et multi-instrumentistes sans coût (comptés 0 €) ; on chiffre à la main le multi-instrumentiste (999 €)
  const multi = (await dbLines(page, 'bg-1')).find(l => /multi/.test(l.label));
  expect(multi.unit_cost).toBeNull();
  await page.evaluate(async id => { const { S, touch } = await import('./js/state.js');
    for (const l of [window.__DB.budget_lines.find(x => x.id === id), S.db.budget_lines.find(x => x.id === id)]) l.unit_cost = 999; touch('budget_lines'); }, multi.id);
  await openBudget(page, 'bg-1');
  const box = page.locator('#prod-bg-1 .prod-budget');
  await expect(box.locator('.budget-incomplete')).toContainText('Budget incomplet — coûts à renseigner');
  await expect(box.locator('.budget-incomplete')).toContainText('Cachets musiciens (jauge à renseigner)');
  await expect(box.locator('table.budget-sum')).toContainText('Budget incomplet — coûts à renseigner');   // synthèse (dépenses et reste)
  await expect(box.locator('.artist-result')).toContainText('Budget incomplet — coûts à renseigner');    // reste artiste
  // MG 4 000 € ≥ coûts connus : avant, l'équilibre aurait été « 0 billet » ; maintenant non calculé
  const k0 = await breaks(page, 'bg-1');
  expect(k0.byScenario).toBeUndefined();
  expect(k0.missing).toContain('coûts à renseigner');
  // jauge ouverte directement dans le budget : 250 places → proposition ; « Annuler » ne change rien
  const jauge = box.locator('input[data-f="capacity"]');
  await jauge.fill('250'); await jauge.press('Tab');
  let dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Compléter les coûts manquants ?');
  await expect(dlg).toContainText('Cachets musiciens');
  await expect(dlg).toContainText('2 lignes déjà chiffrées : inchangées');   // multi-instrumentiste (999 €) et technicien (coût fixe)
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'bg-1').capacity)).toBe(250);
  expect((await dbLines(page, 'bg-1')).find(l => /musiciens/.test(l.label)).unit_cost).toBeNull();
  // bouton du bandeau : même proposition ; « Compléter 1 ligne » remplit seulement la ligne vide
  await box.getByRole('button', { name: /Compléter depuis le budget type \(1 ligne\)/ }).click();
  dlg = page.locator('dialog.ask');
  await dlg.getByRole('button', { name: 'Compléter 1 ligne' }).click();
  await expect(dlg).toHaveCount(0);
  const after = await dbLines(page, 'bg-1');
  expect(after.find(l => /musiciens/.test(l.label))).toMatchObject({ qty: 2, unit_cost: 250, label: expect.stringMatching(/^Cachets musiciens \(petite jauge, 250 places\) — brut indicatif/) });
  expect(after.find(l => l.id === multi.id).unit_cost).toBe(999);   // saisie manuelle jamais écrasée
  await expect(box.locator('.budget-incomplete')).toHaveCount(0);
  await expect(box.locator('.artist-result')).not.toContainText('Budget incomplet');
  expectClean(ctx);
});

test('v1.60.3 budget incomplet : vue d’ensemble, export artiste, budget de production et ses points d’équilibre', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { spectacles: SPECT, shows: [
      { ...COREA, id: 'bg-2', date: `${Y}-02-11`, contract_type: 'Cession', fee_ht: 3000 },
      { ...COREA, id: 'bg-3', date: `${Y}-02-12`, contract_type: 'Production', capacity: 500, cnm_pct: 0, production: { vat: 5.5, sacem_pct: 0, tickets: [{ label: 'Plein', qty: 300, price: 21.1 }] } }],
    budget_lines: [
      { id: 'bg-l2', project_id: 'art-a', show_id: 'bg-2', category: 'Staff', label: 'Cachets musiciens (jauge à renseigner) — coût à renseigner', qty: 3, payer: 'compte' },
      { id: 'bg-l3', project_id: 'art-a', show_id: 'bg-3', category: 'Staff', label: 'Cachets techniciens — coût à renseigner', qty: 2, payer: 'artbo' },
      { id: 'bg-l4', project_id: 'art-a', show_id: 'bg-3', category: 'Salle', label: 'Location', forecast: 1000, payer: 'artbo' }] });
  // production : aucun équilibre tant que le coût des techniciens est inconnu
  let k = await breaks(page, 'bg-3');
  expect(k.readings).toBeUndefined();
  expect(k.missing).toContain('Budget incomplet — coûts à renseigner');
  await openBudget(page, 'bg-3');
  await expect(page.locator('#prod-bg-3 .prod-production .budget-incomplete')).toContainText('Cachets techniciens');
  await expect(page.locator('#prod-bg-3 .prod-production')).toContainText('Jauge ouverte (places)');
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.budget_lines.find(l => l.id === 'bg-l3').unit_cost = 300; touch('budget_lines'); });
  k = await breaks(page, 'bg-3');
  expect(k.readings[0].byScenario.mix.n).toBe(80);   // 20 € HT × n ≥ 1 000 + 600 → 80
  // vue d'ensemble de l'artiste : reste signalé incomplet
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); (S.openBudget ||= new Set()).add('art-a'); app.render(); });
  await expect(page.locator('.proj-budget').first()).toContainText('budget incomplet');
  // export artiste : la mention figure à côté du reste
  const html = await page.evaluate(async () => { let out = ''; window.open = () => ({ document: { open() {}, write(h) { out += h; }, close() {}, getElementById() { return null; } } });
    (await import('./js/artist-export.js')).exportArtistBudget('bg-2'); return out; });
  expect(html).toContain('Budget incomplet — coûts à renseigner : Cachets musiciens');
  expect(html).toContain('le reste n’est pas définitif');
  expectClean(ctx);
});

test('v1.60.3 coréalisation : charges en « Montant HT (€) » expliquées ; break des Conditions proposé sans ambiguïté, jamais validé seul', async ({ page }) => {
  const ctx = await openApp(page);
  // lecture du texte des Conditions : un seul nombre entier, sans montant, % ni décimale
  const parsed = await page.evaluate(async () => { const { breakFromText } = await import('./js/corea.js');
    return ['450', '450 entrées payantes', '1 200 billets', '450 entrées payantes / 6 500 €', '450,5', '2 soirs de 300 entrées', '300 entrées ou 50 %', '6 500 euros', '', null, '0 billet'].map(breakFromText); });
  expect(parsed).toEqual([450, 450, 1200, null, null, null, null, null, null, null, null]);
  await seed(page, { shows: [
    { ...COREA, id: 'bg-4', date: `${Y}-02-13`, fee_ht: 1000, capacity: 800, cr_break: '450 entrées payantes', cr_producer_pct: 50, corea: { tiers: [], charges: [{ label: 'Frais de billetterie', amount: 200 }] } },
    { ...COREA, id: 'bg-5', date: `${Y}-02-14`, fee_ht: 1000, cr_break: '450 entrées payantes / 6 500 €', corea: { tiers: [], charges: [] } }] });
  await openBudget(page, 'bg-4');
  const blk = page.locator('#prod-bg-4 .corea-block');
  await expect(blk).toContainText('Montant HT (€)');
  await expect(blk).toContainText('Charge autorisée par le contrat, retirée des recettes avant le partage ; chacune une seule fois, sans double déduction');
  await blk.getByRole('button', { name: 'Reprendre 450 billets (Conditions)' }).click();
  await expect(blk.getByRole('button', { name: 'Valider le break' })).toBeVisible();
  const s = await page.evaluate(() => { const x = window.__DB.shows.find(r => r.id === 'bg-4'); return { be: x.break_even, txt: x.cr_break, v: x.corea?.break_validated_at ?? null }; });
  expect(s).toEqual({ be: 450, txt: '450 entrées payantes', v: null });   // repris, texte gardé, PAS validé
  expect((await breaks(page, 'bg-4')).missing).toContain('validation du break du contrat');
  // texte ambigu : rien n'est proposé
  await openBudget(page, 'bg-5');
  await expect(page.locator('#prod-bg-5 .corea-block')).not.toContainText('Reprendre');
  expectClean(ctx);
});

test('v1.60.3 break économique de la coréalisation : vérification indépendante (deux tarifs, charges, CNM déduite) ; % hors 0–100 bloqué', async ({ page }) => {
  const ctx = await openApp(page);
  // 100 billets à 10,55 € TTC (10 € HT) + 100 à 21,10 € TTC (20 € HT) vendus ; MG 500 € ; dépenses prévues 2 000 € ; break 100 validé ;
  // 50 % au producteur ; charges 300 € ; CNM 5 % sur la TOTALITÉ des recettes, déduite du résultat partagé
  await seed(page, { shows: [{ ...COREA, id: 'bg-6', date: `${Y}-02-15`, fee_ht: 500, capacity: 1000, break_even: 100, cr_producer_pct: 50, cnm_pct: 5, cnm_in_result: true,
      corea: { break_validated_at: `${Y - 1}-12-01T10:00:00Z`, break_value: 100, tiers: [{ label: 'Réduit', price: 10.55, vat: 5.5, qty: 100 }, { label: 'Plein', price: 21.1, vat: 5.5, qty: 100 }],
        charges: [{ label: 'Frais de billetterie', amount: 300 }] } }],
    budget_lines: [{ id: 'bg-l6', project_id: 'art-a', show_id: 'bg-6', category: 'Technique', label: 'Son', forecast: 2000, payer: 'compte' }] });
  // 500 + 0,5 × ((n − 100) u − 300 − 0,05 n u) − 2 000 ≥ 0 ⇔ 0,95 n u − 100 u ≥ 3 300 : u = 15 (moyenne des ventes) → 337 ; 10 → 453 ; 20 → 279
  const expected = u => { for (let n = 0; n <= 1000; n++) if (500 + 0.5 * Math.max(0, (Math.max(0, n - 100) * u) - 300 - n * u * 0.05) - 2000 >= 0) return n; return null; };
  const k = await breaks(page, 'bg-6');
  expect([k.byScenario.mix.n, k.byScenario.low.n, k.byScenario.high.n]).toEqual([expected(15), expected(10), expected(20)]);
  expect([k.byScenario.mix.n, k.byScenario.low.n, k.byScenario.high.n]).toEqual([337, 453, 279]);
  // % du producteur hors 0–100 : même blocage que le partage (coreaCalc), aucun équilibre
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.shows.find(x => x.id === 'bg-6').cr_producer_pct = 150; touch('shows'); });
  const k2 = await breaks(page, 'bg-6');
  expect(k2.byScenario).toBeUndefined();
  expect(k2.missing).toContain('entre 0 et 100');
  expectClean(ctx);
});
