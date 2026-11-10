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
  expect(avant1).toBe(avant2);
  await goSettings(page);
  await page.locator('[data-delay-n="paiement"]').fill('5');
  await page.locator('[data-act="saveDelays"]').click();
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Paiement à vérifier : 10 jours → 5 jours');
  await expect(dlg).toContainText('Rappels avancés');
  await expect(dlg).toContainText('Salle d-1');
  // choix conseillé en bouton principal ; « Aussi les dates en cours » en bouton neutre (relecture de 86d397e)
  await expect(dlg.locator('button.btn:not(.primary)')).toHaveText(['Annuler', 'Aussi les dates en cours']);
  await expect(dlg.locator('button.primary')).toHaveText('Nouvelles dates seulement');
  // Annuler : rien n'est enregistré
  await dlg.locator('button', { hasText: 'Annuler' }).click();
  expect(await delais(page)).toBeNull();
  await page.locator('[data-act="saveDelays"]').click();
  // instant d'enregistrement posé par le serveur (déclencheur settings_delais_instant, imité par la fausse base) — pas l'horloge du navigateur
  const serveur = new Date(Date.now() + 120000).toISOString();
  await page.evaluate(t => { window.__SERVER_NOW = t; }, serveur);
  await page.locator('dialog.ask button', { hasText: 'Nouvelles dates seulement' }).click();
  await expect(page.locator('dialog.ask')).toHaveCount(0);
  const v = await delais(page);
  expect(v.paiement).toHaveLength(1);
  expect(v.paiement[0]).toMatchObject({ on: true, n: 5 });
  // « existante » = créée avant l'INSTANT d'enregistrement (décision du 09/11), pas avant le jour
  expect(v.paiement[0].from, 'instant du serveur, relu après l’écriture').toBe(serveur);
  expect(v.paiement[0].at).toBe(serveur);
  expect(await page.evaluate(() => window.__DB.settings.find(x => x.key === 'delais').value.paiement[0].from), 'appli = serveur').toBe(serveur);
  expect(await due(page, 'd-1', 'acompte_paye'), 'date créée il y a 30 jours : inchangée').toBe(avant1);
  expect(await due(page, 'd-2', 'acompte_paye'), 'date créée aujourd’hui AVANT l’enregistrement : inchangée').toBe(avant2);
  await seed(page, { shows: [P('d-3', { created_at: new Date(Date.parse(serveur) + 1).toISOString() })], show_payments: [
    { id: 'd3-a', show_id: 'd-3', kind: 'acompte', label: 'Acompte', pct: 30, invoice_number: 'F-3', sent_at: iso(-3), sort: 1 }] });
  expect(await due(page, 'd-3', 'acompte_paye') < avant2, 'date créée après l’enregistrement : nouveau délai').toBe(true);
  // la valeur affichée est celle des nouvelles dates, avec la mention de la règle gardée par les dates plus anciennes
  await expect(page.locator('[data-delay-n="paiement"]')).toHaveValue('5');
  await expect(page.locator('#delays-panel')).toContainText('règle précédente gardée');
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
  await expect(dlg).toContainText('Dus aujourd’hui ou avant : ils partiraient au prochain passage du matin');
  await expect(dlg).toContainText('Dossiers concernés : 2');
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
  // champ fautif visible : style existant des champs de tableau en erreur (td input.invalid, bordure --danger)
  const champ = page.locator('[data-delay-n="solde_envoi"]');
  await expect(champ).toHaveClass(/invalid/);
  const [bord, danger] = await champ.evaluate(el => [getComputedStyle(el).borderTopColor,
    (d => { d.style.color = 'var(--danger)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })(document.createElement('span'))]);
  expect(bord).toBe(danger);
  expect(await delais(page)).toBeNull();
  await page.locator('[data-delay-n="solde_envoi"]').fill('7');
  await page.locator('[data-task-delay="prospect_relance_days"]').fill('5');
  await page.locator('[data-task-delay="booking_task_days"]').fill('3');
  await page.locator('[data-task-delay="prospect_relance_on"]').uncheck();
  await page.locator('[data-task-delay="pennylane_payment_days"]').fill('30');
  await page.locator('[data-act="saveDelays"]').click();
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('les tâches existantes gardent leur échéance');
  await expect(dlg).toContainText('Tâches de relance de prospection : activées → désactivées');
  await expect(dlg).toContainText('14 j → 30 j (nouveaux documents seulement ; documents déjà créés inchangés)');
  await dlg.locator('button', { hasText: 'Enregistrer' }).click();
  await expect(dlg).toHaveCount(0);
  const r = await page.evaluate(async () => { const m = await import('./js/reminders.js');
    return [m.taskDelay('prospect_relance_days'), m.taskDelay('booking_task_days'), m.taskDelay('prospect_relance_max'), m.taskDelay('prospect_relance_on'), m.taskDelay('pennylane_payment_days'), m.taskDelay('pennylane_quote_days')]; });
  expect(r).toEqual([5, 3, 3, false, 30, 30]);
  expect(await delais(page), 'aucune version de rappel créée').toBeNull();
  // réglage abîmé (écrit hors de l'application) : valeurs par défaut, rien ne casse
  const d = await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    S.db.settings.push({ key: 'delais', value: { paiement: 'x', solde_envoi: [{ n: -3 }, 7, { n: 9, from: 'demain' }] } }); touch('settings');
    return (await import('./js/reminders.js')).delaysOf({ created_at: new Date().toISOString() }); });
  expect([d.paiement, d.solde_envoi]).toEqual([{ on: true, n: 10 }, { on: true, n: 7 }]);
  // relecture de 86d397e (B1) : jour impossible ignoré (même règle que delais_jour en SQL), délai 5.0 = 5 (comme delais_n)
  const e = await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'), m = await import('./js/reminders.js');
    const set = v => { S.db.settings.find(x => x.key === 'delais').value = v; touch('settings'); return m.delaysOf({ created_at: '2026-03-15T10:00:00Z' }); };
    const out = [set({ paiement: [{ on: true, n: 4, from: null }, { on: false, n: 2, from: '2026-02-30T10:00:00Z' }] }).paiement,
            set({ paiement: [{ on: true, n: 4, from: null }, { on: false, n: 2, from: '9999-99-99T00:00:00Z' }] }).paiement,
            set({ paiement: [{ on: true, n: 4, from: null }, { on: false, n: 2, from: '0000-01-01T00:00:00Z' }] }).paiement,
            set({ paiement: [{ on: true, n: 4, from: null }, { on: false, n: 2, from: '2026-02-01' }] }).paiement,
            set(JSON.parse('{"paiement": [{"on": true, "n": 5.0, "from": null}]}')).paiement,
            set({ paiement: [{ on: true, n: 5.5, from: null }] }).paiement,
            set({ paiement: [{ on: true, n: 6, from: '2026-02-28T10:00:00.000Z' }] }).paiement,
            set({ paiement: [{ on: true, n: 4, from: null }, { on: true, n: 'x' }] }).paiement];
    return {out, anomalies: m.delaysAnomalies().map(a => a.text)}; });
  expect(e.out).toEqual([{ on: true, n: 4 }, { on: true, n: 4 }, { on: true, n: 4 }, { on: true, n: 4 }, { on: true, n: 5 }, { on: true, n: 10 }, { on: true, n: 6 }, { on: true, n: 4 }]);
  // anomalie signalée avec la valeur RÉELLEMENT appliquée (version précédente lisible, pas « défaut »)
  expect(e.anomalies).toEqual(['Paiement à vérifier : 1 version illisible ignorée ; valeur appliquée aux nouvelles dates : 4 j (dernière version lisible).']);
  await goSettings(page);
  await expect(page.locator('#delays-panel .warn-txt')).toContainText('1 version illisible ignorée');
  expectClean(ctx);
});

