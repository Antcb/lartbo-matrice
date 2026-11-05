// Lot V1.57 — spectacles d'un artiste et budget type par spectacle (décisions d'Anthony du 04/11/2026). Données FICTIVES ; aucun envoi.
//  - un artiste porte plusieurs spectacles, chacun son budget type (effectifs, coût employeur selon la jauge OUVERTE, brut pour information) ;
//  - dates existantes jamais rattachées automatiquement ; nouvelle date : spectacle demandé ;
//  - budget type copié dans un budget vide ; le modèle modifié ne touche pas les budgets existants ;
//  - Movinmotion : coût par bulletin figé sur la ligne.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { (window.__DB[table] ||= []).push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const T = { mus_n: 4, multi_n: 1, tech_n: 2, mus_small: 250, mus_small_brut: 160, mus_large: 320, mus_large_brut: 205, multi_small: 300, multi_large: 380, tech: 290, peage: 40 };
const SPECT = [{ id: 'sp-jp', project_id: 'art-a', name: 'Jeune public', active: true, budget_template: T, sort: 1 },
  { id: 'sp-cl', project_id: 'art-a', name: 'Classique', active: true, budget_template: {}, sort: 2 }];
const linesOf = (page, show) => page.evaluate(s => window.__DB.budget_lines.filter(l => l.show_id === s).map(l => ({ label: l.label, qty: l.qty ?? null, unit_cost: l.unit_cost ?? null, auto: l.auto ?? null, forecast: l.forecast ?? null })), show);

test('v1.57 budget type d’un spectacle : jauge ouverte (≤ 300 petite), technicien fixe, brut pour information, Movinmotion figé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { spectacles: SPECT, shows: [
    { id: 'sv-small', project_id: 'art-a', spectacle_id: 'sp-jp', venue: 'Salle 800 ouverte à 300', capacity: 300, status: 'Confirmée Salle', contract_type: 'Cession', prod_mode: 'production', date: '2027-03-01' },
    { id: 'sv-large', project_id: 'art-a', spectacle_id: 'sp-jp', venue: 'Grande salle', capacity: 301, status: 'Confirmée Salle', contract_type: 'Cession', prod_mode: 'production', date: '2027-03-02' },
    { id: 'sv-none', project_id: 'art-a', spectacle_id: 'sp-jp', venue: 'Jauge inconnue', status: 'Confirmée Salle', contract_type: 'Cession', prod_mode: 'production', date: '2027-03-03' }] });
  await page.evaluate(async () => { const t = await import('./js/budget-template.js'); const { byId } = await import('./js/selectors.js');
    for (const id of ['sv-small', 'sv-large', 'sv-none']) await t.applyTemplate(byId('shows', id), { quiet: true }); });
  const small = await linesOf(page, 'sv-small');
  expect(small).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: expect.stringMatching(/^Cachets musiciens \(petite jauge, 300 places\) — brut indicatif 160,00\s€ par cachet, non compté$/), qty: 4, unit_cost: 250 }),
    expect.objectContaining({ label: expect.stringMatching(/^Cachets multi-instrumentistes \(petite jauge, 300 places\)$/), qty: 1, unit_cost: 300 }),
    expect.objectContaining({ label: 'Cachets techniciens', qty: 2, unit_cost: 290 }),
    expect.objectContaining({ label: 'Péage', forecast: 40 }),
    expect.objectContaining({ auto: 'movinmotion', unit_cost: 20.3 })]));
  const large = await linesOf(page, 'sv-large');
  expect(large).toEqual(expect.arrayContaining([expect.objectContaining({ label: expect.stringMatching(/^Cachets musiciens \(grande jauge, 301 places\)/), unit_cost: 320 }),
    expect.objectContaining({ label: expect.stringMatching(/^Cachets multi-instrumentistes \(grande jauge/), unit_cost: 380 })]));
  // jauge non renseignée : pas de tarif inventé ; le technicien (fixe) garde le sien
  const none = await linesOf(page, 'sv-none');
  expect(none).toEqual(expect.arrayContaining([expect.objectContaining({ label: expect.stringMatching(/^Cachets musiciens \(jauge à renseigner\) — coût à renseigner$/), unit_cost: null }),
    expect.objectContaining({ label: 'Cachets techniciens', unit_cost: 290 })]));
  // le brut n'est jamais compté : prévu des cachets = effectif × coût employeur ; Movinmotion = 7 bulletins × 20,30 €
  const fc = await page.evaluate(async () => { const b = await import('./js/budget.js'); return b.linesOf('sv-small').map(l => [l.auto || l.label.split(' (')[0].split(' —')[0], b.lineForecast(l)]); });
  expect(Object.fromEntries(fc)).toMatchObject({ 'Cachets musiciens': 1000, 'Cachets multi-instrumentistes': 300, 'Cachets techniciens': 580, movinmotion: 142.1 });
  // Movinmotion figé : changer le réglage ne modifie pas ce budget
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); const r = S.db.settings.find(x => x.key === 'movinmotion_payslip_cost');
    if (r) r.value = 25; else S.db.settings.push({ key: 'movinmotion_payslip_cost', value: 25 }); touch('settings'); });
  expect(await page.evaluate(async () => { const b = await import('./js/budget.js'); return b.lineForecast(b.linesOf('sv-small').find(l => l.auto === 'movinmotion')); })).toBe(142.1);
  // le modèle modifié ne touche pas les budgets existants
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.spectacles.find(x => x.id === 'sp-jp').budget_template.mus_small = 999; touch('spectacles'); });
  expect((await linesOf(page, 'sv-small')).find(l => /musiciens/.test(l.label)).unit_cost).toBe(250);
  expectClean(ctx);
});

