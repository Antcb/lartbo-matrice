// v1.59 — acompte par défaut d'un artiste (décision d'Anthony du 04/11/2026 : date > artiste > Réglages). Données FICTIVES.
// Côté base : public.default_acompte_for (migration 2026-11-05_v1.59), essayée à part sur une base jetable.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const iso = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const P = (id, extra = {}) => ({ id, project_id: 'art-a', venue: 'Salle ' + id, date: iso(40), status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 10000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15, ...extra });
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const ARTS = [{ id: 'art-30', name: 'Artiste Trente', active: true, mode: 'production', default_acompte_pct: 30 },
  { id: 'art-0', name: 'Artiste Zéro', active: true, mode: 'production', default_acompte_pct: 0 }];

test('v1.59 acompte par défaut : artiste, sinon Réglages ; 0 % de l’artiste = sans acompte ; la ligne de la date reste prioritaire', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { projects: ARTS, shows: [P('a-1', { status: 'Option Salle', project_id: 'art-30' }), P('a-2', { status: 'Option Salle', project_id: 'art-0' }),
    P('a-3', { status: 'Option Salle' }), P('a-4', { status: 'Option Salle', project_id: 'art-30' })],
    show_payments: [{ id: 'a4-a', show_id: 'a-4', kind: 'acompte', label: 'Acompte', pct: 40, sort: 1 }, { id: 'a4-s', show_id: 'a-4', kind: 'solde', label: 'Solde', pct: 60, sort: 2 }] });
  const def = id => page.evaluate(async i => (await import('./js/selectors.js')).defaultAcompte(i), id);
  expect(await def('art-30')).toBe(30);
  expect(await def('art-0')).toBe(0);
  expect(await def('art-a'), 'artiste sans valeur propre : Réglages (50)').toBe(50);
  const terms = async (id, n, v) => { const done = page.evaluate(async i => (await import('./js/confirm-flow.js')).validateTerms(i), id);
    await expect(page.locator('#modal #terms-n')).toHaveValue(n);
    if (v != null) await expect(page.locator('#modal [data-terms-ac="0"]')).toHaveValue(v);
    await page.locator('#modal [data-close], #modal button.ghost').first().click(); await done; };
  await terms('a-1', '1', '30');    // artiste à 30 %
  await terms('a-2', '0', null);    // artiste à 0 % : sans acompte
  await terms('a-3', '1', '50');    // Réglages
  await terms('a-4', '1', '40');    // la date garde l'acompte posé sur elle
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'show_payments' && c.op !== 'select').length)).toBe(0);
  expectClean(ctx);
});

test('v1.59 « Appliquer aux dates à venir » (Réglages) : les dates d’un artiste qui a son propre acompte gardent le sien', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { projects: ARTS, shows: [P('b-1', { project_id: 'art-30' }), P('b-2')],
    show_payments: ['b-1', 'b-2'].flatMap(s => [{ id: s + '-a', show_id: s, kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 }, { id: s + '-s', show_id: s, kind: 'solde', label: 'Solde', pct: 50, sort: 2 }]) });
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.settings.find(k => k.key === 'default_acompte_pct').value = 20; touch('settings');
    (await import('./js/views/settings.js')).applyAcompte(); });
  await expect(page.locator('dialog.ask')).toContainText('gardent le leur');
  await page.locator('dialog.ask button', { hasText: 'Appliquer' }).click();
  await expect.poll(() => page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'b-2').map(p => p.pct).sort())).toEqual([20, 80]);
  expect(await page.evaluate(() => window.__DB.show_payments.filter(p => p.show_id === 'b-1').map(p => p.pct))).toEqual([50, 50]);
  expectClean(ctx);
});

test('v1.59 fiche artiste : acompte par défaut entre 0 et 100, vide = Réglages', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { projects: ARTS });
  page.evaluate(async () => (await import('./js/forms.js')).editProject('art-30'));
  const inp = page.locator('#modal [name=default_acompte_pct]');
  await expect(inp).toHaveValue('30');
  await expect(inp).toHaveAttribute('placeholder', '50');
  await inp.fill('120');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast')).toContainText('entre 0 et 100');
  expect(await page.evaluate(() => window.__DB.projects.find(p => p.id === 'art-30').default_acompte_pct)).toBe(30);
  await inp.fill('');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.projects.find(p => p.id === 'art-30').default_acompte_pct)).toBeNull();
  expectClean(ctx, { allowErrorToasts: true });
});
