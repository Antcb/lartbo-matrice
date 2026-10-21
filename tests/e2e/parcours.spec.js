// Parcours essentiels : terminer une tâche, confirmer une date, filtrer par artiste
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const dbRow = (page, table, id) => page.evaluate(([t, i]) => window.__DB[t].find(r => r.id === i), [table, id]);

test('terminer une tâche enregistre le statut et la date réelle', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(() => import('./js/app.js').then(m => m.go('todo')));
  await page.locator('input[data-act="toggleTask"][data-id="tk-1"]').check();
  await expect.poll(() => dbRow(page, 'tasks', 'tk-1').then(t => t.status), { timeout: 12_000 }).toBe('Done');
  const t = await dbRow(page, 'tasks', 'tk-1');
  expect(t.done_at, 'date réelle de fin').toBeTruthy();
  expectClean(ctx);
});

test('confirmer une date crée ses lignes de facturation', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(() => import('./js/app.js').then(m => m.go('booking')));
  await page.locator('.gig[data-id="sh-2"] .what').click();
  await page.locator('#fld-status').selectOption('Confirmée Salle');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => dbRow(page, 'shows', 'sh-2').then(s => s.status)).toBe('Confirmée Salle');
  await expect.poll(() => page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'sh-2').length)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  expectClean(ctx);
});

test('le filtre artiste limite les dates affichées', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(() => import('./js/app.js').then(m => m.go('booking')));
  await expect(page.locator('.gig[data-id="sh-3"]')).toBeVisible();
  await page.evaluate(async () => { const st = await import('./js/state.js'); st.setProjects(['art-a']); (await import('./js/app.js')).render(); });
  await expect(page.locator('.gig[data-id="sh-3"]')).toHaveCount(0);
  await expect(page.locator('.gig[data-id="sh-1"]')).toBeVisible();
  expectClean(ctx);
});
