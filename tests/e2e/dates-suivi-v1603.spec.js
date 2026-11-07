// v1.60.3 (demandes d'Anthony du 07/11/2026) :
// - ligne « Boucle communication » dans Production › Suivi admin, juste au-dessus de « Boucle technique » (shows.boucle_com, même donnée
//   que l'onglet Communication) ; plus de champ de date déporté sous le bouton « Boucle communication » ;
// - une date de suivi déjà renseignée ne se modifie ni ne s'efface sans confirmation (ancienne et nouvelle valeur) ; « Annuler »
//   garde l'ancienne ; un champ vide se remplit sans question ; même règle depuis chaque écran ; un envoi réel n'en demande pas.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const AN = new Date().getFullYear();
const regler = (page, patch) => page.evaluate(async patch => { const { S, touch } = await import('./js/state.js');
  for (const db of [S.db, window.__DB]) Object.assign(db.shows.find(s => s.id === 'sh-1'), patch); touch('shows'); }, patch);
const ouvrir = (page, view) => page.evaluate(async view => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  app.go(view); if (view === 'production'){ S.openProd = new Set(['sh-1']); S.tab['prod:sh-1'] = 'suivi'; } app.render(); }, view);
const champ = (page, f, scope = 'main') => page.locator(`${scope} .dt:has(input.dt-val[data-id="sh-1"][data-f="${f}"]) input.dt-txt`);
const ecritures = (page, f) => page.evaluate(f => window.__calls.filter(c => c.table === 'shows' && c.op === 'update' && c.patch && f in c.patch).map(c => c.patch[f]), f);
const enBase = (page, f) => page.evaluate(f => window.__DB.shows.find(s => s.id === 'sh-1')[f] ?? null, f);
const saisir = async (loc, v) => { await loc.fill(v); await loc.press('Enter'); };
const fenetre = page => page.locator('dialog.ask');

test('v1.60.3 : Suivi admin — « Boucle communication » juste au-dessus de « Boucle technique », champ déporté retiré', async ({ page }) => {
  const ctx = await openApp(page);
  await regler(page, { boucle_com: '2026-10-20', date: AN + '-12-31' });
  await ouvrir(page, 'production');
  const libelles = await page.locator('.prod-tab .steps > label').allTextContents();
  const i = libelles.indexOf('Boucle communication');
  expect(i, 'ligne présente').toBeGreaterThan(-1);
  expect(libelles[i + 1]).toBe('Boucle technique');
  await expect(champ(page, 'boucle_com', '.prod-tab .steps')).toHaveValue('20/10/2026');
  // une seule case boucle_com dans la date (plus de doublon dans la barre d'actions), bouton toujours là
  await expect(page.locator('#prod-sh-1 input.dt-val[data-f="boucle_com"]')).toHaveCount(1);
  await expect(page.locator('.prod-actions input.dt-val')).toHaveCount(0);
  await expect(page.locator('.prod-actions [data-kind="boucle_com"]')).toBeVisible();
  // date en booking seul : pas de boucle (inchangé)
  await regler(page, { prod_mode: 'booking' });
  await ouvrir(page, 'production');
  await expect(page.locator('.prod-tab .steps > label', { hasText: 'Boucle communication' })).toHaveCount(0);
  expectClean(ctx);
});

