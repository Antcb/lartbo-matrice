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
  await dana.locator('[data-act=saveLinkRole]').click();
  await expect.poll(() => role(page, 'fc-1', 'fs-a')).toBe('Programmation jeune public');
  expect(await role(page, 'fc-1', 'fs-b')).toBeNull();                                          // autre structure intacte
  expect(await page.evaluate(() => window.__DB.contacts.find(c => c.id === 'fc-1').roles)).toEqual(['★', 'Direction', 'Programmation']);   // fiche intacte
  // enregistrer la valeur de référence telle quelle ne fige rien
  await openStruct(page, 'fs-b');
  const danaB = page.locator('.contact-row', { hasText: 'Dana Partagée' });
  await danaB.locator('[data-act=editLinkRole]').click();
  await danaB.locator('[data-act=saveLinkRole]').click();
  await expect(danaB.locator('input.link-role')).toHaveCount(0);
  expect(await role(page, 'fc-1', 'fs-b')).toBeNull();
  // retour aux fonctions du contact
  await openStruct(page, 'fs-a');
  await page.locator('.contact-row', { hasText: 'Eli Local' }).locator('[data-act=resetLinkRole]').click();
  await expect.poll(() => role(page, 'fc-2', 'fs-a')).toBeNull();
  await expect(page.locator('.contact-row', { hasText: 'Eli Local' })).toContainText('Administration');
  expectClean(ctx);
});

test('v1.56.5 annulation fiable : Annuler (clic, Tab + Entrée), Échap, perte du focus et geste interrompu n’enregistrent rien ; Entrée et Enregistrer valident', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { structures: [{ id: 'fs-a', name: 'Zz Salle A', city: 'A' }],
    contacts: [{ id: 'fc-1', display_name: 'Dana Partagée', email: 'dana@exemple.invalid', roles: ['Direction'] }],
    contact_structures: [{ contact_id: 'fc-1', structure_id: 'fs-a' }] });
  await openStruct(page, 'fs-a');
  const row = page.locator('.contact-row', { hasText: 'Dana Partagée' }), inp = row.locator('input.link-role');
  const writes = () => page.evaluate(() => window.__calls.filter(c => c.table === 'contact_structures' && c.op === 'update').length);
  const open = async () => { await row.locator('[data-act=editLinkRole]').click(); await inp.fill('Brouillon tapé'); };
  // 1. clic sur Annuler
  await open(); await row.locator('.role-edit [data-act=editLinkRole]').click();
  await expect(inp).toHaveCount(0);
  // 2. Tab jusqu'à Annuler puis Entrée : le passage du focus n'enregistre rien
  await open(); await inp.press('Tab'); await page.waitForTimeout(150);
  expect(await writes()).toBe(0);
  await expect(page.locator(':focus')).toHaveText('Enregistrer'); await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Annuler'); await page.keyboard.press('Enter');
  await expect(inp).toHaveCount(0);
  // 3. Échap
  await open(); await inp.press('Escape'); await expect(inp).toHaveCount(0);
  // 4. perte du focus (clic ailleurs) : rien d'enregistré, la saisie reste en cours
  await open(); await page.locator('h1').first().click(); await page.waitForTimeout(150);
  expect(await writes()).toBe(0); await expect(inp).toHaveValue('Brouillon tapé');
  // 5. geste commencé sur Annuler puis interrompu (pointeur relâché ailleurs) : aucun état laissé ; la saisie suivante s'enregistre
  const b = await row.locator('.role-edit [data-act=editLinkRole]').boundingBox();
  await page.mouse.move(b.x + 5, b.y + 5); await page.mouse.down(); await page.mouse.move(b.x - 200, b.y - 200); await page.mouse.up();
  await expect(inp).toHaveCount(1);
  expect(await writes()).toBe(0);
  expect(await role(page, 'fc-1', 'fs-a')).toBeNull();
  await inp.fill('Programmation'); await inp.press('Enter');
  await expect.poll(() => role(page, 'fc-1', 'fs-a')).toBe('Programmation');
  expect(await writes()).toBe(1);
  // 6. bouton Enregistrer
  await row.locator('[data-act=editLinkRole]').click(); await inp.fill('Direction artistique'); await row.locator('[data-act=saveLinkRole]').click();
  await expect.poll(() => role(page, 'fc-1', 'fs-a')).toBe('Direction artistique');
  expectClean(ctx);
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('v1.56.5 au doigt : cibles de 40 px ; toucher Annuler n’enregistre rien', async ({ page }) => {
    const ctx = await openApp(page);
    await seed(page, { structures: [{ id: 'fs-a', name: 'Zz Salle A', city: 'A' }],
      contacts: [{ id: 'fc-1', display_name: 'Dana Partagée', email: 'dana@exemple.invalid', roles: ['Direction'] }, { id: 'fc-2', display_name: 'Eli Local', email: 'eli@exemple.invalid', roles: ['Admin'] }],
      contact_structures: [{ contact_id: 'fc-1', structure_id: 'fs-a' }, { contact_id: 'fc-2', structure_id: 'fs-a', role: 'Régie' }] });
    await openStruct(page, 'fs-a');
    for (const b of await page.locator('.contact-row :is(.role-view,.role-edit) .btn').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(40);
    const row = page.locator('.contact-row', { hasText: 'Dana Partagée' });
    await row.locator('[data-act=editLinkRole]').tap();
    for (const b of await row.locator('.role-edit :is(.btn, input)').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(40);
    await row.locator('input.link-role').fill('Brouillon tapé');
    await row.locator('.role-edit [data-act=editLinkRole]').tap();
    await expect(row.locator('input.link-role')).toHaveCount(0);
    expect(await role(page, 'fc-1', 'fs-a')).toBeNull();
    expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'contact_structures' && c.op === 'update').length)).toBe(0);
    expectClean(ctx);
  });
});

