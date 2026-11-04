// Lot V1.55 — destinataires, copies, confirmations (demande d'Anthony du 04/11/2026). Données FICTIVES ; aucun envoi.
//  - confirmation : jamais « le premier contact de la structure » : contact déjà choisi pour la date, sinon celui du suivi lié ;
//    sinon choix demandé ;
//  - sous « Destinataire » et « Copie » : adresses des contacts de la structure (ajout / retrait d'un clic), recherche dans la base,
//    saisie libre, plusieurs adresses, aucun doublon. Le champ d'adresses reste le seul lu à l'envoi (circuits inchangés).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const BASE = { project_id: 'art-a', venue: 'Salle Deux Contacts', city: 'Ville', status: 'Confirmée Salle', contract_type: 'Cession', fee_ht: 1000, prod_mode: 'production', date: `${Y}-12-01` };
const DATA = {
  structures: [{ id: 'sd-1', name: 'Salle Deux Contacts', city: 'Ville' }],
  contacts: [{ id: 'cd-a', display_name: 'Alex Premier', email: 'alex@exemple.invalid' }, { id: 'cd-b', display_name: 'Bea Second', email: 'bea@exemple.invalid', email_2: 'BEA@exemple.invalid' }],
  contact_structures: [{ contact_id: 'cd-a', structure_id: 'sd-1' }, { contact_id: 'cd-b', structure_id: 'sd-1' }],
  prospects: [{ id: 'pd-1', name: 'Suivi', structure_id: 'sd-1', contact_id: 'cd-b', project_ids: ['art-a'], status: 'Interest' }],
  shows: [{ ...BASE, id: 'sd-show-1', structure_id: 'sd-1' }, { ...BASE, id: 'sd-show-2', structure_id: 'sd-1', prospect_id: 'pd-1', date: `${Y}-12-02` }],
};
const open = (page, id) => page.evaluate(async i => { (await import('./js/mail.js')).prepareMail(i, 'confirmation'); }, id);

test('v1.55 confirmation : jamais le premier contact d’office ; le contact du suivi lié est repris ; sinon choix demandé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await open(page, 'sd-show-1');
  await expect(page.locator('#ml-contact')).toHaveValue('');
  await expect(page.locator('#modal .rcpt-note')).toContainText('Plusieurs contacts possibles');
  await expect(page.locator('#ml-to')).toHaveValue('');
  // l'envoi sans destinataire n'aboutit pas : la fenêtre reste ouverte, rien ne part
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal')).toBeVisible();
  await page.locator('#modal [data-act=closeModal]').first().click();
  // date rattachée à un suivi dont le contact est lié à la structure : ce contact
  await open(page, 'sd-show-2');
  await expect(page.locator('#ml-contact')).toHaveValue('cd-b');
  await expect(page.locator('#modal .rcpt-note')).toHaveCount(0);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expectClean(ctx);
});

test('v1.55 destinataires et copies : adresses de la structure d’un clic, recherche dans la base, plusieurs adresses, sans doublon', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await open(page, 'sd-show-1');
  const to = page.locator('#ml-to'), cc = page.locator('#ml-cc');
  // une seule pastille par adresse (bea@… et BEA@… = la même adresse)
  await expect(page.locator('[data-rcpt-for="ml-to"]')).toHaveCount(2);
  await page.locator('[data-rcpt-for="ml-to"][data-rcpt-add="alex@exemple.invalid"]').click();
  await page.locator('[data-rcpt-for="ml-to"][data-rcpt-add="bea@exemple.invalid"]').click();
  await expect(to).toHaveValue('alex@exemple.invalid, bea@exemple.invalid');
  await expect(page.locator('[data-rcpt-for="ml-to"].on')).toHaveCount(2);
  // second clic : retirée
  await page.locator('[data-rcpt-for="ml-to"][data-rcpt-add="alex@exemple.invalid"]').click();
  await expect(to).toHaveValue('bea@exemple.invalid');
  // saisie libre avec doublon : retiré en quittant le champ, la première écriture est gardée
  await to.fill('bea@exemple.invalid, autre@exemple.invalid, BEA@exemple.invalid');
  await to.blur();
  await expect(to).toHaveValue('bea@exemple.invalid, autre@exemple.invalid');
  // copie : recherche d'un contact de toute la base (pas lié à la structure)
  const search = page.locator('[data-rcpt-box="ml-cc"] .ac-input');
  await search.fill('Camille');
  await page.locator('.ac-item', { hasText: 'Camille' }).first().click();
  await expect(cc).toHaveValue(/camille@example\.com/);
  await search.fill('Camille');
  await page.locator('.ac-item', { hasText: 'Camille' }).first().click();
  expect((await cc.inputValue()).match(/camille@example\.com/gi).length).toBe(1);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expectClean(ctx);
});

test('v1.55.1 relecture B1 : après un brouillon restauré, les pastilles disent vrai et un clic ne fait jamais l’inverse de ce qui est affiché', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await open(page, 'sd-show-1');
  const to = page.locator('#ml-to'), alex = page.locator('[data-rcpt-for="ml-to"][data-rcpt-add="alex@exemple.invalid"]');
  // le suivi du brouillon démarre 60 ms après l'ouverture (js/ui/drafts.js watchModal) : on attend qu'il soit en place
  await page.waitForTimeout(200);
  await alex.click();
  await expect(to).toHaveValue('alex@exemple.invalid');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(k => k.includes('draft.') && localStorage.getItem(k).includes('alex@exemple.invalid')))).toBe(true);
  await page.locator('#modal [data-act=closeModal]').first().click();
  // réouverture : brouillon restauré, la pastille indique bien l'adresse présente
  await open(page, 'sd-show-1');
  await expect(page.locator('#modal .draft-bar')).toBeVisible();
  await expect(to).toHaveValue('alex@exemple.invalid');
  await expect(alex).toHaveClass(/\bon\b/);
  // pastille affichée « + » alors que l'adresse est déjà là (affichage en retard) : le clic n'ajoute rien et ne retire surtout rien
  await alex.evaluate(b => b.classList.remove('on'));
  await alex.click();
  await expect(to).toHaveValue('alex@exemple.invalid');
  await expect(alex).toHaveClass(/\bon\b/);
  // pastille « ✓ » : le clic retire
  await alex.click();
  await expect(to).toHaveValue('');
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expectClean(ctx);
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('v1.55.1 relecture B2 : pastilles d’adresses = composant .tag-chip, cible tactile de 40 px', async ({ page }) => {
    const ctx = await openApp(page);
    await seed(page, DATA);
    await open(page, 'sd-show-1');
    const chips = page.locator('#modal [data-rcpt-add]');
    await expect(chips.first()).toBeVisible();
    for (const c of await chips.all()) {
      await expect(c).toHaveClass(/\btag-chip\b/);
      expect((await c.boundingBox()).height).toBeGreaterThanOrEqual(40);
    }
    expectClean(ctx);
  });
});