test('v1.60.3 : champ vide → saisie sans confirmation ; modification → confirmation avec ancienne et nouvelle valeur ; Annuler garde la valeur', async ({ page }) => {
  const ctx = await openApp(page);
  await regler(page, { contract_sent: null, date: AN + '-12-31' });
  await ouvrir(page, 'production');
  const c = champ(page, 'contract_sent', '.prod-tab');
  await saisir(c, '02/11/2026');
  await expect.poll(() => ecritures(page, 'contract_sent')).toEqual(['2026-11-02']);
  await expect(fenetre(page)).toHaveCount(0);
  // modification : question avec l'ancienne et la nouvelle valeur ; Annuler → rien d'écrit, la case reprend l'ancienne valeur
  await saisir(c, '05/11/2026');
  await expect(fenetre(page)).toBeVisible();
  await expect(fenetre(page)).toContainText('Modifier la date « Contrat envoyé » ?');
  await expect(fenetre(page)).toContainText('Ancienne valeur : 02/11/2026');
  await expect(fenetre(page)).toContainText('Nouvelle valeur : 05/11/2026');
  await fenetre(page).locator('button', { hasText: 'Annuler' }).click();
  await expect(fenetre(page)).toHaveCount(0);
  await expect(c).toHaveValue('02/11/2026');
  expect(await ecritures(page, 'contract_sent')).toEqual(['2026-11-02']);
  expect(await enBase(page, 'contract_sent')).toBe('2026-11-02');
  // Échap : même effet qu'Annuler
  await saisir(c, '06/11/2026');
  await expect(fenetre(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fenetre(page)).toHaveCount(0);
  await expect(c).toHaveValue('02/11/2026');
  expect(await enBase(page, 'contract_sent')).toBe('2026-11-02');
  // confirmée : enregistrée
  await saisir(c, '05/11/2026');
  await fenetre(page).locator('button', { hasText: 'Modifier la date' }).click();
  await expect.poll(() => enBase(page, 'contract_sent')).toBe('2026-11-05');
  await expect(c).toHaveValue('05/11/2026');
  expectClean(ctx);
});

test('v1.60.3 : effacement d’une date renseignée → confirmation (Annuler garde, Effacer efface)', async ({ page }) => {
  const ctx = await openApp(page);
  await regler(page, { boucle_tech: '2026-09-01', date: AN + '-12-31' });
  await ouvrir(page, 'production');
  const c = champ(page, 'boucle_tech', '.prod-tab');
  await saisir(c, '');
  await expect(fenetre(page)).toContainText('Effacer la date « Boucle technique » ?');
  await expect(fenetre(page)).toContainText('Ancienne valeur : 01/09/2026');
  await expect(fenetre(page)).toContainText('Nouvelle valeur : aucune (date effacée)');
  await fenetre(page).locator('button', { hasText: 'Annuler' }).click();
  await expect(c).toHaveValue('01/09/2026');
  expect(await ecritures(page, 'boucle_tech')).toEqual([]);
  await saisir(c, '');
  await fenetre(page).locator('button.danger', { hasText: 'Effacer la date' }).click();
  await expect.poll(() => enBase(page, 'boucle_tech')).toBe(null);
  await expect(c).toHaveValue('');
  expectClean(ctx);
});

test('v1.60.3 : même règle depuis Communication (Conf + kit, boucle com, demande d’affiches) et depuis chaque ligne du Suivi admin', async ({ page }) => {
  const ctx = await openApp(page);
  const prod = ['conf_kit_sent', 'precontract_done', 'contract_sent', 'contract_signed', 'contract_cosigned_sent', 'boucle_com', 'boucle_tech'];
  const comm = ['conf_kit_sent', 'boucle_com', 'poster_request_date'];
  const plein = Object.fromEntries([...prod, ...comm].map(f => [f, '2026-10-01']));
  await regler(page, { ...plein, date: AN + '-12-31' });
  for (const [view, list, scope] of [['production', prod, '.prod-tab'], ['communication', comm, 'main table']]){
    await ouvrir(page, view);
    for (const f of list){
      const c = champ(page, f, scope);
      await saisir(c, '03/10/2026');
      await expect(fenetre(page), `${view} ${f} : confirmation`).toBeVisible();
      await expect(fenetre(page)).toContainText('Ancienne valeur : 01/10/2026');
      await fenetre(page).locator('button', { hasText: 'Annuler' }).click();
      await expect(c).toHaveValue('01/10/2026');
    }
  }
  const ecrits = await page.evaluate(() => window.__calls.filter(c => c.table === 'shows' && c.op === 'update').length);
  expect(ecrits, 'aucune écriture après Annuler').toBe(0);
  // champ vide dans Communication : rempli sans question
  await regler(page, { poster_request_date: null });
  await ouvrir(page, 'communication');
  await saisir(champ(page, 'poster_request_date', 'main table'), '04/10/2026');
  await expect.poll(() => enBase(page, 'poster_request_date')).toBe('2026-10-04');
  await expect(fenetre(page)).toHaveCount(0);
  expectClean(ctx);
});

test('v1.60.3 : un envoi réel (écriture par l’application, comme logMail) remplace la date sans demander de confirmation', async ({ page }) => {
  const ctx = await openApp(page);
  await regler(page, { conf_kit_sent: '2026-10-01', boucle_com: '2026-10-01' });
  await ouvrir(page, 'production');
  await page.evaluate(async () => { const { save } = await import('./js/data.js'); await save('shows', 'sh-1', { boucle_com: '2026-11-07', conf_kit_sent: '2026-11-07' }, { rerender: false }); });
  await expect(fenetre(page)).toHaveCount(0);
  expect(await enBase(page, 'boucle_com')).toBe('2026-11-07');
  expect(await enBase(page, 'conf_kit_sent')).toBe('2026-11-07');
  expectClean(ctx);
});

// --- Réponses d'Anthony du 07/11/2026 : dates de facture (envoyée, relancée, payée) et boucle com dans la progression ---
const ouvrirFactures = page => page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
  app.go('production'); S.openProd = new Set(['sh-1']); S.tab['prod:sh-1'] = 'factures'; app.render(); });
