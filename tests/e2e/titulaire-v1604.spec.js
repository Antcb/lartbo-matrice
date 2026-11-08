// v1.60.4 — décision d'Anthony du 08/11/2026 : l'adresse du script de la boîte anthony@ (prospect_script_url) n'est modifiable que par
// le titulaire de la boîte (contrôle par la base : setting_write_ok et règles de settings, migration 2026-11-08_v1.60.4_titulaire.sql).
// Réglages : un autre membre reçoit une explication, la valeur est remise, rien n'est envoyé à la base. Test repris du lot
// messagerie (commit 9c6d61c). Fausse base : window.__MAILBOX_OWNER simule is_mailbox_owner.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

test('v1.60.4 : adresse du script de la boîte modifiable par son titulaire seulement (autre membre : explication, rien changé)', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { window.__MAILBOX_OWNER = false; (await import('./js/app.js')).go('settings'); });
  await expect(page.locator('#set-pscript')).toBeVisible();
  await expect(page.locator('main')).toContainText('Modifiable seulement par le titulaire de la boîte anthony@');
  await page.locator('#set-pscript').fill('https://script.google.com/macros/s/AKfy-pirate_1/exec');
  await page.locator('#set-pscript').dispatchEvent('change');
  await expect(page.locator('.toast').last()).toContainText('modifiable seulement par le titulaire de la boîte');
  expect(await page.evaluate(() => window.__DB.settings.find(s => s.key === 'prospect_script_url')?.value ?? null)).toBeNull();
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'settings' && c.op !== 'select').length)).toBe(0);
  await expect(page.locator('#set-pscript')).toHaveValue('');
  // autres réglages d'adresse : inchangés pour l'équipe (drive_webhook_url)
  await page.locator('#set-gas').fill('https://script.google.com/macros/s/AKfy-principal_1/exec');
  await page.locator('#set-gas').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => window.__DB.settings.find(s => s.key === 'drive_webhook_url')?.value ?? null)).toBe('https://script.google.com/macros/s/AKfy-principal_1/exec');
  // le titulaire, lui, modifie l'adresse de sa boîte
  await page.evaluate(() => { window.__MAILBOX_OWNER = true; });
  await page.locator('#set-pscript').fill('https://script.google.com/macros/s/AKfy-titulaire_1/exec');
  await page.locator('#set-pscript').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => window.__DB.settings.find(s => s.key === 'prospect_script_url')?.value ?? null)).toBe('https://script.google.com/macros/s/AKfy-titulaire_1/exec');
  expectClean(ctx);
});
