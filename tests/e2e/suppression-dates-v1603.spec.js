// v1.60.3 — suppression contrôlée d'une date (demande d'Anthony du 07/11/2026) : une date rouverte (historique dans
// result_closures) se supprime par la fonction serveur delete_show, après une question qui dit ce qui part et ce qui reste ;
// refus clairs (facture émise, résultat clôturé, document Pennylane) ; jamais d'erreur technique de clé étrangère à l'écran.
// Les refus côté base sont essayés sur une vraie base PostgreSQL (supabase/repetitions/2026-11-07_v1.60.3_suppression_date_essai.sql).
import { test, expect } from '@playwright/test';
import { openApp, expectClean, preparePage } from './helpers.js';

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

test('v1.60.3 date au devis Pennylane : archivage proposé (motif obligatoire), hors des listes de travail, données gardées, puis restaurée', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DEVIS], show_payments: [{ id: 'pa-devis', show_id: 'sh-devis', kind: 'acompte', label: 'Acompte', pct: 30 }],
    notifications: [{ id: 'nt-devis', title: 'Pré-contrat à compléter — Salle Devis', show_id: 'sh-devis', created_at: new Date().toISOString(), read_by: [] }] });
  await openDelete(page, 'sh-devis');
  const q = dlg(page);
  await expect(q).toContainText('ne peut pas être supprimée');
  await expect(q).toContainText('Ses montants restent dans les vues financières et les comptes');
  await expect(q).toContainText('Ce n’est ni une annulation (son statut ne change pas) ni une suppression');
  await expect(q.locator('button', { hasText: 'Supprimer la date' })).toHaveCount(0);
  await q.locator('button', { hasText: 'Archiver la date' }).click();
  const m = dlg(page);
  await m.locator('button', { hasText: 'Archiver la date' }).click();   // motif vide : refusé, la fenêtre reste
  await expect(m.locator('#ask-input')).toBeVisible();
  await m.locator('#ask-input').fill('Date abandonnée, devis gardé');
  await m.locator('button', { hasText: 'Archiver la date' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  const c = await calls(page);
  expect(c.find(x => x.rpc === 'archive_show')?.args).toEqual({ p_show: 'sh-devis', p_reason: 'Date abandonnée, devis gardé' });
  expect(c.some(x => x.rpc === 'delete_show' || x.fn === 'pennylane' || (x.table === 'shows' && x.op !== 'select')), 'ni suppression, ni Pennylane, ni écriture directe').toBe(false);
  expect((await db(page, 'shows', 'sh-devis')).status).toBe('Confirmée Salle');   // pas une annulation
  // données gardées (vues financières), absente des listes de travail ; notification de la date retirée de la liste
  const st = await page.evaluate(async () => { const { S } = await import('./js/state.js'); const sel = await import('./js/selectors.js');
    return { db: S.db.shows.some(s => s.id === 'sh-devis'), pay: S.db.show_payments.some(p => p.show_id === 'sh-devis'),
      filtered: sel.showsFiltered({ year: false }).some(s => s.id === 'sh-devis'), notif: sel.activeNotifs().some(n => n.id === 'nt-devis') }; });
  expect(st).toEqual({ db: true, pay: true, filtered: false, notif: false });
  expect((await db(page, 'notifications', 'nt-devis')).withdrawn_reason).toBe('Date archivée');   // gardée (historique)
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.view = 'booking'; S.year = 2027; (await import('./js/app.js')).render(); });
  await expect(page.locator('.gig', { hasText: 'Salle Devis' })).toHaveCount(0);
  await page.locator('[data-act="toggleArchived"]').click();
  const panel = page.locator('.panel', { hasText: 'Dates archivées' });
  await expect(panel).toContainText('Salle Devis');
  await expect(panel).toContainText('Date abandonnée, devis gardé');
  await panel.locator('[data-act="restoreShow"]').click();
  await expect(dlg(page)).toContainText('Ses relances reprennent après un délai de 7 jours');
  await dlg(page).locator('button', { hasText: 'Restaurer la date' }).click();
  await expect(page.locator('.gig', { hasText: 'Salle Devis' })).toHaveCount(1);
  expectClean(ctx);
});

