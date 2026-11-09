// v1.64 — Réglages › Délais et automatismes (demande d'Anthony du 09/11/2026, §2).
// Délais EXISTANTS réglables (aucun nouvel automatisme) ; valeurs par défaut identiques ; avant d'enregistrer : conséquences sur les
// dates en cours et choix explicite (par défaut : nouvelles dates seulement, aucun recalcul) ; fenêtre de l'application ;
// prospection et tâche Booking : prochaines tâches seulement. Même règle côté serveur : tests/static/delais.mjs et
// supabase/repetitions/2026-11-09_v1.64_delais_essai.sql.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const old = new Date(Date.now() - 30 * 864e5).toISOString();
const P = (id, extra = {}) => ({ id, project_id: 'art-a', venue: 'Salle ' + id, date: iso(40), status: 'Confirmée Salle', created_at: old,
  contract_type: 'Cession', fee_ht: 10000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15, ...extra });

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push({ ...r }); S.db[table].push({ ...r }); } touch(table); }
  }, tables);
}
const rel = (page, id) => page.evaluate(async i => (await import('./js/reminders.js')).remindersOf((await import('./js/selectors.js')).byId('shows', i))
  .map(x => [x.key, x.due]), id);
const due = async (page, id, key) => (await rel(page, id)).find(x => x[0] === key)?.[1];
const delais = page => page.evaluate(async () => (await import('./js/selectors.js')).setting('delais'));
const goSettings = page => page.evaluate(async () => (await import('./js/app.js')).go('settings'));
const data = () => ({ shows: [P('d-1'), P('d-2', { created_at: new Date().toISOString() })], show_payments: [
  { id: 'd1-a', show_id: 'd-1', kind: 'acompte', label: 'Acompte', pct: 30, invoice_number: 'F-1', sent_at: iso(-3), sort: 1 },
  { id: 'd2-a', show_id: 'd-2', kind: 'acompte', label: 'Acompte', pct: 30, invoice_number: 'F-2', sent_at: iso(-3), sort: 1 },
] });

test('v1.64 Réglages : section « Délais et automatismes » avec les délais en place, sans style inline', async ({ page }) => {
  const ctx = await openApp(page);
  await goSettings(page);
  const panel = page.locator('#delays-panel');
  await expect(panel.locator('h3')).toHaveText('Délais et automatismes');
  await expect(panel.locator('[data-delay-n]')).toHaveCount(13);
  await expect(panel.locator('[data-delay-n="solde_envoi"]')).toHaveValue('7');
  await expect(panel.locator('[data-delay-n="facture_envoi"]')).toHaveValue('3');
  await expect(panel.locator('[data-delay-n="paiement"]')).toHaveValue('10');
  await expect(panel.locator('[data-delay-n="boucle_accueil"]')).toHaveValue('4');
  await expect(panel.locator('[data-task-delay="prospect_relance_days"]')).toHaveValue('10');
  await expect(panel.locator('[data-task-delay="prospect_relance_max"]')).toHaveValue('3');
  await expect(panel.locator('[data-task-delay="booking_task_days"]')).toHaveValue('10');
  for (const m of ['Préparer / émettre la facture', 'Envoyer la facture', 'Relance après impayé']) await expect(panel).toContainText(m);
  await expect(panel).toContainText('Échéance de paiement');
  expect(await panel.locator('[style]').count(), 'aucun style inline').toBe(0);
  expectClean(ctx);
});

