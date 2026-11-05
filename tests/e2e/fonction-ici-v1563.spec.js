// Correction du 05/11/2026 — fonction d'un contact dans une structure. Données FICTIVES.
//  - les fonctions du contact (Poste(s)) restent la référence et s'affichent ; aucune ressaisie ni recopie massive ;
//  - fonction propre à une structure seulement si besoin, sans toucher la fiche du contact ni ses autres structures ;
//  - « Fonctions du contact » efface la fonction propre.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const openStruct = (page, id) => page.evaluate(async i => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); app.go('structures'); S.structurePage = i; app.render(); }, id);
const role = (page, c, s) => page.evaluate(([c, s]) => window.__DB.contact_structures.find(l => l.contact_id === c && l.structure_id === s)?.role ?? null, [c, s]);

test('v1.56.3 fonction ici : fonctions du contact affichées par défaut, fonction propre à une structure, retour à la référence', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, {
    structures: [{ id: 'fs-a', name: 'Zz Salle A', city: 'A' }, { id: 'fs-b', name: 'Zz Salle B', city: 'B' }],
    contacts: [{ id: 'fc-1', display_name: 'Dana Partagée', email: 'dana@exemple.invalid', roles: ['★', 'Direction', 'Programmation'] },
      { id: 'fc-2', display_name: 'Eli Local', email: 'eli@exemple.invalid', roles: ['Administration'] }],
    contact_structures: [{ contact_id: 'fc-1', structure_id: 'fs-a' }, { contact_id: 'fc-1', structure_id: 'fs-b' }, { contact_id: 'fc-2', structure_id: 'fs-a', role: 'Régie générale' }] });
  await openStruct(page, 'fs-a');
  const dana = page.locator('.contact-row', { hasText: 'Dana Partagée' }), eli = page.locator('.contact-row', { hasText: 'Eli Local' });
  // contact sans fonction propre : ses fonctions de référence (sans le ★), pas de champ vide
  await expect(dana).toContainText('Direction, Programmation');
  await expect(dana.locator('a [title="Contact principal"]')).toHaveText('★');   // le ★ reste le repère « contact principal », pas une fonction
  await expect(dana.locator('input.link-role')).toHaveCount(0);
  await expect(dana.locator('[data-act=editLinkRole]')).toHaveText('Modifier la fonction dans cette structure');
  // contact avec une fonction propre déjà saisie : affichée, sans double affichage des tags
  await expect(eli).toContainText('Régie générale');
  await expect(eli).not.toContainText('Administration');
  // personnaliser Dana dans la salle A seulement
  await dana.locator('[data-act=editLinkRole]').click();
  await expect(dana.locator('input.link-role')).toHaveValue('Direction, Programmation');
  await dana.locator('input.link-role').fill('Programmation jeune public');
  await dana.locator('input.link-role').blur();
  await expect.poll(() => role(page, 'fc-1', 'fs-a')).toBe('Programmation jeune public');
  expect(await role(page, 'fc-1', 'fs-b')).toBeNull();                                          // autre structure intacte
  expect(await page.evaluate(() => window.__DB.contacts.find(c => c.id === 'fc-1').roles)).toEqual(['★', 'Direction', 'Programmation']);   // fiche intacte
  // enregistrer la valeur de référence telle quelle ne fige rien
  await openStruct(page, 'fs-b');
  const danaB = page.locator('.contact-row', { hasText: 'Dana Partagée' });
  await danaB.locator('[data-act=editLinkRole]').click();
  await danaB.locator('input.link-role').blur();
  await danaB.locator('input.link-role').dispatchEvent('change');
  expect(await role(page, 'fc-1', 'fs-b')).toBeNull();
  // retour aux fonctions du contact
  await openStruct(page, 'fs-a');
  await page.locator('.contact-row', { hasText: 'Eli Local' }).locator('[data-act=resetLinkRole]').click();
  await expect.poll(() => role(page, 'fc-2', 'fs-a')).toBeNull();
  await expect(page.locator('.contact-row', { hasText: 'Eli Local' })).toContainText('Administration');
  expectClean(ctx);
});
