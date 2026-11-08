// v1.60.4 — retour d'Anthony du 08/11/2026 : « cliquer sur une date confirmée depuis la fiche projet ouvre la fenêtre de
// modification. Corriger pour ouvrir directement cette date dans Production, sans recherche supplémentaire. Conserver une action
// Modifier distincte. » Données FICTIVES. Clics comme un utilisateur réel (souris sur la ligne, pas sur un lien caché).
//  - fiche artiste (aperçu « Prochaines dates » et onglet Dates), fiche structure (onglet Dates), budget de l'artiste dans Production :
//    une date confirmée salle / festival s'ouvre dans Production (année, filtre, date dépliée et visible sous l'en-tête) ;
//  - bouton « Modifier » distinct : la fenêtre de la date ;
//  - dates non confirmées et archivées : la fenêtre, comme avant ;
//  - ordinateur et téléphone (tableaux en fiches).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
const FUT = { id: 'sh-fut', project_id: 'art-a', structure_id: 'st-1', venue: 'Salle Future', city: 'Villeexemple', date: `${Y + 1}-02-14`,
  status: 'Confirmée Salle', contract_type: 'Cession', fee_ht: 2500, prod_mode: 'production' };
const ARCH = { id: 'sh-arch', project_id: 'art-a', structure_id: 'st-1', venue: 'Salle Archivée', city: 'Villeexemple', date: `${Y + 1}-03-01`,
  status: 'Confirmée Salle', contract_type: 'Cession', fee_ht: 1000, prod_mode: 'production', archived_at: `${Y}-11-01T10:00:00Z` };
async function seed(page) {
  await page.evaluate(async rows => { const { S, touch } = await import('./js/state.js');
    for (const r of rows) { window.__DB.shows.push(structuredClone(r)); S.db.shows.push(structuredClone(r)); } touch('shows'); }, [FUT, ARCH]);
}
const fiche = (page, kind, tab) => page.evaluate(async ([k, tb]) => { const { S } = await import('./js/state.js'); const a = await import('./js/app.js');
  if (k === 'projet') { a.go('projects'); S.projectPage = 'art-a'; S.tab.project = tb; } else { a.go('structures'); S.structurePage = 'st-1'; S.tab.structure = tb; }
  a.render(); }, [kind, tab]);
// filtre Artistes sur un autre artiste, autre année, recherche Production : la date doit quand même s'afficher, sans recherche à faire
const brouille = page => page.evaluate(async () => { const { S, setProjects } = await import('./js/state.js'); setProjects(['art-b']); S.year = 2001; S.search.production = 'introuvable'; });
async function ouverteDansProduction(page, id) {
  await expect(page.locator('#modal[open]')).toHaveCount(0);
  await expect(page.locator(`#prod-${id}.open .prod-body`)).toBeVisible();
  await expect.poll(async () => { const r = await page.locator(`#prod-${id} .prod-head`).boundingBox(), top = await page.locator('header.top, .top').first().boundingBox();
    const vh = page.viewportSize().height; return r.y >= top.y + top.height - 1 && r.y < vh; }, 'la date est à l’écran, sous l’en-tête').toBe(true);
  expect(await page.evaluate(async () => (await import('./js/state.js')).S.view)).toBe('production');
}

