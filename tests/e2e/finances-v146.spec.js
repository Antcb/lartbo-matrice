// Lot V1.46a — Finances (décisions d'Anthony du 27/10/2026, état des lieux V1) :
//  - factures : date d'envoi saisie à la main ; « Facture à envoyer » 3 jours après la facture faite, jusqu'à la saisie de l'envoi ;
//  - impayés : rappel sans limite de 120 jours, pour toutes les factures suivies, suspension à la main, arrêt au paiement ;
//  - acompte par défaut : 0 % gardé (= sans acompte), 50 seulement si le réglage est vide ;
//  - commission par défaut : date > artiste > Réglages selon le mode de la date (plus de 0 ni de 15 en dur) ;
//  - un justificatif de dépense ne marque jamais la dépense payée.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const P = (id, extra = {}) => ({ id, project_id: 'art-a', venue: 'Salle ' + id, date: iso(40), status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 10000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15, ...extra });

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push({ ...r }); S.db[table].push({ ...r }); } touch(table); }
  }, tables);
}
const rel = (page, id) => page.evaluate(async i => (await import('./js/reminders.js')).remindersOf((await import('./js/selectors.js')).byId('shows', i))
  .map(x => [x.step, x.title, x.late]), id);
const save = (page, table, id, patch) => page.evaluate(async ([t, i, p]) => (await import('./js/data.js')).save(t, i, p, { rerender: false }), [table, id, patch]);

test('v1.46a factures : « Facture à envoyer » 3 jours après la facture faite, jusqu’à la date d’envoi ; puis paiement à vérifier', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('f-1')], show_payments: [
    { id: 'f1-a', show_id: 'f-1', kind: 'acompte', label: 'Acompte', pct: 30, invoice_number: 'F-AB-1', invoiced_on: iso(-4), sort: 1 },
    { id: 'f1-b', show_id: 'f-1', kind: 'acompte', label: 'Acompte 2', pct: 20, pennylane_id: '77', invoiced_on: iso(-1), sort: 2 },
    { id: 'f1-s', show_id: 'f-1', kind: 'solde', label: 'Solde', pct: 50, sort: 3 },
  ] });
  let r = await rel(page, 'f-1');
  // facture faite il y a 4 jours, pas envoyée : rappel en retard (3 jours, décalé au lundi s'il tombe le week-end)
  const a = r.find(x => x[1] === 'Facture à envoyer : Acompte (F-AB-1)');
  expect(a, 'facture faite, sans date d’envoi').toBeTruthy();
  // facture faite hier : rappel prévu, pas encore en retard
  expect(r.find(x => x[1] === 'Facture à envoyer : Acompte 2')?.[2]).toBe(false);
  // date d'envoi saisie : plus de « Facture à envoyer » ; « Paiement à vérifier » 10 jours après l'envoi
  await save(page, 'show_payments', 'f1-a', { sent_at: iso(-15) });
  r = await rel(page, 'f-1');
  expect(r.some(x => x[1].startsWith('Facture à envoyer : Acompte (F-AB-1)'))).toBe(false);
  expect(r.find(x => x[1] === 'Paiement à vérifier : Acompte (F-AB-1)')?.[2], 'envoyée il y a 15 jours, impayée').toBe(true);
  // relance notée : nouvelle échéance, libellé « toujours impayée »
  await save(page, 'show_payments', 'f1-a', { reminded_at: iso(-14) });
  expect((await rel(page, 'f-1')).find(x => x[1] === 'Paiement à vérifier : Acompte (F-AB-1) (toujours impayée après relance)')?.[2]).toBe(true);
  // relances suspendues à la main : plus de rappel, la facture reste impayée
  await save(page, 'show_payments', 'f1-a', { reminders_paused: true });
  expect((await rel(page, 'f-1')).some(x => x[1].startsWith('Paiement à vérifier : Acompte (F-AB-1)'))).toBe(false);
  await save(page, 'show_payments', 'f1-a', { reminders_paused: false });
  expect((await rel(page, 'f-1')).some(x => x[1].startsWith('Paiement à vérifier : Acompte (F-AB-1)'))).toBe(true);
  // payée : plus rien
  await save(page, 'show_payments', 'f1-a', { paid_at: iso(-1), payee: 'compte' });
  expect((await rel(page, 'f-1')).some(x => x[1].includes('F-AB-1'))).toBe(false);
  expectClean(ctx);
});

