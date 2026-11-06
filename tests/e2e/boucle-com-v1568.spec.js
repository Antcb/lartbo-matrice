// v1.56.8 : date d'envoi de la boucle communication visible et modifiable dans Production (même donnée que l'onglet Communication),
// distincte du statut « mail préparé dans L'ArtBotrice » ; aucun mail préparé ni envoyé par la saisie.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const regler = (page, patch) => page.evaluate(async patch => { const { S, touch } = await import('./js/state.js');
  for (const db of [S.db, window.__DB]) Object.assign(db.shows.find(s => s.id === 'sh-1'), patch); touch('shows'); }, patch);
const ouvrir = (page, view) => page.evaluate(async view => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  app.go(view); if (view === 'production'){ S.openProd = new Set(['sh-1']); } app.render(); }, view);
const champProd = page => page.locator('.prod-actions .pa-stack input.dt-txt');
const champComm = page => page.locator('main table .dt:has(input.dt-val[data-id="sh-1"][data-f="boucle_com"]) input.dt-txt');
const ecritures = page => page.evaluate(() => window.__calls.filter(c => c.table === 'shows' && c.op === 'update' && c.patch && 'boucle_com' in c.patch).map(c => c.patch));
const mails = page => page.evaluate(() => window.__calls.filter(c => c.fn || (c.table === 'shows' && c.patch && 'mail_log' in c.patch)).length);

test('v1.56.8 : date déjà renseignée (mail parti hors de L’ArtBotrice) affichée dans Production, statut « préparé » distinct', async ({ page }) => {
  const ctx = await openApp(page);
  await regler(page, { boucle_com: '2026-10-20', mail_log: null });
  await ouvrir(page, 'production');
  await expect(champProd(page)).toHaveValue('20/10/2026');
  await expect(page.locator('.prod-actions .pa-stack')).toContainText('✓ Envoyée le');
  await expect(page.locator('.prod-actions .pa-stack')).not.toContainText('préparé');
  // brouillon préparé dans L'ArtBotrice : signalé à part, ne vaut pas envoi
  await regler(page, { boucle_com: null, mail_log: { boucle_com: { at: '2026-10-22T09:00:00Z', draft: true, sent: false } } });
  await ouvrir(page, 'production');
  await expect(champProd(page)).toHaveValue('');
  await expect(page.locator('.prod-actions .pa-stack')).toContainText('Mail préparé dans L’ArtBotrice le 22/10/2026');
  await expect(page.locator('.prod-actions .pa-stack')).not.toContainText('✓ Envoyée');
  expect(await ecritures(page)).toEqual([]);
  expectClean(ctx);
});

test('v1.56.8 : date vide → saisie, correction, effacement depuis Production, répercutés dans Communication (et inversement), sans mail', async ({ page }) => {
  const ctx = await openApp(page);
  await regler(page, { boucle_com: null, mail_log: null, date: new Date().getFullYear() + '-12-31' });   // date à venir : ligne ouverte dans Communication
  await ouvrir(page, 'production');
  await expect(champProd(page)).toHaveValue('');
  await expect(page.locator('.prod-actions .pa-stack')).toContainText('Date d’envoi');
  await champProd(page).fill('25/10/2026'); await champProd(page).press('Enter');
  await expect.poll(() => ecritures(page)).toEqual([{ boucle_com: '2026-10-25' }]);
  await ouvrir(page, 'communication');
  await expect(champComm(page)).toHaveValue('25/10/2026');
  // correction depuis Communication → visible dans Production
  await champComm(page).fill('27/10/2026'); await champComm(page).press('Enter');
  await expect.poll(async () => (await ecritures(page)).at(-1)).toEqual({ boucle_com: '2026-10-27' });
  await ouvrir(page, 'production');
  await expect(champProd(page)).toHaveValue('27/10/2026');
  // effacement depuis Production
  await champProd(page).fill(''); await champProd(page).press('Enter');
  await expect.poll(async () => (await ecritures(page)).at(-1)).toEqual({ boucle_com: null });
  await ouvrir(page, 'communication');
  await expect(champComm(page)).toHaveValue('');
  expect(await mails(page), 'aucun mail préparé ni envoyé').toBe(0);
  expectClean(ctx);
});
