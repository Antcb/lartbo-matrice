// Lot V1.55 — destinataires, copies, confirmations (demande d'Anthony du 04/11/2026). Données FICTIVES ; aucun envoi.
//  - confirmation : jamais « le premier contact de la structure » : contact déjà choisi pour la date, sinon celui du suivi lié ;
//    sinon choix demandé ;
//  - « Destinataire » et « Copie » : adresses des contacts de la structure, recherche dans la base (dans le champ depuis v1.60.3),
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

// v1.60.3 (demande d'Anthony du 07/11) : mêmes règles, composant unique — la recherche est dans le champ (plus de rangée de
// pastilles « + » ni de champ de recherche séparé) ; champ vide = adresses des contacts de la structure
const chips = (page, id) => page.locator(`[data-rcpt="${id}"] .rcpt-chip`);
const sugg = page => page.locator('.ac-list .ac-item');

test('v1.55 destinataires et copies : adresses de la structure proposées, recherche dans la base, plusieurs adresses, sans doublon', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await open(page, 'sd-show-1');
  const to = page.locator('#ml-to'), cc = page.locator('#ml-cc'), q = page.locator('#ml-to-q');
  // champ vide : une proposition par adresse de la structure (bea@… et BEA@… = la même adresse)
  await q.focus();
  await expect(sugg(page)).toHaveCount(2);
  await sugg(page).filter({ hasText: 'alex@exemple.invalid' }).dispatchEvent('mousedown');
  await q.focus(); await page.keyboard.press('ArrowDown');
  await expect(sugg(page)).toHaveCount(1);   // l'adresse déjà choisie n'est plus proposée
  await sugg(page).filter({ hasText: 'bea@exemple.invalid' }).dispatchEvent('mousedown');
  await expect(to).toHaveValue('alex@exemple.invalid, bea@exemple.invalid');
  await expect(chips(page, 'ml-to')).toHaveCount(2);
  // ✕ : retirée
  await chips(page, 'ml-to').filter({ hasText: 'alex@' }).locator('.rcpt-rm').click();
  await expect(to).toHaveValue('bea@exemple.invalid');
  // saisie libre avec doublon : jamais ajouté deux fois
  await q.fill('autre@exemple.invalid, BEA@exemple.invalid,');
  await expect(to).toHaveValue('bea@exemple.invalid, autre@exemple.invalid');
  await expect(q).toHaveValue('');
  // copie : recherche d'un contact de toute la base (pas lié à la structure)
  const cq = page.locator('#ml-cc-q');
  await cq.fill('Camille');
  await page.locator('.ac-item', { hasText: 'Camille' }).first().dispatchEvent('mousedown');
  await expect(cc).toHaveValue(/camille@example\.com/);
  await cq.fill('Camille');
  await expect(page.locator('.ac-item', { hasText: 'camille@example.com' })).toHaveCount(0);
  expect((await cc.inputValue()).match(/camille@example\.com/gi).length).toBe(1);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expectClean(ctx);
});

test('v1.55.1 relecture B1 : après un brouillon restauré, les pastilles affichent exactement les adresses du champ', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await open(page, 'sd-show-1');
  const to = page.locator('#ml-to');
  // le suivi du brouillon démarre 60 ms après l'ouverture (js/ui/drafts.js watchModal) : on attend qu'il soit en place
  await page.waitForTimeout(200);
  await page.locator('#ml-to-q').fill('alex@exemple.invalid');
  await page.keyboard.press('Enter');
  await expect(to).toHaveValue('alex@exemple.invalid');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(k => k.includes('draft.') && localStorage.getItem(k).includes('alex@exemple.invalid')))).toBe(true);
  await page.locator('#modal [data-act=closeModal]').first().click();
  // réouverture : brouillon restauré, la pastille est là, ✕ la retire
  await open(page, 'sd-show-1');
  await expect(page.locator('#modal .draft-bar')).toBeVisible();
  await expect(to).toHaveValue('alex@exemple.invalid');
  await expect(chips(page, 'ml-to')).toHaveCount(1);
  await expect(chips(page, 'ml-to')).toContainText('Alex Premier');
  await chips(page, 'ml-to').locator('.rcpt-rm').click();
  await expect(to).toHaveValue('');
  await expect(chips(page, 'ml-to')).toHaveCount(0);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expectClean(ctx);
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('v1.55.1 relecture B2 / v1.60.3 : pastilles .tp-chip, ✕ de 40 px, champ dans l’écran de 390 px', async ({ page }) => {
    const ctx = await openApp(page);
    await seed(page, DATA);
    await open(page, 'sd-show-2');
    const q = page.locator('#ml-to-q');
    while (await chips(page, 'ml-to').count()) await chips(page, 'ml-to').first().locator('.rcpt-rm').click();
    await q.fill('une.adresse.tres.longue.pour.un.telephone@exemple.invalid; bea@exemple.invalid;');
    await expect(chips(page, 'ml-to')).toHaveCount(2);
    for (const c of await chips(page, 'ml-to').all()) {
      await expect(c).toHaveClass(/\btp-chip\b/);
      const b = await c.boundingBox(); expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(390);
      expect((await c.locator('.rcpt-rm').boundingBox()).height).toBeGreaterThanOrEqual(40);
    }
    const f = await page.locator('[data-rcpt="ml-to"]').boundingBox();
    expect(f.x + f.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.querySelector('#modal .modal-body').scrollWidth <= document.querySelector('#modal .modal-body').clientWidth)).toBe(true);
    expectClean(ctx);
  });
});
