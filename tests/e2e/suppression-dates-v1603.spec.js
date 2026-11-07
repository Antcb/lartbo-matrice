// v1.60.3 — suppression contrôlée d'une date (demande d'Anthony du 07/11/2026) : une date rouverte (historique dans
// result_closures) se supprime par la fonction serveur delete_show, après une question qui dit ce qui part et ce qui reste ;
// refus clairs (facture émise, résultat clôturé, document Pennylane) ; jamais d'erreur technique de clé étrangère à l'écran.
// Les refus côté base sont essayés sur une vraie base PostgreSQL (supabase/repetitions/2026-11-07_v1.60.3_suppression_date_essai.sql).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push({ ...r }); (S.db[table] ||= []).push({ ...r }); } touch(table); }
  }, tables);
}
const db = (page, table, id) => page.evaluate(([t, i]) => window.__DB[t].find(r => r.id === i) || null, [table, id]);
const dlg = page => page.locator('dialog.ask');
const openDelete = async (page, id) => {
  await page.evaluate(async i => { (await import('./js/forms.js')).editShow(i); }, id);
  await page.locator('#modal [data-act="modalDelete"]').click();
};
const calls = page => page.evaluate(() => window.__calls);
const toasts = page => page.locator('.toast');
const ROUVERTE = { id: 'sh-rouv', project_id: 'art-a', venue: 'Salle Rouverte', date: '2027-03-12', status: 'Confirmée Salle', contract_type: 'Co-Production', fee_ht: 0, prod_mode: 'production' };

test('v1.60.3 date rouverte : question complète puis suppression contrôlée (historique archivé, tâche gardée, aucune facture touchée)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, {
    shows: [ROUVERTE],
    show_payments: [{ id: 'pa-rouv', show_id: 'sh-rouv', kind: 'autre', label: 'Recette', amount: 500 }],
    budget_lines: [{ id: 'bl-rouv', show_id: 'sh-rouv', category: 'Salle', label: 'Location', amount: 1000 }],
    tasks: [{ id: 'tk-rouv', title: 'Tâche de la date', status: 'To Do', show_id: 'sh-rouv', tags: [] }],
  });
  await page.evaluate(() => { window.__DB.result_closures.push({ id: 'rc-1', show_id: 'sh-rouv', action: 'close' }, { id: 'rc-2', show_id: 'sh-rouv', action: 'reopen', reason: 'Erreur' }); });
  await openDelete(page, 'sh-rouv');
  const q = dlg(page);
  await expect(q).toContainText('« 12/03/2027 · Salle Rouverte »');
  await expect(q).toContainText('1 ligne de facturation (non émise) et 1 ligne de budget');
  await expect(q).toContainText('1 tâche liée, sans lien vers la date');
  await expect(q).toContainText('Historique de clôture et de réouverture du résultat (2 entrées) : conservé dans le journal des suppressions');
  await expect(q).toContainText('Rien n’est supprimé dans Pennylane');
  await q.locator('button', { hasText: 'Supprimer la date' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const c = await calls(page);
  expect(c.some(x => x.rpc === 'delete_show' && x.args.p_show === 'sh-rouv')).toBe(true);
  expect(c.some(x => x.table === 'shows' && x.op === 'delete'), 'aucune suppression directe de la date').toBe(false);
  expect(await db(page, 'shows', 'sh-rouv')).toBeNull();
  expect((await db(page, 'tasks', 'tk-rouv')).show_id).toBeNull();
  expect(await page.evaluate(() => window.__DB.show_deletions.find(d => d.show_id === 'sh-rouv').snapshot.result_closures.length)).toBe(2);
  const local = await page.evaluate(async () => { const { S } = await import('./js/state.js');
    return { show: S.db.shows.some(s => s.id === 'sh-rouv'), pay: S.db.show_payments.some(p => p.show_id === 'sh-rouv'), task: S.db.tasks.find(t => t.id === 'tk-rouv').show_id }; });
  expect(local).toEqual({ show: false, pay: false, task: null });
  expectClean(ctx);
});

