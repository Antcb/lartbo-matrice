// Lot V1.46b — Tâches (état des lieux V1, décisions Q17–Q20) :
//  - suppression depuis une fenêtre : fenêtre de dialogue de l'application ; « Annuler », Échap, clic dehors ne suppriment JAMAIS rien ;
//  - relance téléphone : deux issues nommées (« Supprimer seulement la tâche » / « Supprimer et clore le suivi ») + Annuler ;
//  - fenêtre de tâche : date et heure de réalisation (done_at) posées / effacées, 5 s pour annuler ;
//  - tâche ou suivi supprimé : ses fichiers stockés sont effacés aussi (plus de fichier orphelin).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push({ ...r }); S.db[table].push({ ...r }); } touch(table); }
  }, tables);
}
const db = (page, table, id) => page.evaluate(([t, i]) => window.__DB[t].find(r => r.id === i) || null, [table, id]);
const removed = page => page.evaluate(() => window.__calls.filter(c => c.storageRemove).flatMap(c => c.paths));
const openTask = (page, id) => page.evaluate(async i => { (await import('./js/forms.js')).editTask(i); }, id);

const PHONE = { id: 'tk-tel', title: 'Relance téléphone — Salle Exemple', status: 'To Do', auto_kind: 'relance_tel', prospect_id: 'pr-1', project_id: 'art-a', tags: ['Call'] };

test('v1.46b relance téléphone : « Annuler », Échap et clic dehors ne suppriment rien', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { tasks: [PHONE] });
  for (const how of ['annuler', 'echap', 'dehors']) {
    await openTask(page, 'tk-tel');
    await page.locator('#modal [data-act="modalDelete"]').click();
    const dlg = page.locator('dialog.ask');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Supprimer la tâche « Relance téléphone — Salle Exemple »');
    await expect(dlg.locator('button')).toHaveText(['Annuler', 'Supprimer seulement la tâche', 'Supprimer et clore le suivi']);
    await expect(dlg.locator('button', { hasText: 'Annuler' })).toBeFocused();
    if (how === 'annuler') await dlg.locator('button', { hasText: 'Annuler' }).click();
    else if (how === 'echap') await page.keyboard.press('Escape');
    else await page.mouse.click(5, 5);   // fond, hors de la fenêtre
    await expect(dlg).toHaveCount(0);
    expect(await db(page, 'tasks', 'tk-tel'), how).not.toBeNull();
    expect((await db(page, 'prospects', 'pr-1')).status, how + ' : suivi inchangé').toBe('Interest');
    await page.locator('#modal [data-act="closeModal"]').first().click();
  }
  expectClean(ctx);
});

test('v1.46b téléphone (375 px) : les trois boutons de la question, « Annuler » compris, sont entièrement visibles', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  const ctx = await openApp(page);
  await seed(page, { tasks: [PHONE] });
  await openTask(page, 'tk-tel');
  await page.locator('#modal [data-act="modalDelete"]').click();
  for (const b of await page.locator('dialog.ask button').all()) {
    const r = await b.boundingBox();
    expect(r.x, await b.textContent()).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width, await b.textContent()).toBeLessThanOrEqual(375);
  }
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  expect(await db(page, 'tasks', 'tk-tel')).not.toBeNull();
  expectClean(ctx);
});

test('v1.46b relance téléphone : « Supprimer seulement la tâche » garde le suivi ouvert ; « Supprimer et clore » le clôt', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { tasks: [PHONE, { ...PHONE, id: 'tk-tel2' }] });
  await openTask(page, 'tk-tel');
  await page.locator('#modal [data-act="modalDelete"]').click();
  await page.locator('dialog.ask button', { hasText: 'Supprimer seulement la tâche' }).click();
  await expect.poll(() => db(page, 'tasks', 'tk-tel')).toBeNull();
  expect((await db(page, 'prospects', 'pr-1')).status).toBe('Interest');
  await openTask(page, 'tk-tel2');
  await page.locator('#modal [data-act="modalDelete"]').click();
  await page.locator('dialog.ask button', { hasText: 'Supprimer et clore le suivi' }).click();
  await expect.poll(() => db(page, 'tasks', 'tk-tel2')).toBeNull();
  expect((await db(page, 'prospects', 'pr-1')).status).toBe('Closed');
  expectClean(ctx);
});

test('v1.46b tâche supprimée : ses pièces jointes et leurs fichiers stockés partent avec elle', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { tasks: [{ id: 'tk-pj', title: 'Envoyer le kit', status: 'To Do', project_id: 'art-a', tags: [] }],
    attachments: [{ id: 'at-1', task_id: 'tk-pj', name: 'kit.pdf', path: 'taches/tk-pj/kit.pdf' }, { id: 'at-2', task_id: 'tk-pj', name: 'plan.pdf', path: 'taches/tk-pj/plan.pdf' }] });
  await openTask(page, 'tk-pj');
  await page.locator('#modal [data-act="modalDelete"]').click();
  await expect(page.locator('dialog.ask')).toContainText('et ses 2 pièces jointes');
  await page.locator('dialog.ask button', { hasText: 'Supprimer la tâche' }).click();
  await expect.poll(() => db(page, 'tasks', 'tk-pj')).toBeNull();
  expect(await page.evaluate(() => window.__DB.attachments.filter(a => a.task_id === 'tk-pj').length)).toBe(0);
  expect((await removed(page)).sort()).toEqual(['taches/tk-pj/kit.pdf', 'taches/tk-pj/plan.pdf']);
  expectClean(ctx);
});

