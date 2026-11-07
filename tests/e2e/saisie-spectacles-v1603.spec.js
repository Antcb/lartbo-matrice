// v1.60.3 — retours de tests d'Anthony du 07/11/2026 (saisie et spectacles). Données FICTIVES ; aucun envoi.
//  - champs numériques : toute la valeur sélectionnée au premier focus, clic suivant = curseur normal, décimales et refus gardés ;
//  - lignes de cachets du budget d'une date : trois lignes de texte au plus (au lieu de quatre à sept) ;
//  - « Recettes de billetterie encaissées le » (et « Payée le ») : champ date à la largeur d'une date ;
//  - fiche projet : la date confirmée s'ouvre directement dans Production ;
//  - aperçu projet : ancien budget type de l'artiste retiré quand il a des spectacles (donnée gardée) ;
//  - nouvelle date : seul spectacle actif présélectionné ; plusieurs : celui par défaut de l'artiste, modifiable ; dates existantes intactes.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { (window.__DB[table] ||= []).push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const patch = (page, table, id, v) => page.evaluate(async ([t, i, x]) => { const { S, touch } = await import('./js/state.js');
  for (const db of [S.db, window.__DB]) Object.assign(db[t].find(r => r.id === i), x); touch(t); }, [table, id, v]);
const ficheProjet = (page, id = 'art-a', tab = 'overview') => page.evaluate(async ([i, tb]) => { const { S } = await import('./js/state.js'); const a = await import('./js/app.js');
  a.go('projects'); S.projectPage = i; S.tab.project = tb; a.render(); }, [id, tab]);
const sel = loc => loc.evaluate(el => [el.selectionStart, el.selectionEnd, el.value.length]);

test('v1.60.3 champs numériques : premier focus = tout sélectionné, clic suivant = curseur, décimales et refus inchangés', async ({ page }) => {
  const ctx = await openApp(page);
  await patch(page, 'projects', 'art-a', { road_people: 12.5 });
  await ficheProjet(page);
  const f = page.locator('input[data-t=projects][data-f=road_people]');
  await expect(f).toHaveValue('12,5');   // affiché à la virgule (numfield)
  await f.click();
  expect(await sel(f), 'toute la valeur sélectionnée au premier clic').toEqual([0, 4, 4]);
  // clic suivant dans le champ déjà actif : curseur placé, rien de sélectionné → édition partielle possible
  const box = await f.boundingBox();
  await page.mouse.click(box.x + 12, box.y + box.height / 2);
  const [a, b] = await sel(f);
  expect(a).toBe(b);
  // premier focus puis frappe : la valeur est remplacée ; décimale à la virgule enregistrée
  await f.evaluate(el => el.blur());
  await f.click();
  await page.keyboard.type('7,25');
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.__DB.projects.find(p => p.id === 'art-a').road_people)).toBe(7.25);
  // saisie illisible toujours refusée
  const g = page.locator('input[data-t=projects][data-f=rooms_single]');
  await g.click(); await page.keyboard.type('3x'); await page.keyboard.press('Tab');
  await expect(page.locator('.toast').last()).toContainText('Nombre illisible');
  expect(await page.evaluate(() => window.__DB.projects.find(p => p.id === 'art-a').rooms_single ?? null)).toBe(null);
  // fenêtre (champ de formulaire) et focus au clavier : même comportement
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow('sh-1'); });
  const fee = page.locator('#modal [name=fee_ht]');
  await fee.click();
  expect(await sel(fee)).toEqual([0, 4, 4]);
  await page.locator('#modal [name=ticketing_type]').focus();
  await page.keyboard.press('Tab');
  const cap = page.locator('#modal [name=capacity]');
  await expect(cap).toBeFocused();
  await page.keyboard.type('450');
  await expect(cap).toHaveValue('450');
  expectClean(ctx);
});

