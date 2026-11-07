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
// Corrigé en v1.60.2 (js/actions.js editLog) : le mail et le texte ne sont envoyés que s'ils ont changé.
test('changer seulement la date ne réenregistre pas le mail', async ({ page }) => {
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

test('modifier le texte du mail le réenregistre (mail et texte du journal)', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrirSuivi(page);
  await page.locator('[data-act="editLog"][data-id="lg-2"]').click();
  const zone = page.locator('#modal #log-html');
  await zone.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Ajout test');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => stocke(page)).toContain('Ajout test');
  const ecrit = await page.evaluate(() => window.__calls.filter(c => c.table === 'prospect_logs' && c.op === 'update').map(c => Object.keys(c.patch)));
  expect(ecrit.flat()).toEqual(expect.arrayContaining(['body_html', 'body']));
  expect(await page.evaluate(() => window.__DB.prospect_logs.find(l => l.id === 'lg-2').body)).toContain('Ajout test');
  expectClean(ctx);
});

test('modifier seulement l’en-tête met à jour le texte sans réenregistrer le mail', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await stocke(page);
  await ouvrirSuivi(page);
  await page.locator('[data-act="editLog"][data-id="lg-2"]').click();
  await page.locator('#modal [name="body"]').fill('En-tête modifié');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.prospect_logs.find(l => l.id === 'lg-2').body)).toMatch(/^En-tête modifié\n\n/);
  const ecrit = await page.evaluate(() => window.__calls.filter(c => c.table === 'prospect_logs' && c.op === 'update').map(c => Object.keys(c.patch)));
  expect(ecrit.flat()).toContain('body');
  expect(ecrit.flat()).not.toContain('body_html');
  expect(await stocke(page)).toBe(avant);
  expectClean(ctx);
});

for (const ou of ['journal', 'fenêtre « Modifier »']) test(`un mail ne peut pas recouvrir l’application — ${ou} (classes, variables CSS, dialog)`, async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => {
    const { S, touch } = await import('./js/state.js');
    const voile = 'width:100vw;height:100vh;top:0;left:0;z-index:99999;background:red';
    S.db.prospect_logs.find(l => l.id === 'lg-2').body_html =
      `<div class="toast" style="${voile}">A</div><div style="--p:fixed;position:var(--p);${voile}">B</div><dialog open style="${voile}">C</dialog><div class="ac-list" style="${voile}">D</div>`;
    touch('prospect_logs');
  });
  await ouvrirSuivi(page);
  const sel = ou === 'journal' ? '.log-mail' : '#modal #log-html';
  if (ou !== 'journal') await page.locator('[data-act="editLog"][data-id="lg-2"]').click();
  const fuite = await page.evaluate(sel => {
    const box = document.querySelector(sel).getBoundingClientRect();
    const pts = [[5, 5], [innerWidth - 5, 5], [innerWidth / 2, 20], [5, innerHeight - 5], [innerWidth - 5, innerHeight - 5]]
      .filter(([x, y]) => x < box.left || x > box.right || y < box.top || y > box.bottom);
    return pts.filter(([x, y]) => document.elementFromPoint(x, y)?.closest(sel)).map(p => p.join(','));
  }, sel);
  expect(fuite, 'points de l’écran hors du bloc recouverts par le mail').toEqual([]);
  expectClean(ctx);
});