test('v1.46b suivi supprimé depuis sa fenêtre ou la liste : journal, pièces et fichiers stockés effacés ; les liens ne sont pas des fichiers', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { prospects: [{ id: 'pr-x', name: 'Suivi', project_id: 'art-a', structure_id: 'st-2', status: 'Interest' }, { id: 'pr-y', name: 'Suivi', project_id: 'art-a', structure_id: 'st-2', status: 'Mailed' }],
    prospect_logs: [{ id: 'lg-x', prospect_id: 'pr-x', date: '2026-01-02', kind: 'Appel', body: 'note' }],
    prospect_files: [{ id: 'pf-1', prospect_id: 'pr-x', name: 'mail.pdf', path: 'suivis/pr-x/mail.pdf', mime: 'application/pdf' },
      { id: 'pf-2', prospect_id: 'pr-x', name: 'Lien', path: 'https://example.com/doc', mime: 'link' },
      { id: 'pf-3', prospect_id: 'pr-y', name: 'devis.pdf', path: 'suivis/pr-y/devis.pdf', mime: 'application/pdf' }] });
  // depuis la fenêtre du suivi
  await page.evaluate(async () => (await import('./js/forms.js')).editProspect('pr-x'));
  await page.locator('#modal [data-act="modalDelete"]').click();
  await expect(page.locator('dialog.ask')).toContainText('avec son journal (1 échange) et 1 fichier joint');
  await page.locator('dialog.ask button', { hasText: 'Supprimer le suivi' }).click();
  await expect.poll(() => db(page, 'prospects', 'pr-x')).toBeNull();
  expect(await removed(page)).toEqual(['suivis/pr-x/mail.pdf']);
  // depuis la liste : « Annuler » ne supprime rien, puis suppression
  await page.evaluate(async () => { const { ACTIONS } = await import('./js/actions.js'); ACTIONS.delProspect({ dataset: { id: 'pr-y' } }); });
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  expect(await db(page, 'prospects', 'pr-y')).not.toBeNull();
  await page.evaluate(async () => { const { ACTIONS } = await import('./js/actions.js'); ACTIONS.delProspect({ dataset: { id: 'pr-y' } }); });
  await page.locator('dialog.ask button', { hasText: 'Supprimer le suivi' }).click();
  await expect.poll(() => db(page, 'prospects', 'pr-y')).toBeNull();
  expect(await removed(page)).toEqual(['suivis/pr-x/mail.pdf', 'suivis/pr-y/devis.pdf']);
  expectClean(ctx);
});

test('v1.46b fenêtre de tâche : « Faite » note la date et l’heure (5 s pour annuler) ; revenir « À faire » l’efface', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { tasks: [{ id: 'tk-f', title: 'Appeler la salle', status: 'To Do', project_id: 'art-a', tags: [] }] });
  const avant = Date.now();
  await openTask(page, 'tk-f');
  await page.locator('#modal select[name="status"]').selectOption('Done');
  await page.locator('#modal button[type="submit"]').click();
  await expect.poll(async () => (await db(page, 'tasks', 'tk-f')).status).toBe('Done');
  const done = (await db(page, 'tasks', 'tk-f')).done_at;
  expect(Date.parse(done)).toBeGreaterThanOrEqual(avant - 1000);
  // annulation pendant 5 s : la tâche revient à faire, sans date
  await page.locator('.toast button', { hasText: 'Annuler' }).click();
  await expect.poll(async () => (await db(page, 'tasks', 'tk-f')).status).toBe('To Do');
  expect((await db(page, 'tasks', 'tk-f')).done_at ?? null).toBeNull();
  // annulée depuis la fenêtre : date posée aussi ; puis remise « À faire » : date effacée
  await openTask(page, 'tk-f');
  await page.locator('#modal select[name="status"]').selectOption('Cancelled');
  await page.locator('#modal button[type="submit"]').click();
  await expect.poll(async () => (await db(page, 'tasks', 'tk-f')).done_at).not.toBeNull();
  await openTask(page, 'tk-f');
  await page.locator('#modal select[name="status"]').selectOption('To Do');
  await page.locator('#modal button[type="submit"]').click();
  await expect.poll(async () => (await db(page, 'tasks', 'tk-f')).done_at ?? null).toBeNull();
  // nouvelle tâche créée directement « Faite » : datée
  await page.evaluate(async () => (await import('./js/forms.js')).editTask(null, { title: 'Déjà faite', status: 'Done' }));
  await page.locator('#modal button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.tasks.find(t => t.title === 'Déjà faite')?.done_at || null)).not.toBeNull();
  expectClean(ctx);
});
