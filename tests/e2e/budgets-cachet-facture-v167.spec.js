// v1.67 — point n°10 (décisions d'Anthony du 25/11/2026). Données FICTIVES ; aucun envoi, aucune facture.
//  1. budget type d'un spectacle : une ligne par personne (nom, rôle, mode cachet / facture, tarif unique ou deux tarifs ≤ 300 / au-delà ;
//     technicien fixe) ; le budget de la date reprend ces lignes et leurs tarifs ;
//  2. budget type de l'artiste et Réglages : tarifs par rôle = valeurs par défaut (artiste > Réglages) ;
//  3. Movinmotion : bulletins proposés d'après les lignes AU CACHET, ajustables (0 compris) ; une ligne sur facture n'en génère aucun ;
//  4. CNM : « Entrée gratuite / payante » modifiable dans le budget ; ligne CNM posée quand L'ArtBo en est redevable ;
//  5. cachet avant commission et net après commission (budget et export) ;
//  6. dates en option visibles dans Production, budget préparable, jamais comptées comme confirmées.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { (window.__DB[table] ||= []).push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const setSetting = (page, key, value) => page.evaluate(async ({ key, value }) => { const { S, touch } = await import('./js/state.js');
  for (const db of [S.db, window.__DB]){ const r = db.settings.find(x => x.key === key); if (r) r.value = value; else db.settings.push({ key, value }); } touch('settings'); }, { key, value });
const PEOPLE = [
  { id: 'p1', name: 'Alice', role: 'mus', mode: 'cachet', rate_mode: 'jauge', cachet_small: 250, cachet_large: 320 },   // tarif propre, deux tarifs
  { id: 'p2', name: 'Bob', role: 'multi', mode: 'facture', facture: 400 },                                              // sur facture, tarif propre
  { id: 'p3', name: 'Carl', role: 'tech', mode: 'cachet' },                                                             // tarif du rôle (artiste)
  { id: 'p4', name: 'Dan', role: 'mus', mode: 'facture' },                                                              // tarif du rôle (Réglages)
];
const OPTION = { id: 'sh-opt', project_id: 'art-a', spectacle_id: 'sp-n', venue: 'Salle Option', city: 'Lyon', capacity: 300, status: 'Option Salle',
  contract_type: 'Cession', prod_mode: 'production', date: '2027-04-10', fee_ht: 3000, ticketing_type: 'Payant/Prix Libre' };
async function prepare(page){
  await setSetting(page, 'budget_template', { mus_facture: 380, tech_cachet: 300, mus_cachet: 200 });
  await setSetting(page, 'movinmotion_payslip_cost', 20);
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]){ const p = db.projects.find(x => x.id === 'art-a'); p.budget_template = { tech_cachet: 290 }; p.default_artbo_pct = 10; }
    touch('projects'); });
  await seed(page, { spectacles: [{ id: 'sp-n', project_id: 'art-a', name: 'Nominatif', active: true, sort: 1, budget_template: { people: PEOPLE, extras: [{ id: 'x1', label: 'Location backline', category: 'Technique', amount: 150 }] } }],
    shows: [OPTION] });
}
const lines = (page, id = 'sh-opt') => page.evaluate(async id => { const b = await import('./js/budget.js');
  return b.linesOf(id).map(l => ({ label: l.label, qty: l.qty ?? null, unit_cost: l.unit_cost ?? null, pay_mode: l.pay_mode ?? null, auto: l.auto ?? null, forecast: b.lineForecast(l) })); }, id);
const openOptionBudget = page => page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  S.year = 2027; app.go('production'); S.openProd.add('sh-opt'); S.tab['prod:sh-opt'] = 'budget'; app.render(); });