test('v1.60.3 « Annuler » ne supprime rien', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [ROUVERTE] });
  await openDelete(page, 'sh-rouv');
  await dlg(page).locator('button', { hasText: 'Annuler' }).click();
  expect((await calls(page)).some(x => x.rpc === 'delete_show')).toBe(false);
  expect(await db(page, 'shows', 'sh-rouv')).not.toBeNull();
  expectClean(ctx);
});

test('v1.60.3 facture émise, résultat clôturé, devis Pennylane : refus clair, aucune question, rien n’est supprimé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, {
    shows: [{ ...ROUVERTE, id: 'sh-fact', venue: 'Salle Facturée' }, { ...ROUVERTE, id: 'sh-clos', venue: 'Salle Clôturée', result_closed_at: '2027-03-13T10:00:00Z' },
      { ...ROUVERTE, id: 'sh-devis', venue: 'Salle Devis', contract_type: 'Cession', pennylane_quote_id: '42' }],
    show_payments: [{ id: 'pa-fact', show_id: 'sh-fact', kind: 'acompte', label: 'Acompte', amount: 300, invoice_number: 'F-0001', sent_at: '2027-01-10' }],
  });
  for (const [id, msg] of [['sh-fact', 'Cette date a des factures émises'], ['sh-clos', 'Le résultat de cette date est clôturé : rouvre-le d’abord'],
    ['sh-devis', 'Cette date est liée à un document Pennylane']]) {
    await openDelete(page, id);
    await expect(toasts(page).last()).toContainText(msg);
    await expect(dlg(page)).toHaveCount(0);
    await page.locator('#modal [data-act="closeModal"]').first().click();
    expect(await db(page, 'shows', id)).not.toBeNull();
  }
  expect((await calls(page)).some(x => x.rpc === 'delete_show' || (x.table === 'shows' && x.op === 'delete'))).toBe(false);
  expect(await db(page, 'show_payments', 'pa-fact')).not.toBeNull();
  expectClean(ctx);
});

test('v1.60.3 refus du serveur : message français affiché tel quel, la date reste', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [ROUVERTE] });
  await page.evaluate(() => { window.__RPC_ERROR = { show_deletion_state: { code: 'P0001', message: 'Cette date a 1 pièce à rattacher (onglet Factures) : rattache-la avant de supprimer la date.' } }; });
  await openDelete(page, 'sh-rouv');
  await expect(toasts(page).last()).toContainText('Cette date a 1 pièce à rattacher');
  await expect(dlg(page)).toHaveCount(0);
  expect(await db(page, 'shows', 'sh-rouv')).not.toBeNull();
  expectClean(ctx);
});

test('v1.60.3 serveur pas encore à jour : suppression directe comme avant, erreur de clé étrangère traduite', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [ROUVERTE] });
  const absent = { code: 'PGRST202', message: 'Could not find the function public.delete_show(p_show) in the schema cache' };
  await page.evaluate(a => { window.__RPC_ERROR = { show_deletion_state: a, delete_show: a };
    window.__DELETE_ERROR = { shows: { code: '23503', message: 'update or delete on table "shows" violates foreign key constraint "result_closures_show_id_fkey" on table "result_closures"' } }; }, absent);
  await openDelete(page, 'sh-rouv');
  await expect(dlg(page)).toContainText('Supprimer la date « 12/03/2027 · Salle Rouverte » ?');
  await expect(dlg(page)).not.toContainText('journal des suppressions');   // pas de promesse que l'ancien serveur ne tient pas
  await dlg(page).locator('button', { hasText: 'Supprimer la date' }).click();
  await expect(toasts(page).last()).toContainText('Suppression impossible : cet élément est encore relié à d’autres données de la Matrice');
  await expect(toasts(page).last()).not.toContainText(/foreign key|violates|result_closures/);
  expect(await db(page, 'shows', 'sh-rouv')).not.toBeNull();
  await expect(page.locator('#modal')).toBeVisible();   // refus : la fenêtre de la date reste ouverte
  // sans erreur : la suppression directe passe, comme avant la v1.60.3
  await page.evaluate(() => { window.__DELETE_ERROR = null; });
  await page.locator('#modal [data-act="modalDelete"]').click();
  await dlg(page).locator('button', { hasText: 'Supprimer la date' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await db(page, 'shows', 'sh-rouv')).toBeNull();
  expectClean(ctx);
});
