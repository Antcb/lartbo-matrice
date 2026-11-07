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
  await expect(q).toContainText('1 tâche liée, détachée de la date, avec la mention « Date supprimée le … »');
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

test('v1.60.3 facture émise, résultat clôturé : refus clair, aucune question, rien n’est supprimé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, {
    shows: [{ ...ROUVERTE, id: 'sh-fact', venue: 'Salle Facturée' }, { ...ROUVERTE, id: 'sh-clos', venue: 'Salle Clôturée', result_closed_at: '2027-03-13T10:00:00Z' },
      ],
    show_payments: [{ id: 'pa-fact', show_id: 'sh-fact', kind: 'acompte', label: 'Acompte', amount: 300, invoice_number: 'F-0001', sent_at: '2027-01-10' }],
  });
  // (date au devis Pennylane : l'archivage est proposé à la place, test plus bas)
  for (const [id, msg] of [['sh-fact', 'Cette date a des factures émises'], ['sh-clos', 'Le résultat de cette date est clôturé : rouvre-le d’abord']]) {
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

// ─── Réponses d'Anthony du 07/11 : archivage distinct d'une annulation, tâches détachées signalées ───
const DEVIS = { ...ROUVERTE, id: 'sh-devis', venue: 'Salle Devis', contract_type: 'Cession', status: 'Confirmée Salle', fee_ht: 7000, pennylane_quote_id: '42',
  pennylane_quote_url: 'https://exemple.invalid/devis' };

test('v1.60.3 date au devis Pennylane : archivage proposé (motif obligatoire), hors listes et totaux, puis restaurée', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DEVIS], show_payments: [{ id: 'pa-devis', show_id: 'sh-devis', kind: 'acompte', label: 'Acompte', pct: 30 }] });
  await openDelete(page, 'sh-devis');
  const q = dlg(page);
  await expect(q).toContainText('ne peut pas être supprimée');
  await expect(q).toContainText('Cette date est liée à un document Pennylane');
  await expect(q).toContainText('Ce n’est pas une annulation : son statut ne change pas. Rien n’est modifié ni supprimé dans Pennylane.');
  await expect(q.locator('button', { hasText: 'Supprimer la date' })).toHaveCount(0);
  await q.locator('button', { hasText: 'Archiver la date' }).click();
  // motif obligatoire : vide refusé, la fenêtre reste
  const m = dlg(page);
  await expect(m.locator('#ask-input')).toBeVisible();
  await m.locator('button', { hasText: 'Archiver la date' }).click();
  await expect(m.locator('#ask-input')).toBeVisible();
  await m.locator('#ask-input').fill('Date abandonnée, devis gardé');
  await m.locator('button', { hasText: 'Archiver la date' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const c = await calls(page);
  expect(c.find(x => x.rpc === 'archive_show')?.args).toEqual({ p_show: 'sh-devis', p_reason: 'Date abandonnée, devis gardé' });
  expect(c.some(x => x.rpc === 'delete_show' || x.fn === 'pennylane' || (x.table === 'shows' && x.op !== 'select')), 'ni suppression, ni Pennylane, ni écriture directe').toBe(false);
  expect((await db(page, 'shows', 'sh-devis')).status).toBe('Confirmée Salle');   // pas une annulation
  // hors de toutes les données de calcul (listes, totaux, comptes, relances, carte) ; gardée à part
  const st = await page.evaluate(async () => { const { S, ARCHIVED } = await import('./js/state.js'); const sel = await import('./js/selectors.js');
    return { db: S.db.shows.some(s => s.id === 'sh-devis'), pay: S.db.show_payments.some(p => p.show_id === 'sh-devis'), filtered: sel.showsFiltered().some(s => s.id === 'sh-devis'),
      arch: ARCHIVED.shows.map(s => s.id), archPay: ARCHIVED.show_payments.map(p => p.id) }; });
  expect(st).toEqual({ db: false, pay: false, filtered: false, arch: ['sh-devis'], archPay: ['pa-devis'] });
  // Booking : absente de la liste, consultable dans « Dates archivées » avec son motif, puis restaurée
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.view = 'booking'; S.year = 2027; (await import('./js/app.js')).render(); });
  await expect(page.locator('.gig', { hasText: 'Salle Devis' })).toHaveCount(0);
  await page.locator('[data-act="toggleArchived"]').click();
  const panel = page.locator('.panel', { hasText: 'Dates archivées' });
  await expect(panel).toContainText('Salle Devis');
  await expect(panel).toContainText('Date abandonnée, devis gardé');
  await panel.locator('[data-act="restoreShow"]').click();
  await dlg(page).locator('button', { hasText: 'Restaurer la date' }).click();
  await expect(page.locator('.gig', { hasText: 'Salle Devis' })).toHaveCount(1);
  expect(await page.evaluate(async () => { const { S } = await import('./js/state.js'); return S.db.show_payments.some(p => p.id === 'pa-devis'); })).toBe(true);
  expectClean(ctx);
});

test('v1.60.3 facture émise : ni suppression ni archivage (la date reste dans les comptes et les relances)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [{ ...DEVIS, id: 'sh-fe' }], show_payments: [{ id: 'pa-fe', show_id: 'sh-fe', kind: 'acompte', label: 'Acompte', amount: 2100, invoice_number: 'F-9', pennylane_id: '9' }] });
  await openDelete(page, 'sh-fe');
  await expect(toasts(page).last()).toContainText('Cette date a des factures émises');
  await expect(dlg(page)).toHaveCount(0);
  expect((await calls(page)).some(x => x.rpc === 'archive_show' || x.rpc === 'delete_show')).toBe(false);
  expectClean(ctx);
});

test('v1.60.3 tâches détachées : annoncées, puis signalées par la mention « Date supprimée » dans leur note', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [ROUVERTE], tasks: [{ id: 'tk-a', title: 'Relancer la salle', status: 'To Do', show_id: 'sh-rouv', tags: [], notes: 'note existante' }] });
  await openDelete(page, 'sh-rouv');
  await expect(dlg(page)).toContainText('1 tâche liée, détachée de la date, avec la mention « Date supprimée le … » en tête de leur note');
  await dlg(page).locator('button', { hasText: 'Supprimer la date' }).click();
  await expect(toasts(page).last()).toContainText('1 tâche gardée, avec la mention « Date supprimée » dans la note');
  const t = await page.evaluate(async () => (await import('./js/state.js')).S.db.tasks.find(x => x.id === 'tk-a'));
  expect(t.show_id).toBeNull();
  expect(t.notes).toBe('Date supprimée le 07/11/2026 : 2027-03-12 · Salle Rouverte\nnote existante');
  expectClean(ctx);
});