test('v1.46a impayés : sans limite de durée, toutes les factures suivies (2e acompte, autre ligne) ; booking : seulement la commission', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('f-2', { date: iso(-400) }), { ...P('f-3', { date: iso(-300) }), project_id: 'art-b', prod_mode: 'booking' }], show_payments: [
    { id: 'f2-a', show_id: 'f-2', kind: 'acompte', label: 'Acompte 1', pct: 30, invoice_number: 'F-10', sent_at: iso(-420), paid_at: iso(-410), payee: 'compte', sort: 1 },
    { id: 'f2-b', show_id: 'f-2', kind: 'acompte', label: 'Acompte 2', pct: 20, invoice_number: 'F-11', sent_at: iso(-405), sort: 2 },
    { id: 'f2-o', show_id: 'f-2', kind: 'autre', label: 'Frais techniques', amount: 300, invoice_number: 'F-12', sent_at: iso(-399), sort: 3 },
    { id: 'f3-s', show_id: 'f-3', kind: 'solde', label: 'Solde artiste', pct: 100, invoice_number: 'ART-1', sent_at: iso(-300), sort: 1 },
    { id: 'f3-c', show_id: 'f-3', kind: 'artbo', label: 'Commission', invoice_number: 'F-13', sent_at: iso(-290), sort: 2 },
  ] });
  const r2 = (await rel(page, 'f-2')).filter(x => x[2]).map(x => x[1]);
  expect(r2).toEqual(expect.arrayContaining(['Paiement à vérifier : Acompte 2 (F-11)', 'Paiement à vérifier : Frais techniques (F-12)']));
  expect(r2.some(x => x.includes('F-10')), 'acompte 1 payé').toBe(false);
  // booking : jamais l'acompte / le solde de l'artiste, toujours la commission de L'ArtBo, même 300 jours après
  expect((await rel(page, 'f-3')).map(x => x[1])).toEqual(['Paiement à vérifier : Commission (F-13)']);
  expectClean(ctx);
});

test('v1.46a onglet Factures : case « Relances suspendues » sur une facture envoyée impayée, enregistrée sur la ligne', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('f-4')], show_payments: [
    { id: 'f4-a', show_id: 'f-4', kind: 'acompte', label: 'Acompte', pct: 30, invoice_number: 'F-20', sent_at: iso(-20), sort: 1 },
    { id: 'f4-s', show_id: 'f-4', kind: 'solde', label: 'Solde', pct: 70, sort: 2 },
  ] });
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.openProd.add('f-4'); S.tab['prod:f-4'] = 'factures'; (await import('./js/app.js')).go('production'); });
  const box = page.locator('input[type=checkbox][data-id="f4-a"][data-f="reminders_paused"]');
  await expect(box).toBeVisible();
  await expect(page.locator('input[data-id="f4-s"][data-f="reminders_paused"]'), 'solde pas envoyé : pas de case').toHaveCount(0);
  await box.check();
  await expect.poll(() => page.evaluate(() => window.__DB.show_payments.find(p => p.id === 'f4-a').reminders_paused)).toBe(true);
  expectClean(ctx);
});

test('v1.46a acompte par défaut : 0 % gardé (date sans acompte), 50 seulement si le réglage est vide', async ({ page }) => {
  const ctx = await openApp(page);
  const def = v => page.evaluate(async x => {
    const { S, touch } = await import('./js/state.js');
    const s = S.db.settings.find(k => k.key === 'default_acompte_pct'); if (x === undefined) S.db.settings.splice(S.db.settings.indexOf(s), 1); else s.value = x;
    touch('settings');
    return (await import('./js/selectors.js')).defaultAcompte();
  }, v);
  expect(await def(0)).toBe(0);
  expect(await def('0')).toBe(0);
  expect(await def(30)).toBe(30);
  expect(await def('')).toBe(50);
  expect(await def(null)).toBe(50);
  expect(await def(undefined), 'réglage absent').toBe(50);
  expectClean(ctx);
});