test('v1.67 date en option : visible dans Production, hors montants ; budget nominatif cachet / facture prérempli', async ({ page }) => {
  const ctx = await openApp(page);
  await prepare(page);
  await openOptionBudget(page);
  const row = page.locator('#prod-sh-opt');
  await expect(row).toContainText('Option Salle · pas encore confirmée');
  await expect(page.locator('body')).toContainText('1 en option (hors montants)');
  // préremplissage depuis le budget type nominatif du spectacle
  await row.getByRole('button', { name: 'Préremplir (budget type)' }).click();
  await expect.poll(async () => (await lines(page)).length).toBeGreaterThan(4);
  const L = await lines(page);
  expect(L).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'Alice — musicien (petite jauge, 300 places)', qty: 1, unit_cost: 250, pay_mode: 'cachet', forecast: 250 }),   // ≤ 300 : petite jauge
    expect.objectContaining({ label: 'Bob — multi-instrumentiste, sur facture', qty: 1, unit_cost: 400, pay_mode: 'facture' }),
    expect.objectContaining({ label: 'Carl — technicien', qty: 1, unit_cost: 290, pay_mode: 'cachet' }),       // tarif du rôle de l'artiste (pas 300 des Réglages)
    expect.objectContaining({ label: 'Dan — musicien, sur facture', qty: 1, unit_cost: 380, pay_mode: 'facture' }),   // tarif du rôle des Réglages
    expect.objectContaining({ label: 'Location backline', forecast: 150 }),
    expect.objectContaining({ auto: 'movinmotion', unit_cost: 20, forecast: 40 }),   // 2 bulletins (Alice, Carl) × 20 € — rien pour Bob et Dan
  ]));
  expect(L.some(l => l.auto === 'cnm')).toBe(false);   // payant : CNM à la charge de l'organisateur (usage)
  // jamais compté comme confirmée : aucun montant de Production ne bouge, sous-titre séparé
  await expect(page.locator('body')).toContainText('0 date confirmée');
  expectClean(ctx);
});

test('v1.67 Movinmotion : bulletins proposés d’après les lignes au cachet, ajustables (0 compris) ; passer une ligne sur facture', async ({ page }) => {
  const ctx = await openApp(page);
  await prepare(page);
  await openOptionBudget(page);
  await page.locator('#prod-sh-opt').getByRole('button', { name: 'Préremplir (budget type)' }).click();
  const mm = () => page.evaluate(async () => { const b = await import('./js/budget.js'); const l = b.linesOf('sh-opt').find(x => x.auto === 'movinmotion'); return [l.qty ?? null, b.lineForecast(l)]; });
  await expect.poll(mm).toEqual([null, 40]);
  const q = page.locator('.mm-qty input');
  await expect(q).toHaveAttribute('placeholder', '2');
  await q.fill('0'); await q.blur();
  await expect.poll(mm).toEqual([0, 0]);                      // 0 accepté : le calcul utilise le nombre saisi
  await q.fill('3'); await q.blur();
  await expect.poll(mm).toEqual([3, 60]);
  await q.fill(''); await q.blur();
  await expect.poll(mm).toEqual([null, 40]);                  // vide : retour au nombre proposé
  // Carl passe sur facture : plus que 1 bulletin proposé (Alice)
  const carlId = await page.evaluate(async () => (await import('./js/budget.js')).linesOf('sh-opt').find(l => l.label === 'Carl — technicien').id);
  await page.locator(`tr[data-budget-line="${carlId}"] select[data-f="pay_mode"]`).selectOption('facture');
  await expect.poll(mm).toEqual([null, 20]);
  expectClean(ctx);
});

test('v1.67 anciennes lignes de salaire : calcul inchangé (vide = au cachet) ; Movinmotion seulement avec une ligne au cachet', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [{ id: 'sh-old', project_id: 'art-a', venue: 'Ancienne', status: 'Confirmée Salle', contract_type: 'Cession', prod_mode: 'production', date: '2027-02-01', fee_ht: 2000 }],
    budget_lines: [{ id: 'bl-s', show_id: 'sh-old', project_id: 'art-a', category: 'Staff', label: 'Cachets', qty: 3, unit_cost: 250, sort: 1 },
      { id: 'bl-m', show_id: 'sh-old', project_id: 'art-a', category: 'Movinmotion', label: 'Commission bulletins de paie', auto: 'movinmotion', unit_cost: 20.3, sort: 2 }] });
  const L = await lines(page, 'sh-old');
  expect(L.find(l => l.auto === 'movinmotion').forecast).toBe(60.9);   // 3 × 20,30 € comme avant
  expect(L.find(l => l.label === 'Cachets').pay_mode).toBeNull();
  // budget type sans ligne au cachet : pas de ligne Movinmotion
  const rows = await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.spectacles.push({ id: 'sp-f', project_id: 'art-a', name: 'Facture', active: true,
      budget_template: { people: [{ name: 'Eve', role: 'mus', mode: 'facture', facture: 500 }] } }); touch('spectacles');
    return (await import('./js/budget-template.js')).templateLines({ project_id: 'art-a', spectacle_id: 'sp-f', capacity: 500 }).map(r => r.auto || r.label); });
  expect(rows).toContain('Eve — musicien, sur facture');
  expect(rows).not.toContain('movinmotion');
  expectClean(ctx);
});