const reglerPay = (page, id, patch) => page.evaluate(async ([id, patch]) => { const { S, touch } = await import('./js/state.js');
  for (const db of [S.db, window.__DB]) Object.assign(db.show_payments.find(p => p.id === id), patch); touch('show_payments'); }, [id, patch]);
const casePay = (page, id, f) => page.locator(`.prod-tab .dt:has(input.dt-val[data-id="${id}"][data-f="${f}"]) input.dt-txt`);
const payEnBase = (page, id, f) => page.evaluate(([id, f]) => window.__DB.show_payments.find(p => p.id === id)[f] ?? null, [id, f]);
const ecritsPay = page => page.evaluate(() => window.__calls.filter(c => c.table === 'show_payments' && c.op === 'update').map(c => c.patch));

test('v1.60.3 : dates de facture — vide sans question ; envoyée / relancée / payée modifiées → confirmation, Annuler garde', async ({ page }) => {
  const ctx = await openApp(page);
  await regler(page, { date: AN + '-12-31' });
  await reglerPay(page, 'pa-1', { sent_at: null, reminded_at: null, paid_at: null, payee: 'compte', invoice_number: 'F-TEST-1' });
  await ouvrirFactures(page);
  // champ vide : enregistré sans question
  await saisir(casePay(page, 'pa-1', 'reminded_at'), '10/10/2026');
  await expect.poll(() => payEnBase(page, 'pa-1', 'reminded_at')).toBe('2026-10-10');
  await expect(fenetre(page)).toHaveCount(0);
  for (const [f, label] of [['sent_at', 'Envoyée'], ['paid_at', 'Payée']]){
    await saisir(casePay(page, 'pa-1', f), '01/10/2026');
    await expect.poll(() => payEnBase(page, 'pa-1', f)).toBe('2026-10-01');
    await expect(fenetre(page)).toHaveCount(0);
    await saisir(casePay(page, 'pa-1', f), '02/10/2026');
    await expect(fenetre(page)).toContainText(`Modifier la date « ${label} » ?`);
    await expect(fenetre(page)).toContainText('Festival Fictif (Bourg-Test) · Acompte');
    await expect(fenetre(page)).toContainText('Ancienne valeur : 01/10/2026');
    await expect(fenetre(page)).toContainText('Nouvelle valeur : 02/10/2026');
    await fenetre(page).locator('button', { hasText: 'Annuler' }).click();
    await expect(casePay(page, 'pa-1', f)).toHaveValue('01/10/2026');
    expect(await payEnBase(page, 'pa-1', f)).toBe('2026-10-01');
    await saisir(casePay(page, 'pa-1', f), '02/10/2026');
    await fenetre(page).locator('button', { hasText: 'Modifier la date' }).click();
    await expect.poll(() => payEnBase(page, 'pa-1', f)).toBe('2026-10-02');
  }
  // relance effacée : confirmation (Effacer)
  await saisir(casePay(page, 'pa-1', 'reminded_at'), '');
  await expect(fenetre(page)).toContainText('Effacer la date « Relancée » ?');
  await fenetre(page).locator('button.danger', { hasText: 'Effacer la date' }).click();
  await expect.poll(() => payEnBase(page, 'pa-1', 'reminded_at')).toBe(null);
  expectClean(ctx);
});

