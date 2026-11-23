// v1.66.2 — demande d'Anthony du 22/11/2026 (suivi Alti'Fest) : glisser depuis Apple Mail la LIGNE d'une conversation entière
// n'annonce que du texte (ni fichier ni lien « message: ») ; le navigateur refusait alors le dépôt sans rien dire (pas de « + »,
// aucune trace). La zone « Pièces jointes » accepte désormais ce glisser et explique quoi faire ; rien n'est joint ni envoyé.
// Les autres glisser (fichier, lien de mail, texte dans un champ, glisser commencé dans la page) gardent leur comportement.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function openSuivi(page){
  const ctx = await openApp(page);
  await page.evaluate(async () => {
    const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
    app.go('prospects'); S.suiviPage = 'pr-1'; app.render();
  });
  await expect(page.locator('.log-attach [data-drop]')).toBeVisible();
  return ctx;
}

/** Glisser simulé tel qu'un navigateur le donne : types annoncés, aucun fichier, texte seul */
async function fakeDrag(page, sel, { type, types, text = 'Altifest • FAV 2027' }){
  return page.evaluate(({ sel, type, types, text }) => {
    const z = document.querySelector(sel);
    const dt = { types, files: [], items: types.map(t => ({ kind: 'string', type: t, getAsString: cb => cb(text) })), dropEffect: 'none',
      getData: t => (types.includes(t) ? text : '') };
    const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'dataTransfer', { value: dt });
    z.dispatchEvent(e); return { accepte: e.defaultPrevented, effet: dt.dropEffect };
  }, { sel, type, types, text });
}

test('v1.66.2 conversation entière glissée depuis Apple Mail : zone acceptée au survol, message clair au dépôt, rien joint', async ({ page }) => {
  const ctx = await openSuivi(page);
  const zone = '.log-attach [data-drop]';
  // survol : accepté (le « + » vert du navigateur) — sur la zone, son texte et le bouton « Ajouter un fichier »
  expect(await fakeDrag(page, zone, { type: 'dragover', types: ['text/plain'] })).toEqual({ accepte: true, effet: 'copy' });
  expect((await fakeDrag(page, `${zone} .drop-hint`, { type: 'dragover', types: ['text/plain'] })).accepte).toBe(true);
  expect((await fakeDrag(page, `${zone} input[type=file]`, { type: 'dragover', types: ['text/plain', 'text/html'] })).accepte).toBe(true);
  // dépôt : message qui dit quoi faire ; rien envoyé au stockage, rien ajouté au suivi ; dépôt noté pour diagnostic
  const avant = await page.evaluate(() => [window.__DB.prospect_files.length, window.__DB.prospect_logs.length]);
  expect((await fakeDrag(page, zone, { type: 'drop', types: ['text/plain'] })).accepte).toBe(true);
  // (v1.66.5, Lit et Mixe) au lieu du seul message : fenêtre « Retrouver un mail dans la messagerie », rien n'est joint sans choix
  const dlg = page.locator('dialog.ask', { hasText: 'Retrouver un mail dans la messagerie' });
  await expect(dlg).toContainText('Safari n’a transmis que du texte');
  await expect(dlg.locator('#ask-input')).toHaveValue('Altifest • FAV 2027');
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  expect(await page.evaluate(() => [window.__DB.prospect_files.length, window.__DB.prospect_logs.length])).toEqual(avant);
  await expect.poll(() => page.evaluate(() => window.__DB.client_errors.filter(r => r.message === 'dépôt : aucun fichier').length)).toBeGreaterThan(0);
  expectClean(ctx);
});

test('v1.66.2 comportements inchangés : lien de mail, texte dans un champ, glisser interne, texte hors zone', async ({ page }) => {
  const ctx = await openSuivi(page);
  const zone = '.log-attach [data-drop]';
  // lien « message: » (un mail glissé) : toujours accepté
  expect((await fakeDrag(page, zone, { type: 'dragover', types: ['text/plain', 'text/uri-list'] })).accepte).toBe(true);
  // texte au-dessus d'un champ de saisie du journal : le navigateur garde la main (texte déposé normalement)
  expect((await fakeDrag(page, '.log-form textarea', { type: 'dragover', types: ['text/plain'] })).accepte).toBe(false);
  // texte hors d'une zone de pièces jointes : rien ne change
  expect((await fakeDrag(page, '.suivi-head', { type: 'dragover', types: ['text/plain'] })).accepte).toBe(false);
  // glisser commencé DANS la page (texte sélectionné, carte…) : jamais accepté par la zone
  await page.evaluate(() => document.querySelector('.suivi-head').dispatchEvent(new Event('dragstart', { bubbles: true })));
  expect((await fakeDrag(page, zone, { type: 'dragover', types: ['text/plain'] })).accepte).toBe(false);
  await page.evaluate(() => document.dispatchEvent(new Event('dragend', { bubbles: true })));
  expect((await fakeDrag(page, zone, { type: 'dragover', types: ['text/plain'] })).accepte).toBe(true);
  expectClean(ctx);
});