test('v1.57 dates : spectacle demandé pour une nouvelle date, jamais attribué aux dates existantes, propre à l’artiste', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { spectacles: SPECT });
  // dates existantes : aucune attribution
  expect(await page.evaluate(() => window.__DB.shows.filter(s => s.spectacle_id).length)).toBe(0);
  // nouvelle date de l'artiste : le spectacle est demandé
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow(null, 'art-a'); });
  await page.waitForTimeout(200);   // la fenêtre se prépare (brouillon, 60 ms) avant la saisie
  await page.locator('#modal [name=venue]').fill('Salle Nouvelle');
  await expect(page.locator('#modal [name=venue]')).toHaveValue('Salle Nouvelle');
  await expect(page.locator('#fld-spectacle_id option')).toHaveText(['— choisir le spectacle —', 'Jeune public', 'Classique']);
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('Choisis le spectacle');
  await page.locator('#fld-spectacle_id').selectOption('sp-jp');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.venue === 'Salle Nouvelle')?.spectacle_id)).toBe('sp-jp');
  // date existante d'un artiste sans spectacle : « non précisé », rien n'est exigé
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow('sh-1'); });
  await expect(page.locator('#fld-spectacle_id')).toHaveValue('');
  expectClean(ctx);
});

test('v1.57 fiche de l’artiste : créer un spectacle avec son budget type ; modèle modifiable ; refus d’un montant négatif', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); app.go('projects'); S.projectPage = 'art-a'; app.render(); });
  await expect(page.locator('main')).toContainText('Aucun spectacle');
  await page.locator('[data-act=newSpectacle]').click();
  await page.locator('#modal [name=name]').fill('Jeune public');
  await page.locator('#modal [name=mus_n]').fill('3');
  await page.locator('#modal [name=mus_small]').fill('250,5');
  await page.locator('#modal [name=tech]').fill('-1');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('nombre positif ou vide');
  await page.locator('#modal [name=tech]').fill('');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.spectacles.find(x => x.name === 'Jeune public')?.budget_template)).toEqual({ mus_n: 3, mus_small: 250.5 });
  // modification depuis la fiche (dépliée après création)
  const inp = page.locator('[data-spt="mus_large"]');
  await inp.fill('330'); await inp.blur();
  await expect.poll(() => page.evaluate(() => window.__DB.spectacles.find(x => x.name === 'Jeune public').budget_template.mus_large)).toBe(330);
  expectClean(ctx);
});