test('v1.64 délai modifié : conséquences affichées, « Nouvelles dates seulement » par défaut, dates en cours inchangées', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, data());
  const avant1 = await due(page, 'd-1', 'acompte_paye'), avant2 = await due(page, 'd-2', 'acompte_paye');
  await goSettings(page);
  await page.locator('[data-delay-n="paiement"]').fill('5');
  await page.locator('[data-act="saveDelays"]').click();
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Paiement à vérifier : 10 jours → 5 jours');
  await expect(dlg).toContainText('Rappels avancés');
  await expect(dlg).toContainText('Salle d-1');
  await expect(dlg.locator('button.btn:not(.primary)')).toHaveText('Annuler');
  await expect(dlg.locator('button.primary')).toHaveText(['Nouvelles dates seulement', 'Aussi les dates en cours']);
  // Annuler : rien n'est enregistré
  await dlg.locator('button', { hasText: 'Annuler' }).click();
  expect(await delais(page)).toBeNull();
  await page.locator('[data-act="saveDelays"]').click();
  await page.locator('dialog.ask button', { hasText: 'Nouvelles dates seulement' }).click();
  await expect(page.locator('dialog.ask')).toHaveCount(0);
  const v = await delais(page);
  expect(v.paiement).toHaveLength(1);
  expect(v.paiement[0]).toMatchObject({ on: true, n: 5, from: iso(0) });
  expect(await due(page, 'd-1', 'acompte_paye'), 'date créée avant : inchangée').toBe(avant1);
  expect(await due(page, 'd-2', 'acompte_paye') < avant2, 'date créée aujourd’hui : nouveau délai').toBe(true);
  // la valeur affichée est celle des nouvelles dates, avec la mention du délai gardé par les dates plus anciennes
  await expect(page.locator('[data-delay-n="paiement"]')).toHaveValue('5');
  await expect(page.locator('#delays-panel')).toContainText('délai précédent gardé');
  expectClean(ctx);
});

test('v1.64 « Aussi les dates en cours » : rappels déplacés, rappels dus tout de suite signalés ; règle désactivée : plus de rappel', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, data());
  await goSettings(page);
  await page.locator('[data-delay-n="paiement"]').fill('1');
  await page.locator('[data-delay-on="boucle_accueil"]').uncheck();
  await page.locator('[data-act="saveDelays"]').click();
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('dû(s) aujourd’hui ou avant');
  await expect(dlg).toContainText('Rappels retirés (règle désactivée)');
  await dlg.locator('button', { hasText: 'Aussi les dates en cours' }).click();
  const v = await delais(page);
  expect(v.paiement[0]).toMatchObject({ n: 1, from: null });
  expect(v.boucle_accueil[0]).toMatchObject({ on: false, from: null });
  expect(await due(page, 'd-1', 'acompte_paye') <= iso(0)).toBe(true);
  expect((await rel(page, 'd-1')).some(x => x[0] === 'boucle_accueil')).toBe(false);
  expectClean(ctx);
});

test('v1.64 valeurs refusées hors bornes ; réglage abîmé : valeurs par défaut ; prospection et tâche Booking : prochaines tâches', async ({ page }) => {
  const ctx = await openApp(page);
  await goSettings(page);
  await page.locator('[data-delay-n="solde_envoi"]').fill('400');
  await page.locator('[data-act="saveDelays"]').click();
  await expect(page.locator('dialog.ask')).toHaveCount(0);
  await expect(page.locator('[data-delay-n="solde_envoi"]')).toHaveClass(/bad/);
  expect(await delais(page)).toBeNull();
  await page.locator('[data-delay-n="solde_envoi"]').fill('7');
  await page.locator('[data-task-delay="prospect_relance_days"]').fill('5');
  await page.locator('[data-task-delay="booking_task_days"]').fill('3');
  await page.locator('[data-act="saveDelays"]').click();
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('les tâches existantes gardent leur échéance');
  await dlg.locator('button', { hasText: 'Enregistrer' }).click();
  await expect(dlg).toHaveCount(0);
  const r = await page.evaluate(async () => { const m = await import('./js/reminders.js');
    return [m.taskDelay('prospect_relance_days'), m.taskDelay('booking_task_days'), m.taskDelay('prospect_relance_max')]; });
  expect(r).toEqual([5, 3, 3]);
  expect(await delais(page), 'aucune version de rappel créée').toBeNull();
  // réglage abîmé (écrit hors de l'application) : valeurs par défaut, rien ne casse
  const d = await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    S.db.settings.push({ key: 'delais', value: { paiement: 'x', solde_envoi: [{ n: -3 }, 7, { n: 9, from: 'demain' }] } }); touch('settings');
    return (await import('./js/reminders.js')).delaysOf({ created_at: new Date().toISOString() }); });
  expect([d.paiement, d.solde_envoi]).toEqual([{ on: true, n: 10 }, { on: true, n: 7 }]);
  expectClean(ctx);
});
