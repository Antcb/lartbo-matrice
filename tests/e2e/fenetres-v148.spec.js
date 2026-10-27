// Lot Fenêtres v1.48 (Q18–Q20) : plus aucune fenêtre native du navigateur (alert / confirm / prompt) ; questions de l'application
// qui nomment l'élément et ses conséquences ; « Annuler » / Échap ne font rien ; mot de passe en champ masqué ; copie de secours.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push({ ...r }); S.db[table].push({ ...r }); } touch(table); }
  }, tables);
}
const act = (page, name, dataset) => page.evaluate(([n, d]) => import('./js/actions.js').then(m => { m.ACTIONS[n]({ dataset: d, closest: () => null }); }), [name, dataset]);
const db = (page, table, id) => page.evaluate(([t, i]) => window.__DB[t].find(r => r.id === i) || null, [table, id]);
const dlg = page => page.locator('dialog.ask');

test('v1.48 suppression d’une ligne du journal : la question nomme l’entrée ; « Annuler » et Échap ne suppriment rien', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { prospect_logs: [{ id: 'lg-z', prospect_id: 'pr-1', date: '2026-02-03', kind: 'Appel', body: 'note' }] });
  await act(page, 'delLog', { id: 'lg-z' });
  await expect(dlg(page)).toContainText('« Appel du 03/02/2026 »');
  await dlg(page).locator('button', { hasText: 'Annuler' }).click();
  await act(page, 'delLog', { id: 'lg-z' });
  await expect(dlg(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg(page)).toHaveCount(0);
  expect(await db(page, 'prospect_logs', 'lg-z')).not.toBeNull();
  await act(page, 'delLog', { id: 'lg-z' });
  await dlg(page).locator('button', { hasText: 'Supprimer l’entrée' }).click();
  await expect.poll(() => db(page, 'prospect_logs', 'lg-z')).toBeNull();
  expectClean(ctx);
});

test('v1.48 mot de passe : champ masqué, 8 caractères minimum vérifiés dans la fenêtre, « Annuler » ne change rien', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(() => { window.__pw = []; });
  await page.evaluate(async () => { const { sb } = await import('./js/data.js'); sb.auth.updateUser = async o => { window.__pw.push(o.password.length); return { error: null }; }; });
  await act(page, 'changePw', {});
  const input = dlg(page).locator('#ask-input');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toBeFocused();
  await input.fill('court');
  await input.press('Enter');
  await expect(dlg(page).locator('.help.err')).toHaveText('Au moins 8 caractères');
  expect(await page.evaluate(() => window.__pw)).toEqual([]);
  await dlg(page).locator('button', { hasText: 'Annuler' }).click();
  expect(await page.evaluate(() => window.__pw)).toEqual([]);
  await act(page, 'changePw', {});
  await dlg(page).locator('#ask-input').fill('assez-long-1');
  await dlg(page).locator('button', { hasText: 'Changer le mot de passe' }).click();
  await expect.poll(() => page.evaluate(() => window.__pw)).toEqual([12]);
  expectClean(ctx);
});

test('v1.48 nouveau pôle : nom saisi dans la fenêtre, doublon refusé', async ({ page }) => {
  const ctx = await openApp(page);
  const before = await page.evaluate(async () => (await import('./js/selectors.js')).departments().map(d => d.name));
  await act(page, 'addDept', {});
  await dlg(page).locator('#ask-input').fill(before[0]);
  await dlg(page).locator('#ask-input').press('Enter');
  await expect(dlg(page).locator('.help.err')).toHaveText('Ce pôle existe déjà');
  await dlg(page).locator('#ask-input').fill('Pôle essai');
  await dlg(page).locator('#ask-input').press('Enter');
  await expect.poll(() => page.evaluate(async () => (await import('./js/selectors.js')).departments().map(d => d.name))).toContain('Pôle essai');
  expectClean(ctx);
});

test('v1.48 copie bloquée par le navigateur : le lien est présenté sélectionné dans une fenêtre (plus de prompt)', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('refusé')); });
  await act(page, 'copyFiche', { id: 'sh-1' });
  const box = dlg(page).locator('#ask-input');
  await expect(box).toBeVisible();
  await expect(box).toHaveValue(/fiche\.html\?t=jeton-fiche-test-0001/);
  expect(await box.evaluate(el => el.selectionEnd - el.selectionStart)).toBeGreaterThan(10);
  await dlg(page).locator('button', { hasText: 'Fermer' }).click();
  await expect(dlg(page)).toHaveCount(0);
  expectClean(ctx);
});

test('v1.48 suppression d’une date depuis sa fenêtre : la question nomme la date et ce qui part avec elle', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow('sh-2'); });
  await page.locator('#modal [data-act="modalDelete"]').click();
  await expect(dlg(page)).toContainText('Salle Exemple');
  await expect(dlg(page)).toContainText('lignes de facturation et son budget');
  await dlg(page).locator('button', { hasText: 'Annuler' }).click();
  expect(await db(page, 'shows', 'sh-2')).not.toBeNull();
  expectClean(ctx);
});
