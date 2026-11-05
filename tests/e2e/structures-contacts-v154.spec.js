// Lot V1.54 — structures inactives, contact existant rattaché à une autre structure (demandes d'Anthony du 04/11/2026). Données FICTIVES.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const openStruct = (page, id) => page.evaluate(async i => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); app.go('structures'); S.structurePage = i; app.render(); }, id);

test('v1.54 structure inactive : gardée, cachée par défaut, retrouvée par le filtre, réactivable ; prospection avec question', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { structures: [{ id: 'si-1', name: 'Zz Salle fermée', city: 'Ville', tags: ['Salle'] }] });
  await openStruct(page, 'si-1');
  await page.locator('[data-act=setStructureInactive][data-on="1"]').click();
  await page.locator('dialog.ask button', { hasText: 'Marquer inactive' }).click();
  await expect.poll(() => page.evaluate(() => !!window.__DB.structures.find(s => s.id === 'si-1').inactive_at)).toBe(true);
  await expect(page.locator('main')).toContainText('Structure inactive');
  // rien n'est supprimé : la structure existe toujours
  expect(await page.evaluate(() => window.__DB.structures.filter(s => s.id === 'si-1').length)).toBe(1);
  // liste : cachée par défaut, visible avec le filtre (et signalée)
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.structurePage = null; S.search.structures = 'Zz'; (await import('./js/app.js')).render(); });
  await expect(page.locator('main table')).not.toContainText('Zz Salle fermée');
  await page.locator('[data-act=toggleInactiveStructs]').check();
  await expect(page.locator('main table')).toContainText('Zz Salle fermée');
  await expect(page.locator('main table tr', { hasText: 'Zz Salle fermée' })).toContainText('Inactive');
  // recherche de structure : proposée en dernier, signalée
  const hits = await page.evaluate(async () => (await import('./js/ui/autocomplete.js')).SOURCES.structures.search('Zz'));
  expect(hits.at(-1)).toMatchObject({ id: 'si-1', hint: expect.stringContaining('inactive') });
  // prospection : question avant d'écrire
  await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('si-1'); });
  await expect(page.locator('dialog.ask')).toContainText('marquée inactive');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  // réactivation
  await openStruct(page, 'si-1');
  await page.locator('[data-act=setStructureInactive][data-on="0"]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.structures.find(s => s.id === 'si-1').inactive_at)).toBeNull();
  expectClean(ctx);
});

test('v1.54 rattacher un contact existant à une autre structure : un lien de plus, ni déplacé ni copié ; fonction propre à chaque structure', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { structures: [{ id: 'sc-2', name: 'Zz Deuxième salle', city: 'Ailleurs' }] });
  const nContacts = await page.evaluate(() => window.__DB.contacts.length);
  await openStruct(page, 'sc-2');
  const ac = page.locator('.attach-contact .ac-input');
  await ac.fill('Camille');
  await page.locator('.ac-item', { hasText: 'Camille' }).first().click();
  await expect.poll(() => page.evaluate(() => window.__DB.contact_structures.filter(l => l.contact_id === 'ct-1').map(l => l.structure_id).sort())).toEqual(['sc-2', 'st-1']);
  expect(await page.evaluate(() => window.__DB.contacts.length)).toBe(nContacts);   // aucune copie
  await expect(page.locator('.contact-row')).toContainText('aussi : Salle Exemple');
  // fonction dans cette structure, sans toucher à l'autre lien
  await page.locator('.contact-row [data-act=editLinkRole]').click();   // v1.56.3 : édition à la demande
  await page.locator('.contact-row input[data-link-role]').fill('Programmatrice');
  await page.locator('.contact-row input[data-link-role]').blur();
  await expect.poll(() => page.evaluate(() => window.__DB.contact_structures.find(l => l.contact_id === 'ct-1' && l.structure_id === 'sc-2')?.role)).toBe('Programmatrice');
  expect(await page.evaluate(() => window.__DB.contact_structures.find(l => l.contact_id === 'ct-1' && l.structure_id === 'st-1').role ?? null)).toBeNull();
  // déjà rattaché : rien en double
  await ac.fill('Camille');
  await page.locator('.ac-item', { hasText: 'Camille' }).first().click();
  await expect(page.locator('.toast').last()).toContainText('déjà rattaché');
  expect(await page.evaluate(() => window.__DB.contact_structures.filter(l => l.contact_id === 'ct-1').length)).toBe(2);
  expectClean(ctx);
});
