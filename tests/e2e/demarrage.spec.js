// Parcours 1 : démarrage de l'application et affichage de chaque onglet (ordinateur et téléphone)
import { test, expect } from '@playwright/test';
import { openApp, preparePage, expectClean, VIEWS } from './helpers.js';

test('l’application démarre avec la fausse base', async ({ page }) => {
  const ctx = await openApp(page);
  await expect(page.locator('#app')).toContainText('Artiste Alpha');
  expectClean(ctx);
});

for (const [label, size] of [['ordinateur', { width: 1440, height: 900 }], ['téléphone', { width: 390, height: 844 }]]) {
  test(`chaque onglet s’affiche sans erreur (${label})`, async ({ page }) => {
    await page.setViewportSize(size);
    const ctx = await openApp(page);
    for (const v of VIEWS) {
      await page.evaluate(view => window.matrice && import('./js/app.js').then(m => m.go(view)), v);
      await expect(page.locator('#app'), `onglet ${v}`).not.toBeEmpty();
      const shown = await page.evaluate(() => window.matrice.S.view);
      expect(shown, `onglet ${v} affiché`).toBe(v);
      const txt = await page.locator('#app').innerText();
      expect(txt, `onglet ${v} : valeur non calculée affichée`).not.toMatch(/\bNaN\b|\bundefined\b|\[object Object\]/);
    }
    expectClean(ctx);
  });
}

test('sans session, l’écran de connexion s’affiche', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/index.html');
  await expect(page.locator('#login-pw')).toBeVisible();
  expectClean(ctx);
});