test('v1.56.6 saisie en cours gardée au réaffichage, jamais enregistrée seule ; modification faite ailleurs jamais écrasée en silence', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { structures: [{ id: 'fs-a', name: 'Zz Salle A', city: 'A' }],
    contacts: [{ id: 'fc-1', display_name: 'Dana Partagée', email: 'dana@exemple.invalid', roles: ['Direction'] }],
    contact_structures: [{ contact_id: 'fc-1', structure_id: 'fs-a' }] });
  await openStruct(page, 'fs-a');
  const row = page.locator('.contact-row', { hasText: 'Dana Partagée' }), inp = row.locator('input.link-role');
  const writes = () => page.evaluate(() => window.__calls.filter(c => c.table === 'contact_structures' && c.op === 'update').length);
  const rerender = () => page.evaluate(async () => { (await import('./js/app.js')).render(); });
  // 1. réaffichage automatique : la saisie reste, rien n'est écrit
  await row.locator('[data-act=editLinkRole]').click();
  await inp.fill('En cours');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await rerender();
  await expect(inp).toHaveValue('En cours');
  expect(await writes()).toBe(0);
  // 2. modifiée sur un autre poste (temps réel reçu) : signalée, la saisie reste, « Enregistrer » n'écrase pas en silence
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    window.__DB.contact_structures.find(l => l.contact_id === 'fc-1').role = 'Régie'; S.db.contact_structures.find(l => l.contact_id === 'fc-1').role = 'Régie'; touch('contact_structures');
    (await import('./js/app.js')).render(); });
  await expect(row).toContainText('Modifiée ailleurs entre-temps : « Régie »');
  await expect(inp).toHaveValue('En cours');
  // l'écriture est conditionnelle : la valeur de départ (vide) n'est plus celle de la base → aucune ligne modifiée
  await row.locator('[data-act=saveLinkRole]').click();
  await expect(page.locator('.toast')).toContainText('modifiée ailleurs');
  expect(await role(page, 'fc-1', 'fs-a')).toBe('Régie');
  await expect(inp).toHaveValue('En cours');
  // après ce signalement, un nouvel « Enregistrer » explicite remplace la valeur
  await row.locator('[data-act=saveLinkRole]').click();
  await expect.poll(() => role(page, 'fc-1', 'fs-a')).toBe('En cours');
  await expect(inp).toHaveCount(0);
  // 3. changement en base pas encore reçu par ce poste : rien n'est écrasé, la valeur actuelle est relue et affichée
  await row.locator('[data-act=editLinkRole]').click();
  await inp.fill('Autre saisie');
  await page.evaluate(() => { window.__DB.contact_structures.find(l => l.contact_id === 'fc-1').role = 'Production'; });
  await row.locator('[data-act=saveLinkRole]').click();
  await expect(row).toContainText('Modifiée ailleurs entre-temps : « Production »');
  expect(await role(page, 'fc-1', 'fs-a')).toBe('Production');
  await expect(inp).toHaveValue('Autre saisie');
  // 4. Échap abandonne la saisie : à la réouverture, la valeur enregistrée revient
  await inp.press('Escape');
  await row.locator('[data-act=editLinkRole]').click();
  await expect(inp).toHaveValue('Production');
  await row.locator('button', { hasText: 'Annuler' }).click();
  expect(await role(page, 'fc-1', 'fs-a')).toBe('Production');
  expectClean(ctx, { allowErrorToasts: true });
});

