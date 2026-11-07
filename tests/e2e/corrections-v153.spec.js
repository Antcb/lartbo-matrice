// Lot V1.53 — corrections sûres (demandes d'Anthony du 01/11 et du 04/11/2026). Données FICTIVES.
//  - types de structures : filtre en OU ; onglet « Notes » dans chaque date (champ « Notes » existant) ;
//  - dates « Option / Confirmée Artiste » hors des montants (Booking, fiche artiste), toujours visibles ;
//  - prospection : aucun artiste coché d'office (le filtre d'affichage n'est pas repris) ;
//  - pièces jointes : fichiers choisis en plusieurs fois gardés, bilan des fichiers ajoutés / refusés.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const go = (page, view, patch = {}) => page.evaluate(async ([v, p]) => { const { S } = await import('./js/state.js'); Object.assign(S, p); (await import('./js/app.js')).go(v); }, [view, patch]);

test('v1.53 types de structures : plusieurs types choisis = au moins un des types (OU)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { structures: [{ id: 'sx-1', name: 'Zz Salle seule', tags: ['Salle'] }, { id: 'sx-2', name: 'Zz Festival seul', tags: ['Festival'] },
    { id: 'sx-3', name: 'Zz Les deux', tags: ['Salle', 'Festival'] }, { id: 'sx-4', name: 'Zz Autre', tags: ['Bar'] }] });
  await go(page, 'structures', { structTags: ['Salle', 'Festival'], search: { structures: 'Zz' } });
  const names = await page.locator('main').innerText();
  for (const n of ['Zz Salle seule', 'Zz Festival seul', 'Zz Les deux']) expect(names).toContain(n);
  expect(names).not.toContain('Zz Autre');
  expectClean(ctx);
});

test('v1.53 onglet Notes d’une date : reprend le champ existant et l’enregistre', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); for (const db of [S.db, window.__DB]) db.shows.find(s => s.id === 'sh-1').notes = 'Note déjà là'; touch('shows'); });
  await go(page, 'production');
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.openProd.add('sh-1'); S.tab['prod:sh-1'] = 'notes'; (await import('./js/app.js')).render(); });
  const ta = page.locator('textarea.date-notes-ta');
  await expect(ta).toHaveValue('Note déjà là');
  await ta.fill('Note déjà là\nAccès par la cour.');
  await ta.blur();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.id === 'sh-1').notes)).toBe('Note déjà là\nAccès par la cour.');
  expectClean(ctx);
});

test('v1.53 dates « Artiste » : visibles dans Booking, absentes des montants (Booking, fiche artiste)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [
    { id: 'ar-1', project_id: 'art-a', structure_id: 'st-1', venue: 'Date via l’artiste', city: 'Ville', date: `${Y}-07-01`, status: 'Confirmée Artiste', fee_ht: 9999, prod_mode: 'booking' },
    { id: 'ar-2', project_id: 'art-a', structure_id: 'st-1', venue: 'Option via l’artiste', city: 'Ville', date: `${Y}-07-02`, status: 'Option Artiste', fee_ht: 7777, prod_mode: 'booking' }] });
  await go(page, 'booking', { year: Y });
  await expect(page.locator('main')).toContainText('Date via l’artiste');
  const head = await page.locator('main .view-head, main .vh-top').first().innerText();
  // seule la date confirmée salle / festival de la fausse base compte : 6 000 €
  expect(head.replace(/\s/g, ' ')).toMatch(/6\s000\s€ de cachets confirmés/);
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.projectPage = 'art-a'; (await import('./js/app.js')).go('projects'); });
  await page.evaluate(async () => { (await import('./js/actions.js')).ACTIONS.openProject({ dataset: { id: 'art-a' } }); });
  const t = await page.locator('main').innerText();
  expect(t).not.toMatch(/9\s?999|17\s?776|15\s?999/);
  expectClean(ctx);
});

test('v1.53 prospection : aucun artiste coché d’office, même avec un artiste choisi dans le filtre', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.project = 'art-a'; S.projects = ['art-a']; (await import('./js/prospection.js')).openProspection('st-1'); });
  await expect(page.locator('#modal')).toBeVisible();
  for (const c of await page.locator('#modal [data-pr-art]').all()) await expect(c).not.toBeChecked();
  await expect(page.locator('#pr-art-note')).toContainText('n’est pas repris d’office');
  // l'envoi sans artiste est refusé
  await page.locator('#pr-to-q').fill('contact@exemple.invalid');   // champ unique (v1.60.3) : validée à l'envoi
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('Coche au moins un artiste');
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expectClean(ctx);
});

test('v1.53 pièces jointes : fichiers choisis en deux fois gardés ; bilan des fichiers ajoutés et refusés', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { (await import('./js/forms.js')).editTask(null); });
  const inp = page.locator('#modal input[type=file][data-filelist]');
  await inp.setInputFiles([{ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') }]);
  await inp.setInputFiles([{ name: 'devis.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') }]);
  await expect(page.locator('#modal .file-row')).toHaveCount(2);
  // envoi direct : un fichier vide est refusé avec son motif, les autres ajoutés ; le bilan reste affiché
  await page.locator('#modal [data-act=closeModal]').first().click();
  await page.evaluate(async () => { const d = await import('./js/data.js');
    window.__p = d.uploadFiles({ prospect_id: 'pr-1' }, [new File(['abc'], 'photo.JPG', { type: 'image/jpeg' }), new File([], 'mail-vide.eml')]); });
  await expect(page.locator('dialog.ask')).toContainText('1 fichier ajouté, 1 refusé');
  await expect(page.locator('dialog.ask')).toContainText('✓ photo.JPG');
  await expect(page.locator('dialog.ask')).toContainText('✗ mail-vide.eml');
  await page.locator('dialog.ask button', { hasText: 'Fermer' }).click();
  expect(await page.evaluate(() => window.__DB.prospect_files.filter(f => f.prospect_id === 'pr-1' && f.name === 'photo.JPG').length)).toBe(1);
  expectClean(ctx);
});