test('v1.67 CNM : entrée gratuite / payante modifiable dans le budget, ligne CNM posée quand L’ArtBo en est redevable', async ({ page }) => {
  const ctx = await openApp(page);
  await prepare(page);
  await openOptionBudget(page);
  await page.locator('#prod-sh-opt').getByRole('button', { name: 'Préremplir (budget type)' }).click();
  await expect.poll(async () => (await lines(page)).length).toBeGreaterThan(4);
  const entree = page.locator('#prod-sh-opt [data-t="shows"][data-f="ticketing_type"]');
  await expect(entree).toBeVisible();
  await entree.selectOption('Gratuit');
  await expect.poll(async () => (await lines(page)).some(l => l.auto === 'cnm')).toBe(true);   // gratuit : L'ArtBo redevable (usage)
  const cnm = (await lines(page)).find(l => l.auto === 'cnm');
  expect(cnm.label).toBe('Taxe CNM (entrée gratuite)');
  expect(cnm.forecast).toBeGreaterThan(0);
  // redevable distinct du caractère gratuit / payant : « supporté par l'organisateur » retire la ligne vide
  await page.locator('#prod-sh-opt [data-t="shows"][data-f="cnm_bearer"]').selectOption('organisateur');
  await expect.poll(async () => (await lines(page)).some(l => l.auto === 'cnm')).toBe(false);
  expectClean(ctx);
});

test('v1.67 commission : cachet avant commission et net après commission, dans le budget et l’export', async ({ page, context }) => {
  const ctx = await openApp(page);
  await prepare(page);
  await openOptionBudget(page);
  const sum = page.locator('#prod-sh-opt table.budget-sum');
  await expect(sum).toContainText('Cachet HT avant commission');
  await expect(sum.locator('tr', { hasText: 'Cachet net après commission' })).toContainText('2 700,00');   // 3 000 − 10 %
  const [pop] = await Promise.all([context.waitForEvent('page'), page.locator('#prod-sh-opt [data-act="exportArtistBudget"]').click()]);
  await expect(pop.locator('body')).toContainText('Cachet HT avant commission');
  await expect(pop.locator('tr', { hasText: 'Cachet net après commission' })).toContainText('2 700,00');
  expectClean(ctx);
});