test('v1.60.3 : facture émise — effacer sa date d’envoi ou de paiement reste refusé avec le message clair, sans question inutile', async ({ page }) => {
  const ctx = await openApp(page);
  await regler(page, { date: AN + '-12-31' });
  await reglerPay(page, 'pa-1', { sent_at: '2026-10-01', paid_at: '2026-10-05', payee: 'compte', invoice_number: 'F-TEST-1', amount: 3000 });
  await ouvrirFactures(page);
  const avant = (await ecritsPay(page)).length;
  for (const f of ['sent_at', 'paid_at']){
    await saisir(casePay(page, 'pa-1', f), '');
    await expect(page.locator('.toast').last()).toContainText('Facture déjà émise');
    await expect(fenetre(page)).toHaveCount(0);
    expect(await payEnBase(page, 'pa-1', f)).not.toBe(null);
  }
  expect((await ecritsPay(page)).length, 'rien n’est écrit').toBe(avant);
  expectClean(ctx);
});

test('v1.60.3 : écriture d’un événement réel sur une facture (synchronisation, versement) sans question', async ({ page }) => {
  const ctx = await openApp(page);
  await reglerPay(page, 'pa-1', { sent_at: '2026-10-01', paid_at: null, payee: 'compte', invoice_number: 'F-TEST-1', amount: 3000 });
  await ouvrirFactures(page);
  await page.evaluate(async () => { const { save } = await import('./js/data.js'); await save('show_payments', 'pa-1', { paid_at: '2026-11-07', sent_at: '2026-10-02' }); });
  await expect(fenetre(page)).toHaveCount(0);
  expect(await payEnBase(page, 'pa-1', 'paid_at')).toBe('2026-11-07');
  expectClean(ctx);
});

test('v1.60.3 : boucle com dans la progression et l’alerte de retard (production seulement, règle existante)', async ({ page }) => {
  const ctx = await openApp(page);
  // date à venir, contrat co-signé renvoyé, boucle com pas envoyée : étape en retard (même règle que le rappel « Boucle communication à envoyer »)
  await regler(page, { date: AN + 1 + '-12-31', prod_mode: 'production', conf_kit_sent: '2026-09-01', precontract_done: '2026-09-02', contract_sent: '2026-09-03',
    contract_signed: '2026-09-04', contract_cosigned_sent: '2026-09-05', boucle_com: null, boucle_tech: null });
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.year = new Date().getFullYear() + 1; });
  await ouvrir(page, 'production');
  const point = page.locator('#prod-sh-1 .progress i').nth(5);   // ordre de PROD_STEPS : 6e étape = boucle com
  await expect(point).toHaveClass(/late/);
  await expect(page.locator('.prod-tab .steps > label', { hasText: 'Boucle communication' })).toHaveAttribute('style', /danger/);
  await saisir(champ(page, 'boucle_com', '.prod-tab'), '06/09/2026');
  await expect(point).toHaveClass(/ok/);
  await expect(page.locator('.prod-tab .steps > label', { hasText: 'Boucle communication' })).not.toHaveAttribute('style', /danger/);
  // booking seul : l'étape ne concerne pas la date (ni progression, ni retard)
  await regler(page, { prod_mode: 'booking', boucle_com: null });
  await ouvrir(page, 'production');
  await expect(page.locator('.prod-tab .steps > label', { hasText: 'Boucle communication' })).toHaveCount(0);
  expect(await page.evaluate(async () => { const { lateSteps } = await import('./js/reminders.js'); const { S } = await import('./js/state.js');
    return lateSteps(S.db.shows.find(s => s.id === 'sh-1')).has('boucle_com'); }), 'pas de retard de boucle com en booking').toBe(false);
  await expect(page.locator('#prod-sh-1 .progress i')).toHaveCount(2 + await page.evaluate(async () => { const { paymentsOf, tracked, acompteState } = await import('./js/calc.js');
    return paymentsOf('sh-1').filter(tracked).filter(p => p.kind !== 'cnm' && acompteState(p) !== 'caduc').length; }));   // 2 étapes de BOOKING_STEPS + factures suivies
  expectClean(ctx);
});