test('v1.57 parcours : coréalisation (budget type), production et coproduction (préremplissage), sans double comptage ; budget renseigné conservé', async ({ page }) => {
  const ctx = await openApp(page);
  const base = { project_id: 'art-a', spectacle_id: 'sp-jp', capacity: 250, status: 'Confirmée Salle', prod_mode: 'production', date: '2027-04-01', fee_ht: 5000 };
  await seed(page, { spectacles: SPECT, shows: [
    { ...base, id: 'sc-corea', venue: 'Coréalisation', contract_type: 'Co-Réalisation' },
    { ...base, id: 'sc-prod', venue: 'Production', contract_type: 'Production' },
    { ...base, id: 'sc-copro', venue: 'Coproduction', contract_type: 'Co-Production' },
    { ...base, id: 'sc-old', venue: 'Ancienne', contract_type: 'Cession', spectacle_id: null }],
    budget_lines: [{ id: 'bl-old', show_id: 'sc-old', project_id: 'art-a', category: 'Movinmotion', label: 'Commission bulletins de paie', auto: 'movinmotion', payer: 'compte' },
      { id: 'bl-old-staff', show_id: 'sc-old', project_id: 'art-a', category: 'Staff', label: 'Cachets', qty: 3, unit_cost: 200, payer: 'compte' }] });
  // coréalisation : budget type du spectacle
  await page.evaluate(async () => { const t = await import('./js/budget-template.js'); const { byId } = await import('./js/selectors.js'); await t.applyTemplate(byId('shows', 'sc-corea'), { quiet: true }); });
  expect((await linesOf(page, 'sc-corea')).some(l => /musiciens \(petite jauge, 250 places\)/.test(l.label))).toBe(true);
  // production et coproduction : « Préremplir (modèle du budget de production) » pose les cachets du spectacle, pas la ligne générique
  for (const id of ['sc-prod', 'sc-copro']) {
    await page.evaluate(async id => { const { ACTIONS } = await import('./js/actions.js'); await ACTIONS.prefillProduction({ dataset: { id } }); }, id);
    const ls = await linesOf(page, id);
    expect(ls.some(l => l.label === 'Cachet artiste'), id).toBe(false);
    expect(ls.filter(l => /^Cachets (musiciens|multi|techniciens)/.test(l.label)).length, id).toBe(3);
  }
  // production : chaque coût compté une fois (cachets 4×250 + 1×300 + 2×290 ; brut jamais ajouté) ; Movinmotion à part
  const r = await page.evaluate(async () => { const pb = await import('./js/production-budget.js'); const { byId } = await import('./js/selectors.js'); const b = pb.productionBudget(byId('shows', 'sc-prod')); return b.byCat; });
  expect(r.Staff).toBe(1880);
  // ancienne ligne Movinmotion (sans coût figé) : suit toujours le réglage, comme avant
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); const r = S.db.settings.find(x => x.key === 'movinmotion_payslip_cost'); if (r) r.value = 30; else S.db.settings.push({ key: 'movinmotion_payslip_cost', value: 30 }); touch('settings'); });
  expect(await page.evaluate(async () => { const b = await import('./js/budget.js'); return b.lineForecast(b.linesOf('sc-old').find(l => l.auto === 'movinmotion')); })).toBe(90);
  // budget déjà renseigné : changer le spectacle ou appliquer le budget type ne le modifie pas
  const avant = await linesOf(page, 'sc-corea');
  await page.evaluate(async () => { const d = await import('./js/data.js'); await d.save('shows', 'sc-corea', { spectacle_id: 'sp-cl' }, { rerender: false });
    const t = await import('./js/budget-template.js'); const { byId } = await import('./js/selectors.js'); return t.applyTemplate(byId('shows', 'sc-corea'), { quiet: true }); });
  expect(await linesOf(page, 'sc-corea')).toEqual(avant);
  expectClean(ctx);
});

test('v1.57 budget type d’un spectacle incomplet : « à renseigner », jamais complété par l’artiste ou les Réglages ; changement d’artiste dans la fenêtre', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { spectacles: [...SPECT, { id: 'sp-b', project_id: 'art-b', name: 'Spectacle Bêta', active: true, budget_template: { mus_n: 2 }, sort: 1 }],
    shows: [{ id: 'sc-x', project_id: 'art-b', spectacle_id: 'sp-b', venue: 'X', capacity: 100, status: 'Confirmée Salle', contract_type: 'Cession', prod_mode: 'production', date: '2027-05-01' }] });
  await page.evaluate(async () => { const t = await import('./js/budget-template.js'); const { byId } = await import('./js/selectors.js'); await t.applyTemplate(byId('shows', 'sc-x'), { quiet: true }); });
  expect((await linesOf(page, 'sc-x')).find(l => /musiciens/.test(l.label))).toMatchObject({ unit_cost: null, label: expect.stringContaining('coût à renseigner') });
  expect(await page.evaluate(async () => (await import('./js/budget-template.js')).spectMissing((await import('./js/selectors.js')).byId('spectacles', 'sp-b')))).toEqual(['musicien — petite jauge', 'musicien — grande jauge']);
  // fenêtre d'une date : changer d'artiste propose ses spectacles ; un spectacle d'un autre artiste est refusé
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow(null, 'art-a'); });
  await page.waitForTimeout(200);
  await page.locator('#fld-spectacle_id').selectOption('sp-jp');
  await page.evaluate(() => { const h = document.querySelector('#fld-project_id'); h.value = 'art-b'; h.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('#fld-spectacle_id option')).toHaveText(['— choisir le spectacle —', 'Spectacle Bêta']);
  await expect(page.locator('#fld-spectacle_id')).toHaveValue('');
  expectClean(ctx);
});

test('v1.57 relecture : supprimer un artiste qui a des spectacles est refusé AVANT toute modification des modèles de mail', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { spectacles: SPECT, mail_templates: [{ id: 'mt-partage', kind: 'confirmation', name: 'Partagé', subject: 'S', html: '<p>x</p>', project_ids: ['art-a', 'art-b'], project_id: 'art-a', attachments: [] }] });
  await page.evaluate(async () => { (await import('./js/forms.js')).editProject('art-a'); });
  await page.locator('#modal [data-act=modalDelete]').click();
  await page.locator('dialog.ask button', { hasText: 'Supprimer l’artiste' }).click();
  await expect(page.locator('.toast').last()).toContainText('ne peut pas être supprimé');
  expect(await page.evaluate(() => window.__DB.mail_templates.find(t => t.id === 'mt-partage').project_ids)).toEqual(['art-a', 'art-b']);
  expect(await page.evaluate(() => window.__DB.projects.some(p => p.id === 'art-a'))).toBe(true);
  expectClean(ctx);
});