test('v1.67 formulaires : rôles dans Réglages et l’artiste (tarif unique / deux tarifs), personnes du spectacle ajoutées et retirées', async ({ page }) => {
  const ctx = await openApp(page);
  await prepare(page);
  const form = await page.evaluate(async () => { const t = await import('./js/budget-template.js'); const d = document.createElement('div'); d.innerHTML = t.templateForm('art-a');
    document.body.append(d); d.id = 'bt-test'; return [...d.querySelectorAll('[data-bt]')].map(e => e.dataset.bt); });
  expect(form).toEqual(expect.arrayContaining(['mus_n', 'mus_nf', 'mus_rate_mode', 'mus_cachet', 'mus_facture', 'multi_rate_mode', 'tech_cachet', 'tech_facture', 't1', 'artists']));
  // passer le musicien en deux tarifs : choix texte enregistré tel quel
  await page.locator('#bt-test [data-bt="mus_rate_mode"]').selectOption('jauge');
  await expect.poll(() => page.evaluate(() => window.__DB.projects.find(p => p.id === 'art-a').budget_template.mus_rate_mode)).toBe('jauge');
  // personnes du spectacle : ajout d'une ligne, nom, mode
  const sp = await page.evaluate(async () => { const t = await import('./js/budget-template.js'); const { byId } = await import('./js/selectors.js');
    const d = document.createElement('div'); d.id = 'sp-test'; d.innerHTML = t.spectacleForm(byId('spectacles', 'sp-n')); document.body.append(d); return d.querySelectorAll('[data-spp="name"]').length; });
  expect(sp).toBe(4);
  await page.locator('#sp-test [data-spp-act="addPerson"]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.spectacles.find(s => s.id === 'sp-n').budget_template.people.length)).toBe(5);
  expectClean(ctx);
});

test('v1.67 salarié ajouté à la main : au cachet → ligne Movinmotion ; sur facture seule → aucune', async ({ page }) => {
  const ctx = await openApp(page);
  await prepare(page);
  await openOptionBudget(page);
  await page.locator('#prod-sh-opt').getByRole('button', { name: 'Ajouter un salarié' }).click();
  await expect.poll(() => page.evaluate(() => window.__DB.budget_lines.filter(l => l.show_id === 'sh-opt').map(l => l.auto || l.category).sort())).toEqual(['Staff', 'movinmotion']);
  expectClean(ctx);
});


// ── vérifications demandées par Anthony le 25/11 (15 h 53) ──
const rowsFor = (page, show) => page.evaluate(async s => (await import('./js/budget-template.js')).templateLines(s)
  .filter(r => r.category === 'Staff').map(r => [r.label.split(' (')[0].split(' — ')[0].split(',')[0], r.unit_cost]), show);
test('v1.67 tarif unique : même montant à 300 et 301 places — ligne nominative, modèle artiste, Réglages', async ({ page }) => {
  const ctx = await openApp(page);
  await setSetting(page, 'budget_template', { multi_n: 1, multi_rate_mode: 'single', multi_cachet: 310 });          // Réglages
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]){ const p = db.projects.find(x => x.id === 'art-a'); p.budget_template = { mus_n: 2, mus_rate_mode: 'single', mus_cachet: 260 }; }   // artiste
    touch('projects'); });
  await seed(page, { spectacles: [{ id: 'sp-u', project_id: 'art-a', name: 'Unique', active: true, sort: 1, budget_template: { people: [
    { name: 'Zoé', role: 'mus', mode: 'cachet', rate_mode: 'single', cachet: 275 },   // tarif propre unique
    { name: 'Yann', role: 'mus', mode: 'cachet' },                                     // tarif du rôle : artiste (unique 260)
    { name: 'Xavier', role: 'multi', mode: 'cachet' } ] } }] });                       // tarif du rôle : Réglages (unique 310)
  for (const cap of [300, 301]){
    expect(await rowsFor(page, { project_id: 'art-a', spectacle_id: 'sp-u', capacity: cap })).toEqual([['Zoé', 275], ['Yann', 260], ['Xavier', 310]]);
    expect(await rowsFor(page, { project_id: 'art-a', capacity: cap })).toEqual([['Cachets musiciens', 260], ['Cachets multi-instrumentistes', 310]]);   // date sans spectacle
  }
  // deux tarifs : 300 = petite jauge, 301 = grande (règle inchangée)
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.projects.find(x => x.id === 'art-a').budget_template = { mus_n: 1, mus_rate_mode: 'jauge', mus_cachet_small: 200, mus_cachet_large: 330 }; touch('projects'); });
  expect((await rowsFor(page, { project_id: 'art-a', capacity: 300 }))[0]).toEqual(['Cachets musiciens', 200]);
  expect((await rowsFor(page, { project_id: 'art-a', capacity: 301 }))[0]).toEqual(['Cachets musiciens', 330]);
  expectClean(ctx);
});

test('v1.67 artiste non reconfiguré : préremplissage avec ses anciens tarifs (3 tranches), comme avant', async ({ page }) => {
  const ctx = await openApp(page);
  await setSetting(page, 'budget_template', { t1: 220, t2: 270, t3: 315, t1max: 500, t2max: 2000, techs: 2, artists: 0, payslip: 287 });   // Réglages actuels (anciens)
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) db.projects.find(x => x.id === 'art-a').budget_template = { artists: 3 }; touch('projects'); });
  await seed(page, { shows: [{ id: 'sh-anc', project_id: 'art-a', venue: 'Ancien modèle', capacity: 800, status: 'Confirmée Salle', contract_type: 'Cession', prod_mode: 'production', date: '2027-05-01', fee_ht: 4000 }] });
  await page.evaluate(async () => { const t = await import('./js/budget-template.js'); const { byId } = await import('./js/selectors.js'); await t.applyTemplate(byId('shows', 'sh-anc'), { quiet: true }); });
  const L = await lines(page, 'sh-anc');
  expect(L).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'Cachets artistes (jauge 800)', qty: 3, unit_cost: 270, forecast: 810 }),   // 2e tranche (≤ 2 000)
    expect.objectContaining({ label: 'Cachets techniciens', qty: 2, unit_cost: 287, forecast: 574 }),
    expect.objectContaining({ auto: 'movinmotion', forecast: 101.5 })]));                                       // 5 bulletins × 20,30 €
  expectClean(ctx);
});

