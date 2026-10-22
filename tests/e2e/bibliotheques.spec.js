// Bibliothèques copiées localement (lot S9) : carte (Leaflet), export Excel (ExcelJS), Supabase JS.
// Aucune requête ne doit partir vers cdnjs ou jsDelivr.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const CDN = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/i;
const suivreCdn = page => { const vus = []; page.context().on('request', r => { if (CDN.test(r.url())) vus.push(r.url()); }); return vus; };

test('la carte (Leaflet local) s’affiche avec ses points, sans CDN', async ({ page }) => {
  const cdn = suivreCdn(page);
  const ctx = await openApp(page);
  await page.evaluate(() => import('./js/app.js').then(m => m.go('booking')));
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.locator('.leaflet-container path.leaflet-interactive').first()).toBeAttached();
  const info = await page.evaluate(() => ({ version: window.L?.version,
    styleCharge: getComputedStyle(document.querySelector('.leaflet-container')).overflow === 'hidden' }));
  expect(info).toEqual({ version: '1.9.4', styleCharge: true });
  expect(cdn, 'requêtes vers un CDN').toEqual([]);
  expectClean(ctx);
});

test('l’export Excel (ExcelJS local) produit un fichier .xlsx, sans CDN', async ({ page }) => {
  const cdn = suivreCdn(page);
  const ctx = await openApp(page);
  const telechargement = page.waitForEvent('download');
  await page.evaluate(async () => {
    const { exportTable } = await import('./js/exports.js');
    await exportTable({ name: 'Essai', title: 'Essai export', columns: [{ header: 'Lieu', key: 'lieu' }, { header: 'Cachet', key: 'cachet', type: 'eur' }],
      rows: [{ lieu: 'Salle Exemple', cachet: 6000 }] });
  });
  const d = await telechargement;
  expect(d.suggestedFilename()).toMatch(/Essai\.xlsx$/);
  const chemin = await d.path();
  const { statSync, readFileSync } = await import('node:fs');
  expect(statSync(chemin).size).toBeGreaterThan(1000);
  expect(readFileSync(chemin).subarray(0, 2).toString()).toBe('PK');   // un .xlsx est une archive zip
  expect(await page.evaluate(() => window.ExcelJS ? 'chargé' : 'absent')).toBe('chargé');
  expect(cdn, 'requêtes vers un CDN').toEqual([]);
  expectClean(ctx);
});

test('Supabase JS local : la vraie bibliothèque se charge et crée un client, sans aucune requête', async ({ browser }) => {
  // Contexte SANS fausse base : on charge le vrai fichier, avec une adresse fictive (aucun service réel)
  const c = await browser.newContext(), p = await c.newPage(), requetes = [];
  p.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173/')) requetes.push(r.url()); });
  const erreurs = []; p.on('pageerror', e => erreurs.push(e.message));
  await c.route('**/__page-vide.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>vide</title>' }));
  await p.goto('/__page-vide.html');
  await p.addScriptTag({ url: '/assets/vendor/supabase-js-2.45.4/supabase.js' });
  const r = await p.evaluate(() => {
    const client = window.supabase.createClient('https://exemple-fictif.invalid', 'cle-fictive', { auth: { persistSession: false, autoRefreshToken: false } });
    return { createClient: typeof window.supabase.createClient, from: typeof client.from, rpc: typeof client.rpc, auth: typeof client.auth?.getSession,
      storage: typeof client.storage?.from, channel: typeof client.channel };
  });
  expect(r).toEqual({ createClient: 'function', from: 'function', rpc: 'function', auth: 'function', storage: 'function', channel: 'function' });
  expect(erreurs).toEqual([]);
  expect(requetes, 'aucune requête extérieure').toEqual([]);
  await c.close();
});