for (const [w, h, opts] of [[1440, 900, {}], [390, 844, { hasTouch: true, isMobile: true }]]) test.describe(`${w} px`, () => {
  test.use({ viewport: { width: w, height: h }, ...opts });

  test(`v1.60.4 fiche artiste, onglet Dates : clic sur la ligne d'une date confirmée → Production ; « Modifier » → fenêtre (${w} px)`, async ({ page }) => {
    const ctx = await openApp(page);
    await seed(page);
    await fiche(page, 'projet', 'dates');
    const row = page.locator('tr[data-id="sh-1"]');
    await expect(row).toHaveAttribute('data-act', 'openShowProd');
    await expect(row.getByRole('button', { name: 'Modifier' })).toBeVisible();
    // option, archivée : fenêtre comme avant, pas de bouton Modifier séparé
    await expect(page.locator('tr[data-id="sh-2"]')).toHaveAttribute('data-act', 'editShow');
    await expect(page.locator('tr[data-id="sh-arch"]')).toHaveAttribute('data-act', 'editShow');
    await expect(page.locator('tr[data-id="sh-2"] button', { hasText: 'Modifier' })).toHaveCount(0);
    // « Modifier » : la fenêtre, on reste sur la fiche
    await row.getByRole('button', { name: 'Modifier' }).click();
    await expect(page.locator('#modal')).toBeVisible();
    await page.locator('#modal').evaluate(d => d.close());
    expect(await page.evaluate(async () => (await import('./js/state.js')).S.view)).toBe('projects');
    // clic sur le lieu (cellule ordinaire de la ligne) : Production, date ouverte, malgré filtre / année / recherche
    await brouille(page);
    await fiche(page, 'projet', 'dates');
    await page.locator('tr[data-id="sh-1"] td', { hasText: 'Festival Fictif' }).first().click();
    await ouverteDansProduction(page, 'sh-1');
    // le statut se change toujours sur place, sans quitter la fiche
    await fiche(page, 'projet', 'dates');
    await page.locator('tr[data-id="sh-fut"] select.st-sel').click();
    await expect(page.locator('#modal[open]')).toHaveCount(0);
    expect(await page.evaluate(async () => (await import('./js/state.js')).S.view)).toBe('projects');
    await page.keyboard.press('Escape');
    // date non confirmée : la fenêtre, comme avant
    await page.locator('tr[data-id="sh-2"] td').first().click();
    await expect(page.locator('#modal')).toBeVisible();
    expectClean(ctx);
  });

  test(`v1.60.4 aperçu artiste « Prochaines dates », fiche structure et budget de l'artiste : même ouverture dans Production (${w} px)`, async ({ page }) => {
    const ctx = await openApp(page);
    await seed(page);
    // aperçu : prochaine date confirmée
    await fiche(page, 'projet', 'overview');
    const plan = page.locator('.plan-row[data-id="sh-fut"]');
    await expect(plan).toHaveAttribute('data-act', 'openShowProd');
    await plan.getByRole('button', { name: 'Modifier' }).click();
    await expect(page.locator('#modal')).toBeVisible();
    await page.locator('#modal').evaluate(d => d.close());
    await brouille(page);
    await fiche(page, 'projet', 'overview');
    await page.locator('.plan-row[data-id="sh-fut"] b', { hasText: 'Salle Future' }).click();
    await ouverteDansProduction(page, 'sh-fut');
    expect(await page.evaluate(async () => (await import('./js/state.js')).S.year)).toBe(Y + 1);
    // fiche structure, onglet Dates
    await fiche(page, 'structure', 'dates');
    const srow = page.locator('tr[data-id="sh-fut"]');
    await expect(srow).toHaveAttribute('data-act', 'openShowProd');
    await srow.getByRole('button', { name: 'Modifier' }).click();
    await expect(page.locator('#modal')).toBeVisible();
    await page.locator('#modal').evaluate(d => d.close());
    await page.locator('tr[data-id="sh-fut"] td').first().click();
    await ouverteDansProduction(page, 'sh-fut');
    expectClean(ctx);
  });
});

test('v1.60.4 budget de l’artiste (Production) : la date d’une autre année ou masquée par la recherche s’ouvre quand même', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  await page.evaluate(async y => { const { S } = await import('./js/state.js'); const a = await import('./js/app.js');
    S.year = y; a.go('production'); S.openBudget = new Set(['art-a']); a.render(); }, Y);
  // la date de l'an prochain est dans le budget de l'artiste (toutes ses dates confirmées) mais pas dans la liste de l'année
  await expect(page.locator('#prod-sh-fut')).toHaveCount(0);
  await page.locator('.proj-budget a[data-act="openShowProd"][data-id="sh-fut"]').click();
  await ouverteDansProduction(page, 'sh-fut');
  expectClean(ctx);
});