test.describe('écran tactile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('v1.60.3 champs numériques au doigt : pas de sélection imposée (même règle que les dates et les recherches)', async ({ page }) => {
    const ctx = await openApp(page);
    await patch(page, 'projects', 'art-a', { road_people: 12 });
    await ficheProjet(page);
    const f = page.locator('input[data-t=projects][data-f=road_people]');
    await f.tap();
    const [a, b] = await sel(f);
    expect(a).toBe(b);
    expectClean(ctx);
  });
});

const T = { mus_n: 4, multi_n: 1, tech_n: 2, mus_small: 250, mus_small_brut: 160, mus_large: 320, multi_small: 300, multi_large: 380, tech: 290, peage: 40 };
test('v1.60.3 budget d’une date : lignes de cachets sur trois lignes au plus (au lieu de 4 à 7), tableau pas plus large', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { spectacles: [{ id: 'sp-jp', project_id: 'art-a', name: 'Jeune public', active: true, budget_template: T, sort: 1 }], shows: [
    { id: 'sv-1', project_id: 'art-a', spectacle_id: 'sp-jp', venue: 'Salle', capacity: 300, status: 'Confirmée Salle', contract_type: 'Cession', prod_mode: 'production', date: `${Y}-12-01`, fee_ht: 3000 }] });
  await page.evaluate(async () => { const t = await import('./js/budget-template.js'); const { byId } = await import('./js/selectors.js'); await t.applyTemplate(byId('shows', 'sv-1'), { quiet: true });
    const { S } = await import('./js/state.js'); const a = await import('./js/app.js'); S.openProd.add('sv-1'); S.tab['prod:sv-1'] = 'budget'; a.go('production'); });
  const rows = await page.locator('#prod-sv-1 .budget-table tr[data-budget-line]').evaluateAll(l => l.map(r => {
    const ta = r.querySelector('td.bl-label textarea'), lh = parseFloat(getComputedStyle(ta).lineHeight);
    return { label: ta.value.slice(0, 30), lignes: Math.round((ta.scrollHeight - 8) / lh) }; }));
  const mus = rows.find(r => /^Cachets musiciens/.test(r.label));
  expect(mus, 'ligne des musiciens (jauge + brut indicatif)').toBeTruthy();
  // avant : 4 lignes à 1 440 px, 7 à 1 280 px ; deux lignes demanderaient d'élargir le tableau (défilement horizontal à 1 440 px)
  expect(Math.max(...rows.map(r => r.lignes)), JSON.stringify(rows)).toBeLessThanOrEqual(3);
  expect(await page.evaluate(() => { const w = document.querySelector('#prod-sv-1 .budget-table').closest('.tbl-wrap'); return w.scrollWidth - w.clientWidth; }), 'tableau sans défilement horizontal à 1 440 px').toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  expectClean(ctx);
});

const COPRO = { id: 'cp-l1', project_id: 'art-a', structure_id: 'st-1', venue: 'Salle Coprod', date: `${Y}-10-01`, status: 'Confirmée Salle', prod_mode: 'production',
  vat_rate: 5.5, contract_type: 'Co-Production', fee_ht: 0, partner_id: 'part-1', capacity: 600,
  production: { vat: 5.5, sacem_pct: 0, artbo_share: 50, promo_net_pct: 10, promo_debtor: 'partenaire', promo_payer: 'artbo', tickets: [{ label: 'Plein', qty: 500, price: 21.1, real_qty: 500 }] } };
