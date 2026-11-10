// Détacher une date de son suivi (demande d'Anthony du 10/11/2026) : seul le lien shows.prospect_id est retiré,
// rien n'est supprimé, une note au journal du suivi trace le détachement, le lien se refait par « Rattacher une date existante ».
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const writes = page => page.evaluate(() => window.__calls.filter(c => c.table && c.op !== 'select').map(c => ({ table: c.table, op: c.op, patch: c.patch })));

async function ouvrirSuiviAvecDates(page) {
  // sh-1 : rattachée explicitement (autre structure, même artiste) ; sh-2 : même structure et même artiste, listée sans lien enregistré
  await page.evaluate(async () => {
    const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
    for (const db of [window.__DB, S.db]) db.shows.find(s => s.id === 'sh-1').prospect_id = 'pr-1';
    window.__calls.length = 0;
    app.go('prospects'); S.suiviPage = 'pr-1'; app.render();
  });
  await expect(page.locator('.plan-row[data-id="sh-1"]')).toBeVisible();
}

test('« Détacher du suivi » : seulement sur une date liée, Annuler ne touche à rien', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrirSuiviAvecDates(page);
  await expect(page.locator('.plan-row[data-id="sh-2"] [data-act="detachShow"]'), 'pas de lien en base : rien à détacher').toHaveCount(0);
  await page.locator('.plan-row[data-id="sh-1"] [data-act="detachShow"]').click();
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Rien n\'est supprimé');
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  await expect(dlg).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'sh-1').prospect_id)).toBe('pr-1');
  expectClean(ctx);
});

test('détacher retire seulement le lien, note le détachement au journal, et le lien se refait', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await page.evaluate(() => ({ show: { ...window.__DB.shows.find(s => s.id === 'sh-1') }, logs: window.__DB.prospect_logs.length,
    pays: JSON.stringify(window.__DB.show_payments), tasks: JSON.stringify(window.__DB.tasks || []) }));
  await ouvrirSuiviAvecDates(page);
  await page.locator('.plan-row[data-id="sh-1"] [data-act="detachShow"]').click();
  await page.locator('dialog.ask').getByRole('button', { name: 'Détacher du suivi' }).click();
  await expect(page.locator('.plan-row[data-id="sh-1"]'), 'date plus listée dans ce suivi').toHaveCount(0);

  const w = await writes(page);
  expect(w.filter(c => c.op === 'delete'), 'aucune suppression').toEqual([]);
  expect(w.filter(c => c.table === 'shows')).toEqual([{ table: 'shows', op: 'update', patch: { prospect_id: null } }]);
  const logs = w.filter(c => c.table === 'prospect_logs');
  expect(logs.map(c => c.op)).toEqual(['insert']);
  expect(logs[0].patch).toMatchObject({ prospect_id: 'pr-1', kind: 'Note', author: 'testeur@example.com' });
  expect(logs[0].patch.body).toContain('Date détachée de ce suivi');
  expect(w.every(c => ['shows', 'prospect_logs'].includes(c.table)), 'aucune autre table écrite').toBe(true);

  const apres = await page.evaluate(() => ({ show: { ...window.__DB.shows.find(s => s.id === 'sh-1') }, logs: window.__DB.prospect_logs.length,
    pays: JSON.stringify(window.__DB.show_payments), tasks: JSON.stringify(window.__DB.tasks || []) }));
  const { prospect_id: _a, updated_at: _u1, ...restAvant } = avant.show;
  const { prospect_id: _b, updated_at: _u2, ...restApres } = apres.show;
  expect(apres.show.prospect_id).toBeNull();
  expect(restApres, 'la date garde toutes ses autres données').toEqual(restAvant);
  expect(apres.logs, 'journal du suivi : une ligne de plus, aucune retirée').toBe(avant.logs + 1);
  expect(apres.pays).toBe(avant.pays);
  expect(apres.tasks).toBe(avant.tasks);
  await expect(page.locator('.suivi-block')).toContainText('Date détachée de ce suivi');

  // le rattachement existant refait le lien
  await page.evaluate(() => { const el = document.querySelector('[data-link-show="pr-1"]'); el.value = 'sh-1'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.id === 'sh-1').prospect_id)).toBe('pr-1');
  await expect(page.locator('.plan-row[data-id="sh-1"]')).toBeVisible();
  expectClean(ctx);
});
