// Décision d'Anthony du 08/11/2026 (option B) — contact devenu « sans structure » après le retrait de sa dernière structure inactive :
// marqué par la base (contacts.hors_prospection_at), il reste HORS PROSPECTION (proposé seulement sur demande dans la recherche de
// destinataires d'une prospection), comme un contact lié uniquement à des structures inactives ; un contact créé sans structure
// (non marqué) reste proposé normalement. Données FICTIVES ; aucun envoi, aucune écriture.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.waitForFunction(() => import('./js/state.js').then(m => m.S.dataLoaded === true));
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const writes = page => page.evaluate(() => window.__calls.filter(c => ['tasks', 'prospects', 'contacts', 'contact_structures'].includes(c.table) && c.op !== 'select').length);
const DATA = {
  structures: [{ id: 'hp-o', name: 'Hp Salle ouverte', city: 'Ville' }],
  contacts: [
    { id: 'hp-m', display_name: 'Mona Marquée', email: 'mona@exemple.invalid', hors_prospection_at: '2026-11-08T10:00:00Z' },
    { id: 'hp-s', display_name: 'Sam Sansstructure', email: 'sam@exemple.invalid' },
    { id: 'hp-r', display_name: 'Rita Rattachée', email: 'rita@exemple.invalid', hors_prospection_at: '2026-11-08T10:00:00Z' },
  ],
  contact_structures: [{ contact_id: 'hp-r', structure_id: 'hp-o' }],
};

test('option B : contact sans structure marqué hors prospection proposé seulement sur demande ; créé sans structure et rattaché à une structure active : proposés', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  // règle JS = règle de brevo-sync (regles.ts) : marqué et sans structure → hors prospection ; une structure active l'emporte
  expect(await page.evaluate(async () => { const { horsProspection } = await import('./js/selectors.js'); const { S } = await import('./js/state.js');
    return ['hp-m', 'hp-s', 'hp-r'].map(id => horsProspection(S.db.contacts.find(c => c.id === id))); })).toEqual([true, false, false]);
  await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('hp-o'); });
  const search = page.locator('#pr-cc-q');
  await expect(search).toBeVisible(); await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
  await search.fill('exemple.invalid');
  await expect(page.locator('.ac-item', { hasText: 'sam@exemple.invalid' })).toHaveCount(1);
  await expect(page.locator('.ac-item', { hasText: 'rita@exemple.invalid' })).toHaveCount(1);
  await expect(page.locator('.ac-item', { hasText: 'mona@exemple.invalid' })).toHaveCount(0);
  await expect(page.locator('.ac-item', { hasText: 'Afficher aussi 1 adresse de contacts hors prospection' })).toHaveCount(1);
  await page.locator('.ac-item', { hasText: 'Afficher aussi' }).dispatchEvent('mousedown');
  await expect(page.locator('.ac-item', { hasText: 'mona@exemple.invalid' })).toContainText('hors prospection (structure inactive retirée)');
  await page.locator('#modal [data-act=closeModal]').first().click();
  expect(await writes(page)).toBe(0);
  expectClean(ctx);
});