for (const [w, h, opts] of [[1440, 900, {}], [390, 844, { hasTouch: true, isMobile: true }]]) test.describe(`${w} px`, () => {
  test.use({ viewport: { width: w, height: h }, ...opts });
  test(`v1.60.3 « Recettes de billetterie encaissées le » : largeur d’une date, saisie jj/mm/aaaa enregistrée (${w} px)`, async ({ page }) => {
    const ctx = await openApp(page);
    await seed(page, { shows: [COPRO] });
    await page.evaluate(async () => { const { S } = await import('./js/state.js'); const a = await import('./js/app.js');
      a.go('production'); S.openProd.add('cp-l1'); S.tab['prod:cp-l1'] = 'budget'; a.render(); });
    for (const path of ['receipts_cashed_at', 'promo_paid_at']){
      const dt = page.locator(`.coprod-block .dt:has(input[data-prod-path="${path}"])`);
      await dt.scrollIntoViewIfNeeded();
      const bw = (await dt.boundingBox()).width, row = (await page.locator('.coprod-block').boundingBox()).width;
      expect(bw, `${path} : largeur d’une date`).toBeLessThanOrEqual(160);
      expect(bw).toBeLessThan(row / 2);
    }
    if (w > 1000){
      const txt = page.locator('.coprod-block .dt:has(input[data-prod-path="receipts_cashed_at"]) .dt-txt');
      await txt.fill(`06/10/${Y}`); await txt.press('Enter');
      await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.id === 'cp-l1').production.receipts_cashed_at)).toBe(`${Y}-10-06`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    expectClean(ctx);
  });
});

test('v1.60.3 fiche projet : une date confirmée s’ouvre directement dans Production ; les autres ouvrent la fenêtre', async ({ page }) => {
  const ctx = await openApp(page);
  await ficheProjet(page, 'art-a', 'dates');
  // sh-2 en option : pas dans Production → pas de lien
  await expect(page.locator('tr[data-id="sh-2"] [data-act=openShowProd]')).toHaveCount(0);
  // filtre Artistes posé sur un autre artiste et année différente : la date est quand même affichée
  await page.evaluate(async () => { const { S, setProjects } = await import('./js/state.js'); setProjects(['art-b']); S.year = 2001; S.search.production = 'introuvable'; });
  await page.locator('tr[data-id="sh-1"] [data-act=openShowProd]').click();
  await expect(page.locator('#modal[open]')).toHaveCount(0);
  await expect(page.locator('#prod-sh-1.open')).toBeVisible();
  await expect(page.locator('#prod-sh-1 .prod-body')).toBeVisible();
  expect(await page.evaluate(async () => { const { S } = await import('./js/state.js'); return [S.view, S.year, S.projects]; })).toEqual(['production', Y, ['art-a']]);
  await expect(page.locator('.toast').last()).toContainText('Filtre Artistes : Artiste Alpha');
  // reste de la ligne : la fenêtre de la date, comme avant
  await ficheProjet(page, 'art-a', 'dates');
  await page.locator('tr[data-id="sh-2"] td').nth(1).click();
  await expect(page.locator('#modal')).toBeVisible();
  expectClean(ctx);
});

test('v1.60.3 aperçu projet : budget type de l’artiste retiré dès qu’il a un spectacle, donnée gardée et utilisée sans spectacle', async ({ page }) => {
  const ctx = await openApp(page);
  await patch(page, 'projects', 'art-a', { budget_template: { artists: 3, t1max: 400, t1: 200, t2max: 800, t2: 300, t3: 400 } });
  await ficheProjet(page);
  await expect(page.locator('h3.block-title', { hasText: /^Budget type/ })).toHaveCount(1);   // aucun spectacle : seul budget type, gardé
  await seed(page, { spectacles: [{ id: 'sp-x', project_id: 'art-a', name: 'Classique', active: true, budget_template: T, sort: 1 }] });
  await ficheProjet(page);
  await expect(page.locator('h3.block-title', { hasText: /^Budget type/ })).toHaveCount(0);
  await expect(page.locator('h3.block-title', { hasText: /^Spectacles/ })).toHaveCount(1);
  // la donnée historique reste et sert toujours à une date sans spectacle
  const rows = await page.evaluate(async () => { const t = await import('./js/budget-template.js'); const { S } = await import('./js/state.js');
    return [S.db.projects.find(p => p.id === 'art-a').budget_template.artists, t.templateLines({ project_id: 'art-a', capacity: 300 }).find(r => /^Cachets artistes/.test(r.label))]; });
  expect(rows[0]).toBe(3);
  expect(rows[1]).toMatchObject({ qty: 3, unit_cost: 200 });
  expectClean(ctx);
});

