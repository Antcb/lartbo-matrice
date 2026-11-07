// v1.60.2 — pièces jointes du Suivi :
//  - photo JPG / PNG / HEIC ajoutée comme les autres pièces, avec son vrai type même quand le navigateur n'en donne pas ;
//  - glisser-déposer depuis Mail (Mac) : dépôt accepté même sans « Files » annoncé, fichiers lus aussi dans les éléments,
//    message quand rien n'est exploitable (avant : rien ne se passait) ;
//  - ajout de plusieurs fichiers d'un coup dans un suivi (livré en v1.53, vérifié ici).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

/** Ouvre le suivi pr-1 et note chaque envoi au stockage (chemin, type) dans window.__up */
async function openSuivi(page){
  const ctx = await openApp(page);
  await page.evaluate(async () => {
    const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); const d = await import('./js/data.js');
    window.__up = [];
    const from = d.sb.storage.from.bind(d.sb.storage);
    d.sb.storage.from = b => { const o = from(b), up = o.upload; o.upload = async (p, f, opt) => { window.__up.push({ b, p, type: opt?.contentType }); return up(p, f, opt); }; return o; };
    app.go('prospects'); S.suiviPage = 'pr-1'; app.render();
  });
  await expect(page.locator('.log-attach [data-drop]')).toBeVisible();
  return ctx;
}

/** Dépôt simulé tel que Chrome le donne pour un glisser depuis Mail : types sans « Files », liste files vide, fichier dans items */
async function fakeDrag(page, sel, { type, types, itemFiles = [] }){
  return page.evaluate(({ sel, type, types, itemFiles }) => {
    const z = document.querySelector(sel);
    const files = itemFiles.map(f => new File([f.body], f.name, { type: f.type }));
    const dt = { types, files: [], items: files.map(f => ({ kind: 'file', getAsFile: () => f })), dropEffect: 'none' };
    const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dt });
    z.dispatchEvent(e); return e.defaultPrevented;
  }, { sel, type, types, itemFiles });
}

test('v1.60.2 Suivi : JPG, PNG et HEIC ajoutés en une fois avec leur vrai type, même sans type donné par le navigateur', async ({ page }) => {
  const ctx = await openSuivi(page);
  await page.locator('.log-attach input[type=file][data-upload-owner]').setInputFiles([
    { name: 'photo.JPG', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') },
    { name: 'capture.png', mimeType: 'image/png', buffer: Buffer.from('png') },
    { name: 'devis.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') }]);
  await expect(page.locator('.toast').last()).toContainText('3 fichiers ajoutés');
  await expect(page.locator('.log-file .file-row')).toHaveCount(3);
  // photos sans type (cas d'un fichier venu d'une autre application) : type déduit de l'extension
  await page.evaluate(async () => { const d = await import('./js/data.js');
    await d.uploadFiles({ prospect_id: 'pr-1' }, [new File(['a'], 'IMG_0001.jpeg', { type: '' }), new File(['b'], 'IMG_0002.HEIC', { type: '' }), new File(['c'], 'notes.xyz', { type: '' })]); });
  const up = await page.evaluate(() => window.__up.map(u => [u.p.split('_').slice(1).join('_'), u.type, u.b]));
  expect(up).toEqual([
    ['photo.JPG', 'image/jpeg', 'suivi'], ['capture.png', 'image/png', 'suivi'], ['devis.pdf', 'application/pdf', 'suivi'],
    ['IMG_0001.jpeg', 'image/jpeg', 'suivi'], ['IMG_0002.HEIC', 'image/heic', 'suivi'], ['notes.xyz', 'application/octet-stream', 'suivi']]);
  const mimes = await page.evaluate(() => Object.fromEntries(window.__DB.prospect_files.filter(f => f.prospect_id === 'pr-1').map(f => [f.name, f.mime])));
  expect(mimes).toMatchObject({ 'photo.JPG': 'image/jpeg', 'IMG_0001.jpeg': 'image/jpeg', 'IMG_0002.HEIC': 'image/heic', 'notes.xyz': null });
  expectClean(ctx);
});

test('v1.60.2 Suivi : glisser depuis Mail sans « Files » annoncé — accepté, fichier lu dans les éléments, message si rien', async ({ page }) => {
  const ctx = await openSuivi(page);
  const zone = '.log-attach [data-drop]';
  // pendant le survol : la zone accepte le dépôt (sinon Chrome n'envoie jamais l'événement « drop »)
  expect(await fakeDrag(page, zone, { type: 'dragover', types: ['text/uri-list'] })).toBe(true);
  // hors d'une zone de pièces jointes, un simple lien n'est pas intercepté
  expect(await fakeDrag(page, '.suivi-head', { type: 'dragover', types: ['text/uri-list'] })).toBe(false);
  // dépôt : fichier présent seulement dans items
  expect(await fakeDrag(page, zone, { type: 'drop', types: ['text/uri-list'], itemFiles: [{ name: 'affiche.jpg', type: 'image/jpeg', body: 'jpg' }] })).toBe(true);
  await expect(page.locator('.toast').last()).toContainText('1 fichier ajouté : affiche.jpg');
  expect(await page.evaluate(() => window.__DB.prospect_files.some(f => f.prospect_id === 'pr-1' && f.name === 'affiche.jpg' && f.mime === 'image/jpeg'))).toBe(true);
  // dépôt sans aucun fichier exploitable : message explicite au lieu de ne rien faire
  await fakeDrag(page, zone, { type: 'drop', types: ['text/uri-list'] });
  await expect(page.locator('.toast').last()).toContainText('Rien à joindre');
  expectClean(ctx);
});

test('v1.60.2 fenêtres (tâche) : glisser depuis Mail dans une zone de formulaire — fichier ajouté à la liste', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { (await import('./js/forms.js')).editTask(null); });
  const zone = '#modal [data-drop-form]';
  await expect(page.locator(zone)).toBeVisible();
  expect(await fakeDrag(page, zone, { type: 'dragover', types: ['text/uri-list'] })).toBe(true);
  await fakeDrag(page, zone, { type: 'drop', types: ['text/uri-list'], itemFiles: [{ name: 'photo.jpg', type: 'image/jpeg', body: 'jpg' }] });
  await expect(page.locator('#modal .file-row')).toHaveCount(1);
  await expect(page.locator('#modal .file-row')).toContainText('photo.jpg');
  expectClean(ctx);
});
