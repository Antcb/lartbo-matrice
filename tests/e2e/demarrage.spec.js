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

test('le garde-fou réseau détecte tout appel à un service réel (page, nouvel onglet, WebSocket)', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(() => {
    fetch('https://exemple-interdit.supabase.co/rest/v1/x').catch(() => {});
    const a = Object.assign(document.createElement('a'), { href: 'https://script.google.com/macros/s/exemple/exec', target: '_blank', id: 'lien-test', textContent: 'lien de test' });
    a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff';
    document.body.appendChild(a);
    try { new WebSocket('wss://exemple-interdit.supabase.co/realtime'); } catch {}
  });
  const shared = await page.evaluate(() => { try { new SharedWorker('data:text/javascript,1'); return 'créé'; } catch (e) { return 'refusé'; } });
  expect(shared, 'SharedWorker').toBe('refusé');
  await page.locator('#lien-test').click();
  await expect.poll(() => ctx.external.length).toBeGreaterThanOrEqual(3);
  expect(ctx.external.join(' ')).toMatch(/https:\/\/script\.google\.com/);
  expect(ctx.external.join(' ')).toMatch(/websocket : wss:\/\/exemple-interdit/);
});

test('seconde barrière : aucun domaine extérieur joignable, même hors du routage des tests', async ({ browser }) => {
  const c = await browser.newContext(), p = await c.newPage();   // contexte SANS routage
  for (const u of ['https://example.com/', 'https://exemple-interdit.supabase.co/rest/v1/', 'http://example.com/']) {
    const r = await p.goto(u).then(() => 'joint', e => (e.message.match(/net::\w+/) || ['erreur'])[0]);
    expect(r, u).toBe('net::ERR_NAME_NOT_RESOLVED');
  }
  await c.close();
});