test('v1.60.3 nouvelle date : seul spectacle actif présélectionné ; plusieurs : celui par défaut, modifiable ; dates existantes intactes', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await page.evaluate(() => window.__DB.shows.map(s => [s.id, s.spectacle_id ?? null]));
  await seed(page, { spectacles: [
    { id: 'sp-a1', project_id: 'art-a', name: 'Jeune public', active: true, budget_template: {}, sort: 1 },
    { id: 'sp-a0', project_id: 'art-a', name: 'Ancien', active: false, budget_template: {}, sort: 3 }] });
  const nouvelle = async (pid = 'art-a') => { await page.evaluate(async p => { (await import('./js/forms.js')).editShow(null, p); }, pid); await page.waitForTimeout(150); };
  const close = () => page.locator('#modal').evaluate(d => d.close());
  // un seul actif (l'archivé ne compte pas) : présélectionné
  await nouvelle();
  await expect(page.locator('#fld-spectacle_id')).toHaveValue('sp-a1');
  await close();
  // deux actifs sans défaut : choix demandé
  await seed(page, { spectacles: [{ id: 'sp-a2', project_id: 'art-a', name: 'Classique', active: true, budget_template: {}, sort: 2 }] });
  await nouvelle();
  await expect(page.locator('#fld-spectacle_id')).toHaveValue('');
  await close();
  // défaut choisi dans la fiche de l'artiste (liste des seuls spectacles actifs), enregistré sur l'artiste
  await ficheProjet(page);
  const def = page.locator('select[data-t=projects][data-f=default_spectacle_id]');
  await expect(def.locator('option')).toHaveText(['—', 'Jeune public', 'Classique']);
  await def.selectOption('sp-a2');
  await expect.poll(() => page.evaluate(() => window.__DB.projects.find(p => p.id === 'art-a').default_spectacle_id)).toBe('sp-a2');
  await nouvelle();
  await expect(page.locator('#fld-spectacle_id')).toHaveValue('sp-a2');
  // toujours modifiable
  await page.locator('#fld-spectacle_id').selectOption('sp-a1');
  await page.locator('#modal .ac[data-ac=lieux] .ac-input').fill('Salle Défaut');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.venue === 'Salle Défaut')?.spectacle_id)).toBe('sp-a1');
  // défaut archivé : ignoré (choix demandé)
  await patch(page, 'spectacles', 'sp-a2', { active: false });
  await seed(page, { spectacles: [{ id: 'sp-a3', project_id: 'art-a', name: 'Troisième', active: true, budget_template: {}, sort: 4 }] });
  await nouvelle();
  await expect(page.locator('#fld-spectacle_id')).toHaveValue('');
  await close();
  // date existante : jamais rattachée automatiquement ; aucune date historique modifiée
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow('sh-1'); });
  await expect(page.locator('#fld-spectacle_id')).toHaveValue('');
  await close();
  const apres = await page.evaluate(() => window.__DB.shows.filter(s => s.venue !== 'Salle Défaut').map(s => [s.id, s.spectacle_id ?? null]));
  expect(apres).toEqual(avant);
  expectClean(ctx);
});

test('v1.60.3 nouvelle date : artiste changé dans la fenêtre → présélection du spectacle de cet artiste', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { spectacles: [{ id: 'sp-b1', project_id: 'art-b', name: 'Solo', active: true, budget_template: {}, sort: 1 }] });
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow(null, 'art-a'); });
  await page.waitForTimeout(150);
  await expect(page.locator('#fld-spectacle_id')).toHaveValue('');
  await page.evaluate(() => { const f = document.querySelector('#fld-project_id'); f.value = 'art-b'; f.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('#fld-spectacle_id')).toHaveValue('sp-b1');
  expectClean(ctx);
});