test('v1.46a « Valider les conditions » : réglage à 0 % → aucun acompte proposé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('f-5', { status: 'Option Salle' })] });
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.settings.find(k => k.key === 'default_acompte_pct').value = 0; touch('settings');
    (await import('./js/confirm-flow.js')).validateTerms('f-5'); });
  await expect(page.locator('#modal #terms-n')).toHaveValue('0');
  await expect(page.locator('#modal [data-terms-ac]')).toHaveCount(0);
  await expect(page.locator('#modal #terms-solde')).toContainText('100 %');
  expectClean(ctx);
});

test('v1.46a commission par défaut : date > artiste > Réglages selon le mode de la date (plus de 0 ni de 15 en dur)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, {
    projects: [{ id: 'art-x', name: 'Artiste X', active: true, mode: 'production', default_artbo_pct: 12 }],
    shows: [P('c-1', { artbo_pct: null }), P('c-2', { artbo_pct: null, project_id: 'art-x' }), P('c-3', { artbo_pct: null, prod_mode: 'booking' }),
      P('c-4', { artbo_pct: 8, project_id: 'art-x' })],
    show_payments: ['c-1', 'c-2', 'c-3', 'c-4'].map(s => ({ id: s + '-c', show_id: s, kind: 'artbo', label: 'Commission', sort: 3 }))
      .concat([{ id: 'c-1-p', show_id: 'c-1', kind: 'partner', label: 'Partenaire', pct: 10, sort: 4 }]),
  });
  const r = await page.evaluate(async () => {
    const c = await import('./js/calc.js'), b = await import('./js/budget.js'), { byId } = await import('./js/selectors.js');
    const pay = id => c.payAmount(byId('show_payments', id));
    return { prodReglages: pay('c-1-c'), artiste: pay('c-2-c'), bookingReglages: pay('c-3-c'), date: pay('c-4-c'), partenaire: pay('c-1-p'),
      pct: c.payPct(byId('show_payments', 'c-2-c')), budget: b.commissionAmount(byId('shows', 'c-2')) };
  });
  // cachet 10 000 € : production 20 % (Réglages), artiste 12 %, booking 15 % (Réglages), date 8 % ; partenaire 10 % de la commission
  expect(r).toEqual({ prodReglages: 2000, artiste: 1200, bookingReglages: 1500, date: 800, partenaire: 200, pct: 12, budget: 1200 });
  expectClean(ctx);
});

test('v1.46a dépenses : un justificatif déposé ne marque jamais la dépense payée', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [P('d-1')], budget_lines: [
    { id: 'd1-l', project_id: 'art-a', show_id: 'd-1', category: 'Technique', label: 'Son', supplier: 'Sono Fictive', forecast: 500, sort: 1 },
  ] });
  await page.evaluate(async () => (await import('./js/budget-actions.js')).applyPiece({
    doc: { type: 'facture', numero: 'SF-1', date: '2026-01-15', montant_ht: 480, emetteur: 'Sono Fictive', categorie: 'Technique', libelle: 'Son' },
    path: 'pieces/sf-1.pdf', name: 'sf-1.pdf', show_id: 'd-1', project_id: 'art-a' }));
  const l = await page.evaluate(() => ({ ...window.__DB.budget_lines.find(x => x.id === 'd1-l') }));
  expect(l).toMatchObject({ doc_number: 'SF-1', amount: 480, file_path: 'pieces/sf-1.pdf' });
  expect(l.paid_at ?? null, 'pièce reçue ≠ dépense payée').toBeNull();
  // nouvelle ligne créée par une pièce : pas payée non plus
  await page.evaluate(async () => (await import('./js/budget-actions.js')).applyPiece({
    doc: { type: 'facture', numero: 'HT-9', date: '2026-01-16', montant_ht: 90, emetteur: 'Hôtel Témoin', categorie: 'VHR', libelle: 'Nuitée' },
    path: 'pieces/ht-9.pdf', name: 'ht-9.pdf', show_id: 'd-1', project_id: 'art-a' }));
  const n = await page.evaluate(() => ({ ...window.__DB.budget_lines.find(x => x.doc_number === 'HT-9') }));
  expect(n.amount).toBe(90);
  expect(n.paid_at ?? null).toBeNull();
  expectClean(ctx);
});