test('v1.60.3 archivage opérationnel : aucun montant financier ne change (facture impayée comprise), date signalée « date archivée »', async ({ page }) => {
  const ctx = await openApp(page);
  // date confirmée avec une facture d'acompte émise impayée (arrivée après l'archivage, par exemple), un encaissement et une dépense
  await seed(page, { shows: [{ ...DEVIS, id: 'sh-fin', venue: 'Salle Finances', date: '2027-04-10', contract_type: 'Cession', pennylane_quote_id: null, pennylane_quote_url: null }],
    show_payments: [{ id: 'pa-fin1', show_id: 'sh-fin', kind: 'acompte', label: 'Acompte', pct: 30, amount: 2100, invoice_number: 'F-31', sent_at: '2027-01-05' },
      { id: 'pa-fin2', show_id: 'sh-fin', kind: 'solde', label: 'Solde', pct: 70, amount: 4900, invoice_number: 'F-32', sent_at: '2027-03-01', paid_at: '2027-03-20' }],
    budget_lines: [{ id: 'bl-fin', project_id: 'art-a', show_id: 'sh-fin', category: 'Salle', label: 'Location', amount: 800, paid_at: '2027-03-02', payer: 'compte' }] });
  const finance = () => page.evaluate(async () => {
    const { S } = await import('./js/state.js'); S.view = 'production'; S.year = 2027; (await import('./js/app.js')).render();
    const b = await import('./js/budget.js'); const sel = await import('./js/selectors.js');
    return { stats: [...document.querySelectorAll('.stat-row .stat')].filter(x => !/Relance/.test(x.textContent)).map(x => x.textContent.trim()),
      account: JSON.stringify(b.accountOf('art-a')), moves: b.accountMoves('art-a').length,
      gig: !!document.querySelector('#prod-sh-fin'), listed: sel.showsFiltered().some(s => s.id === 'sh-fin') }; });
  const avant = await finance();
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.shows.find(s => s.id === 'sh-fin').archived_at = '2027-04-01T10:00:00Z'; touch('shows'); });
  const apres = await finance();
  expect(avant.stats.find(x => /impayées/.test(x)), 'la facture impayée est bien comptée').toMatch(/2\s?100/);
  expect(apres.stats, 'indicateurs financiers de Production').toEqual(avant.stats);
  expect(apres.account, 'compte de l’artiste').toBe(avant.account);
  expect(apres.moves).toBe(avant.moves);
  expect(avant.listed && !apres.listed, 'sortie de la liste de travail seulement').toBe(true);
  // mention visible là où elle reste comptée
  await expect(page.locator('.panel', { hasText: 'Dates archivées comptées dans ces montants' })).toContainText('Salle Finances');
  await expect(page.locator('.panel', { hasText: 'Dates archivées comptées dans ces montants' }).locator('.badge', { hasText: 'date archivée' })).toHaveCount(1);
  // relances suspendues pendant l'archivage ; après restauration, aucune relance accumulée tout de suite (délai de 7 jours)
  const rel = await page.evaluate(async () => { const { S } = await import('./js/state.js'); const r = await import('./js/reminders.js');
    const s = S.db.shows.find(x => x.id === 'sh-fin'); const archivee = r.remindersOf(s).length;
    s.archived_at = null; s.restored_at = new Date().toISOString(); const rest = r.remindersOf(s);
    return { archivee, restauree: rest.length, enRetard: rest.filter(x => x.late).length }; });
  expect(rel.archivee).toBe(0);
  expect(rel.restauree).toBeGreaterThan(0);
  expect(rel.enRetard).toBe(0);
  expectClean(ctx);
});

test('v1.60.3 alerte « facture sur une date archivée » : visible dans les notifications, ouvre les dates archivées', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [{ ...DEVIS, id: 'sh-al', venue: 'Salle Alerte', archived_at: '2027-04-01T10:00:00Z', archived_reason: 'abandon' }],
    notifications: [{ id: 'nt-al', kind: 'date_archivee_facture', title: 'Facture sur une date archivée — Salle Alerte', body: 'comptée dans les montants', show_id: 'sh-al', created_at: new Date().toISOString(), read_by: [] },
      { id: 'nt-old', kind: 'precontrat', title: 'Ancien rappel retiré', show_id: 'sh-al', created_at: new Date().toISOString(), read_by: [], withdrawn_at: '2027-04-01T10:00:00Z' }] });
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.notifOpen = true; (await import('./js/app.js')).render(); });
  await expect(page.locator('.notif-menu')).toContainText('Facture sur une date archivée — Salle Alerte');
  await expect(page.locator('.notif-menu')).not.toContainText('Ancien rappel retiré');
  await page.locator('.notif-menu [data-act="openNotif"][data-id="nt-al"]').click();
  await expect(page.locator('.panel', { hasText: 'Dates archivées' })).toContainText('Salle Alerte');
  expectClean(ctx);
});

test('v1.60.3 fiche publique d’une date archivée : « Dossier indisponible », message neutre', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.addInitScript(() => { window.__RPC_ERROR = { fiche_get: { code: 'P0001', message: 'Dossier indisponible' } }; });
  await page.goto('/fiche.html?t=jeton-fiche-test-0001');
  await expect(page.locator('.fiche-msg')).toHaveText('Dossier indisponible. Pour toute question, écris-nous à production@lartboristerie.com.');
  await expect(page.locator('body')).not.toContainText(/archiv/i);
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