test('v1.56.7 après un conflit, une Entrée réflexe ne remplace rien ; « Fonctions du contact » n’efface pas une fonction modifiée ailleurs', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { structures: [{ id: 'fs-a', name: 'Zz Salle A', city: 'A' }],
    contacts: [{ id: 'fc-1', display_name: 'Dana Partagée', email: 'dana@exemple.invalid', roles: ['Direction'] },
      { id: 'fc-2', display_name: 'Eli Local', email: 'eli@exemple.invalid', roles: ['Administration'] }],
    contact_structures: [{ contact_id: 'fc-1', structure_id: 'fs-a' }, { contact_id: 'fc-2', structure_id: 'fs-a', role: 'Régie générale' }] });
  await openStruct(page, 'fs-a');
  const row = page.locator('.contact-row', { hasText: 'Dana Partagée' }), inp = row.locator('input.link-role');
  const setServer = (c, v) => page.evaluate(([c, v]) => { window.__DB.contact_structures.find(l => l.contact_id === c).role = v; }, [c, v]);
  // conflit pas encore reçu + deux Entrée de suite : la valeur de l'autre poste reste
  await row.locator('[data-act=editLinkRole]').click();
  await inp.fill('Saisie 2');
  await setServer('fc-1', 'Autre poste');
  await inp.press('Enter');
  await expect(row).toContainText('Modifiée ailleurs entre-temps : « Autre poste »');
  await inp.press('Enter');
  await page.waitForTimeout(300);
  expect(await role(page, 'fc-1', 'fs-a')).toBe('Autre poste');
  await expect(inp).toHaveValue('Saisie 2');
  // une fois l'avertissement affiché depuis un moment, Entrée (ou le bouton) remplace explicitement
  await page.waitForTimeout(1600);
  await inp.press('Enter');
  await expect.poll(() => role(page, 'fc-1', 'fs-a')).toBe('Saisie 2');
  // « Fonctions du contact » sur une valeur déjà changée ailleurs : rien n'est effacé, la valeur actuelle est affichée
  await setServer('fc-2', 'Production (autre poste)');
  const eli = page.locator('.contact-row', { hasText: 'Eli Local' });
  await eli.locator('[data-act=resetLinkRole]').click();
  await expect(page.locator('.toast')).toContainText('Rien n\'a été effacé');
  expect(await role(page, 'fc-2', 'fs-a')).toBe('Production (autre poste)');
  await expect(eli).toContainText('Production (autre poste)');
  // sans conflit, le bouton efface bien
  await eli.locator('[data-act=resetLinkRole]').click();
  await expect.poll(() => role(page, 'fc-2', 'fs-a')).toBeNull();
  expectClean(ctx);
});