test('v1.67 CNM sur un concert payant dont L’ArtBo est redevable : posée et calculée sur les recettes de billetterie HT (règle existante)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [{ id: 'sh-pay', project_id: 'art-a', venue: 'Coréa payante', status: 'Confirmée Salle', contract_type: 'Co-Réalisation', prod_mode: 'production', date: '2027-06-01',
      fee_ht: 1000, ticketing_type: 'Payant/Prix Libre', cnm_bearer: 'artbo', corea: { tiers: [{ label: 'Plein', price: 21.1, vat: 5.5, qty: 100 }] } }],
    budget_lines: [{ id: 'bl-p', show_id: 'sh-pay', project_id: 'art-a', category: 'Technique', label: 'Son', forecast: 100, sort: 1 }] });
  await page.evaluate(async () => (await import('./js/budget-actions.js')).syncCnmLine('sh-pay'));
  const cnm = (await lines(page, 'sh-pay')).find(l => l.auto === 'cnm');
  expect(cnm.label).toBe('Taxe CNM (billetterie)');
  const expected = await page.evaluate(async () => { const c = await import('./js/corea.js'); const { byId } = await import('./js/selectors.js'); return c.cnmOf(byId('shows', 'sh-pay')).amount; });
  expect(expected).toBeGreaterThan(0);
  expect(cnm.forecast).toBe(expected);   // recettes HT × taux
  // payant SANS que L'ArtBo soit redevable (organisateur, usage) : pas de ligne
  await page.locator('body').evaluate(async () => { const { save } = await import('./js/data.js'); await save('shows', 'sh-pay', { cnm_bearer: 'organisateur' }); });
  await expect.poll(async () => (await lines(page, 'sh-pay')).some(l => l.auto === 'cnm')).toBe(false);
  expectClean(ctx);
});

test('v1.67 option → confirmée : le budget prévisionnel préparé est conservé tel quel (aucun second préremplissage)', async ({ page }) => {
  const ctx = await openApp(page);
  await prepare(page);
  await openOptionBudget(page);
  await page.locator('#prod-sh-opt').getByRole('button', { name: 'Préremplir (budget type)' }).click();
  await expect.poll(async () => (await lines(page)).length).toBeGreaterThan(4);
  // ajustements faits pendant l'option : bulletins à 3, une ligne ajoutée
  await page.evaluate(async () => { const { save, insert } = await import('./js/data.js'); const b = await import('./js/budget.js');
    await save('budget_lines', b.linesOf('sh-opt').find(l => l.auto === 'movinmotion').id, { qty: 3 });
    await insert('budget_lines', { project_id: 'art-a', show_id: 'sh-opt', category: 'VHR', label: 'Train', forecast: 90, payer: 'compte', sort: 50 }); });
  const before = await page.evaluate(() => JSON.stringify(window.__DB.budget_lines.filter(l => l.show_id === 'sh-opt').map(l => [l.id, l.label, l.qty, l.unit_cost, l.forecast, l.pay_mode]).sort()));
  // passage en « Confirmée Salle » (même chemin que le choix du statut : enregistrement puis préremplissage s'il est vide)
  await page.evaluate(async () => { const { save } = await import('./js/data.js'); await save('shows', 'sh-opt', { status: 'Confirmée Salle' });
    (await import('./js/confirm-flow.js')).askConfirmation('sh-opt'); });
  await page.locator('#modal').getByRole('button', { name: /Annuler|Plus tard|Fermer/ }).first().click().catch(() => page.keyboard.press('Escape'));
  const after = await page.evaluate(() => JSON.stringify(window.__DB.budget_lines.filter(l => l.show_id === 'sh-opt').map(l => [l.id, l.label, l.qty, l.unit_cost, l.forecast, l.pay_mode]).sort()));
  expect(after).toBe(before);
  expectClean(ctx);
});
