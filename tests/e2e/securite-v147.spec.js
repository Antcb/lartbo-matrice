// Lot Sécurité v1.47 (décision d'Anthony du 27/10/2026 : secrets exclusivement côté serveur, contrôle des droits, CSP adaptée,
// intégrations maintenues) :
//  - les scripts Google sont appelés par le relais serveur « script-google » : aucun code secret ne part du navigateur ;
//  - clé Brevo saisie par set_brevo_key, jamais affichée ni relue ; « Code secret » plus affiché dans les Réglages ;
//  - chaque page a sa politique de sécurité (CSP) et s'ouvre sans violation.
import { test, expect } from '@playwright/test';
import { openApp, preparePage, expectClean } from './helpers.js';

const setSetting = (page, key, value) => page.evaluate(async ([k, v]) => {
  const { S, touch } = await import('./js/state.js');
  const s = S.db.settings.find(x => x.key === k); if (s) s.value = v; else S.db.settings.push({ key: k, value: v }); touch('settings');
}, [key, value]);
const fnCalls = (page, name) => page.evaluate(n => window.__calls.filter(c => c.fn === n).map(c => c.body), name);

test('v1.47 scripts Google : appel par le relais serveur, sans code secret ni adresse envoyés par le navigateur', async ({ page }) => {
  const ctx = await openApp(page);
  await setSetting(page, 'drive_webhook_url', 'https://script.google.com/macros/s/exemple-principal/exec');
  await setSetting(page, 'prospect_script_url', 'https://script.google.com/macros/s/exemple-prospection/exec');
  const out = await page.evaluate(async () => {
    const m = await import('./js/mail.js'), p = await import('./js/prospection.js');
    return [await m.callScript('ping', { x: 1 }), await p.callProspect('status', { thread_id: 't-1' })];
  });
  expect(out).toEqual([{ ok: true }, { ok: true }]);
  const calls = await fnCalls(page, 'script-google');
  expect(calls).toEqual([{ target: 'main', action: 'ping', payload: { x: 1 } }, { target: 'prospect', action: 'status', payload: { thread_id: 't-1' } }]);
  expect(JSON.stringify(calls)).not.toMatch(/secret|script\.google\.com/);
  expectClean(ctx);
});

test('v1.47 scripts Google : une erreur du relais remonte en français, sans détail technique', async ({ page }) => {
  const ctx = await openApp(page);
  await setSetting(page, 'drive_webhook_url', 'https://script.google.com/macros/s/exemple-principal/exec');
  await page.evaluate(() => { window.__FN_ERROR = { 'script-google': 'Edge Function returned a non-2xx status code' }; });
  const msg = await page.evaluate(async () => { try { await (await import('./js/mail.js')).callScript('ping', {}); return 'aucune erreur'; } catch (e) { return e.message; } });
  expect(msg).toBe('Script Google injoignable pour le moment : réessaie dans un instant.');
  expectClean(ctx);
});

test('v1.47 Réglages : clé Brevo jamais affichée, saisie par la base (set_brevo_key) ; plus de code secret affiché ni copiable', async ({ page }) => {
  const ctx = await openApp(page);
  await setSetting(page, 'brevo_api_key', 'xkeysib-cle-fictive-ne-doit-jamais-sortir-0000');   // même si la base la renvoyait par erreur
  await setSetting(page, 'drive_webhook_secret', 'secret-fictif-ne-doit-jamais-sortir');
  await page.evaluate(async () => (await import('./js/app.js')).go('settings'));
  const html = await page.locator('#app').innerHTML();
  expect(html).not.toContain('cle-fictive');
  expect(html).not.toContain('secret-fictif');
  await expect(page.locator('[data-act="copySecret"]')).toHaveCount(0);
  await expect(page.locator('#set-brevo')).toHaveValue('');
  await page.locator('#set-brevo').fill('xkeysib-abcdefghijklmnopqrstuvwxyz0123');
  await page.locator('#set-brevo').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.rpc === 'set_brevo_key').map(c => c.args))).toEqual([{ k: 'xkeysib-abcdefghijklmnopqrstuvwxyz0123' }]);
  await expect(page.locator('#set-brevo')).toHaveValue('');
  expectClean(ctx);
});

test('v1.47 CSP : chaque page a sa politique de sécurité et s’ouvre sans violation', async ({ page }) => {
  const violations = [];
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => (window.__csp ||= []).push(e.violatedDirective + ' ' + e.blockedURI)));
  const ctx = await openApp(page);
  for (const v of ['production', 'projects', 'todo', 'prospects', 'contacts', 'structures', 'settings', 'employees']) {
    await page.evaluate(async x => (await import('./js/app.js')).go(x), v);
    await page.waitForTimeout(150);
  }
  violations.push(...await page.evaluate(() => window.__csp || []));
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
  expect(violations).toEqual([]);
  expectClean(ctx);
  for (const p of ['/fiche.html?t=jeton-fiche-test-0001', '/artiste.html?t=jeton-artiste-test-0001', '/rh.html?t=jeton-rh-test-00000001']) {
    const pc = await preparePage(page, { session: false });
    await page.goto(p);
    await page.waitForTimeout(400);
    expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').count(), p).toBe(1);
    expect(await page.evaluate(() => window.__csp || []), p).toEqual([]);
    expectClean(pc);
  }
});
