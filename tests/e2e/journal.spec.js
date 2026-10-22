// Journal d'un suivi : affichage des mails enregistrés et fenêtre « Modifier » (interactions avec safeHtml)
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const ecritures = page => page.evaluate(() => window.__calls.filter(c => c.table === 'prospect_logs' && c.op !== 'select'));
const stocke = page => page.evaluate(() => window.__DB.prospect_logs.find(l => l.id === 'lg-2').body_html);

async function ouvrirSuivi(page) {
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); app.go('prospects'); S.suiviPage = 'pr-1'; app.render(); });
  await expect(page.locator('.log-mail')).toBeVisible();
}

test('le mail enregistré s’affiche, nettoyé, sans rien réécrire dans la base', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await stocke(page);
  await ouvrirSuivi(page);
  const mail = page.locator('.log-mail');
  await expect(mail).toContainText('Cachet : 4 000 € HT');
  await expect(mail.locator('td[colspan="2"]')).toHaveCount(1);
  await expect(mail.locator('a[href="https://example.com/fiche"]')).toHaveAttribute('target', '_blank');
  expect(await ecritures(page), 'aucune écriture à l’affichage').toEqual([]);
  expect(await stocke(page), 'mail stocké inchangé').toBe(avant);
  expectClean(ctx);
});

test('ouvrir « Modifier » puis annuler ne réécrit pas le mail', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await stocke(page);
  await ouvrirSuivi(page);
  await page.locator('[data-act="editLog"][data-id="lg-2"]').click();
  await expect(page.locator('#modal #log-html')).toContainText('Cachet : 4 000 € HT');
  await page.locator('#modal [data-act="closeModal"]').first().click();
  expect(await ecritures(page)).toEqual([]);
  expect(await stocke(page)).toBe(avant);
  expectClean(ctx);
});

// Règle demandée par Anthony (22/10/2026) : changer la date d'un échange ne doit pas réenregistrer le mail non modifié.
// Pas encore développé (lot dédié) : ce test est marqué « échec attendu » ; il deviendra un test normal avec la correction.
test('changer seulement la date ne réenregistre pas le mail (à corriger, lot dédié)', async ({ page }) => {
  test.fail(true, 'comportement actuel : le mail est réenregistré à chaque enregistrement de la fenêtre');
  const ctx = await openApp(page);
  await ouvrirSuivi(page);
  await page.locator('[data-act="editLog"][data-id="lg-2"]').click();
  await page.locator('#modal #fld-date').fill('2027-01-15');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.prospect_logs.find(l => l.id === 'lg-2').date)).toBe('2027-01-15');
  const ecrit = await page.evaluate(() => window.__calls.filter(c => c.table === 'prospect_logs' && c.op === 'update').map(c => Object.keys(c.patch)));
  expect(ecrit.flat(), 'le contenu du mail ne doit pas faire partie de l’enregistrement').not.toContain('body_html');
  expectClean(ctx);
});
