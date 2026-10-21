// Pages publiques (organisateur, artiste, salarié) : jeton valide et jeton invalide
import { test, expect } from '@playwright/test';
import { preparePage, expectClean } from './helpers.js';

const PAGES = [
  ['fiche.html', 'jeton-fiche-test-0001', 'Artiste Alpha'],
  ['artiste.html', 'jeton-artiste-test-0001', 'Artiste Alpha'],
  ['rh.html', 'jeton-rh-test-00000001', 'Dominique'],
];

for (const [file, token, expected] of PAGES) {
  test(`${file} : jeton valide`, async ({ page }) => {
    const ctx = await preparePage(page, { session: false });
    await page.goto(`/${file}?t=${token}`);
    await expect(page.locator('body')).toContainText(expected);
    expectClean(ctx);
  });
  test(`${file} : jeton invalide → message, aucune donnée`, async ({ page }) => {
    const ctx = await preparePage(page, { session: false });
    await page.goto(`/${file}?t=jeton-inconnu`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(expected);
    await expect(page.locator('body')).not.toBeEmpty();
    expectClean(ctx);
  });
}
