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

// V1-A lot A2 (décision d'Anthony du 25/10, option A1) : date booking → « Échéancier prévu au contrat », % et échéances, sans montant par ligne ;
// production, ou serveur actuel sans « prod_mode » : affichage inchangé.
const echeances = page => page.locator('.fiche-dl dt', { hasText: /Paiement|Échéancier/ }).locator('xpath=following-sibling::dd[1]');
test('fiche.html : date booking → « Échéancier prévu au contrat » sans montant par ligne', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/fiche.html?t=jeton-fiche-booking-001');
  await expect(page.locator('.fiche-dl dt', { hasText: 'Échéancier prévu au contrat' })).toBeVisible();
  await expect(page.locator('.fiche-dl dt', { hasText: /^Paiement$/ })).toHaveCount(0);
  await expect(echeances(page)).toContainText('Acompte : 30 %');
  await expect(echeances(page)).toContainText('à la signature');
  await expect(echeances(page)).toContainText('Solde : 70 %');
  await expect(echeances(page)).not.toContainText('HT');
  await expect(echeances(page)).not.toContainText('2 400');
  await expect(page.locator('.fiche-dl')).toContainText('8 000');   // le montant de la cession reste affiché
  expectClean(ctx);
});
for (const [token, why] of [['jeton-fiche-prodmode-01', 'date en production'], ['jeton-fiche-test-0001', 'serveur sans « prod_mode »']]) {
  test(`fiche.html : ${why} → affichage inchangé (« Paiement » avec montants)`, async ({ page }) => {
    const ctx = await preparePage(page, { session: false });
    await page.goto(`/fiche.html?t=${token}`);
    await expect(page.locator('.fiche-dl dt', { hasText: /^Paiement$/ })).toBeVisible();
    await expect(echeances(page)).toContainText('HT');
    await expect(page.locator('body')).not.toContainText('Échéancier prévu au contrat');
    expectClean(ctx);
  });
}