test('v1.64 week-ends : délai de 0 jour → lundi (politique réglable) ; anciens éléments à traiter visibles, sans notification', async ({ page }) => {
  const ctx = await openApp(page);
  let sam = -30; while (new Date(iso(sam) + 'T12:00:00').getDay() !== 6) sam--;
  await seed(page, { shows: [P('w-1', { date: iso(40), contract_sent: iso(sam) }), P('o-1', { date: iso(-200), contract_sent: iso(-260) }), P('o-2', { date: iso(-40) })],
    show_payments: [
      { id: 'w1-a', show_id: 'w-1', kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 },
      { id: 'o1-a', show_id: 'o-1', kind: 'acompte', label: 'Acompte', pct: 100, sort: 1 },
      { id: 'o2-s', show_id: 'o-2', kind: 'solde', label: 'Solde', pct: 100, sort: 1 }] });
  expect(await due(page, 'w-1', 'facture_acompte'), 'contrat envoyé un samedi : rappel le lundi').toBe(iso(sam + 2));
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    S.db.settings.push({ key: 'delais', value: { weekend_apres: [{ on: false, n: 0, from: null }] } }); touch('settings'); });
  expect(await due(page, 'w-1', 'facture_acompte'), 'politique désactivée : samedi').toBe(iso(sam));
  // anciens éléments : obligation ouverte, plus de notification (serveur : 120 j ; 30 j pour le solde), visibles dans Production
  const st = await page.evaluate(async () => { const m = await import('./js/reminders.js'), b = (await import('./js/selectors.js')).byId;
    return [m.staleOf(b('shows', 'o-1')).map(r => [r.key, r.staleWhy]), m.staleOf(b('shows', 'o-2')).map(r => [r.key, r.staleWhy]), m.staleOf(b('shows', 'w-1')).length]; });
  expect(st).toEqual([[['facture_acompte', 'concert passé depuis plus de 120 jours']], [['solde_envoi', 'concert passé depuis plus de 30 jours']], 0]);
  await page.evaluate(async () => (await import('./js/app.js')).go('production'));
  const box = page.locator('#stale-items');
  await expect(box).toContainText(/Anciens éléments à traiter \(\d+\)/);   // jeu d'essai commun : d'autres dates passées peuvent y figurer
  await expect(box).toContainText('Salle o-1');
  await expect(box).toContainText('Salle o-2');
  await expect(box).not.toContainText('Salle w-1');
  await expect(box).toContainText('Facture d’acompte à faire (contrat envoyé)');
  await expect(box).toContainText('Facture de solde à faire');
  await expect(box).toContainText('plus de 120 jours');
  expectClean(ctx);
});

test('v1.64 écriture concurrente : réglage modifié ailleurs depuis l’affichage → rien n’est écrit, affichage mis à jour', async ({ page }) => {
  const ctx = await openApp(page);
  await goSettings(page);
  await page.locator('[data-delay-n="paiement"]').fill('5');
  // un autre poste enregistre entre-temps (fausse base seulement)
  const autre = { precontrat: [{ on: true, n: 12, from: null, at: '2026-11-09T10:00:00.000Z', by: 'autre' }] };
  await page.evaluate(v => { window.__DB.settings.push({ key: 'delais', value: v }); }, autre);
  await page.locator('[data-act="saveDelays"]').click();
  await expect(page.locator('dialog.ask')).toHaveCount(0);
  await expect(page.locator('.toast').last()).toContainText('modifiés entre-temps');
  expect(await page.evaluate(() => window.__DB.settings.find(x => x.key === 'delais').value), 'valeur du serveur intacte').toEqual(autre);
  expect(await delais(page), 'affichage = serveur').toEqual(autre);
  await expect(page.locator('[data-delay-n="precontrat"]')).toHaveValue('12');
  expectClean(ctx);
});
