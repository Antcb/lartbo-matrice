// V1-A lot A2 : encaissements et compte dédié.
// Règles : CONVENTIONS §6.6 (Q6, compte d'encaissement jamais supposé), §6.4 (facture émise), décisions d'Anthony du 24/10/2026
// (lignes booking jamais facturées masquées et hors totaux ; factures émises sur une date booking visibles et signalées ;
// « Non renseigné » hors solde des comptes mais compté dans la date et l'artiste). Constats d'audit A-03, A-05.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
const PROD = { id: 'e-1', project_id: 'art-a', venue: 'Salle Encaissement', date: `${Y}-11-05`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 10000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15 };
const ANNULEE = { id: 'e-2', project_id: 'art-a', venue: 'Salle Annulée', date: `${Y}-11-12`, status: 'Annulée',
  contract_type: 'Cession', fee_ht: 4000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15 };
const BOOKING = { id: 'e-3', project_id: 'art-b', venue: 'Salle Booking', date: `${Y}-11-20`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 8000, vat_rate: 5.5, prod_mode: 'booking', artbo_pct: 15 };

/** Ajoute des lignes à la fois dans la fausse base et dans l'état de l'application */
async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) {
      for (const r of rows) { window.__DB[table].push({ ...r }); S.db[table].push({ ...r }); }
      touch(table);
    }
  }, tables);
}
const dbPay = (page, id) => page.evaluate(i => ({ ...window.__DB.show_payments.find(p => p.id === i) }), id);
const account = page => page.evaluate(async () => {
  const b = await import('./js/budget.js');
  const a = b.accountOf('art-a');
  return { inDone: a.inDone, inTodo: a.inTodo, outDone: a.outDone, outTodo: a.outTodo, real: a.real, end: a.end,
    unDone: a.unassignedDone, unTodo: a.unassignedTodo, commission: a.byCat.Commission || 0,
    moves: b.accountMoves('art-a').map(m => m.label + ' ' + m.amount) };
});
const openFactures = (page, showId) => page.evaluate(async id => {
  const { S } = await import('./js/state.js'); S.year = new Date().getFullYear();
  S.openProd.add(id); S.tab['prod:' + id] = 'factures'; (await import('./js/app.js')).go('production');
}, showId);
const resteAEncaisser = async page => {
  const t = await page.locator('.stat', { hasText: 'Reste à encaisser' }).locator('b').textContent();
  return Number(t.replace(/[^\d,-]/g, '').replace(',', '.'));
};

test('A2-C : un encaissement sans compte reste « Non renseigné » : hors solde du compte, réintégré dès que le compte est choisi', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await account(page);
  await seed(page, { shows: [PROD], show_payments: [
    { id: 'c-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte', pct: 50, payee: 'compte', paid_at: `${Y}-10-01`, sort: 1 },
    { id: 'c-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 50, paid_at: `${Y}-10-15`, sort: 2 },            // payé, compte vide
    { id: 'c-o', show_id: 'e-1', kind: 'autre', label: 'Défraiement', amount: 300, sort: 3 },                            // à recevoir, compte vide
    { id: 'c-x', show_id: 'e-1', kind: 'autre', label: 'Reçu par L’ArtBo', amount: 200, payee: 'artbo', paid_at: `${Y}-10-15`, sort: 4 },
  ] });
  const a = await account(page);
  expect(a.inDone - avant.inDone, 'seul l’acompte arrivé sur le compte entre dans le compte').toBe(5000);
  expect(a.inTodo - avant.inTodo).toBe(0);
  expect(a.unDone - avant.unDone, 'solde payé sans compte : montré à part').toBe(5000);
  expect(a.unTodo - avant.unTodo, 'défraiement à recevoir sans compte : montré à part').toBe(300);
  expect(a.moves.some(m => m.startsWith('Solde')), 'pas de mouvement du compte pour un encaissement sans compte').toBe(false);
  expect(a.moves.some(m => m.startsWith('Acompte — Salle Encaissement'))).toBe(true);
  // le compte est choisi : le solde rejoint le compte et ses mouvements
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'c-s', { payee: 'compte' }));
  const b = await account(page);
  expect(b.inDone - avant.inDone).toBe(10000);
  expect(b.unDone - avant.unDone).toBe(0);
  expect(b.real - a.real, 'le solde réel du compte augmente du solde').toBe(5000);
  expect(b.moves.some(m => m.startsWith('Solde — Salle Encaissement'))).toBe(true);
  // aucune valeur supposée écrite en base pour les autres lignes
  expect((await dbPay(page, 'c-o')).payee ?? null).toBeNull();
  // tableau Factures : « Non renseigné » affiché, et signalé une fois payé
  await openFactures(page, 'e-1');
  await expect(page.locator('select[data-id="c-o"][data-f="payee"]')).toHaveValue('');
  await expect(page.locator('select[data-id="c-o"][data-f="payee"] option:checked')).toHaveText('Non renseigné');
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'c-o', { paid_at: `${new Date().getFullYear()}-10-20` }));
  await expect(page.locator('tr', { has: page.locator('select[data-id="c-o"]') }).locator('.warn-badge', { hasText: 'compte à choisir' })).toBeVisible();
  // budget de l'artiste : le montant non renseigné est montré à part
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); (S.openBudget ||= new Set()).add('art-a');
    document.body.insertAdjacentHTML('beforeend', '<div id="essai-budget">' + (await import('./js/views/budget.js')).projectBudgetHTML('art-a') + '</div>'); });
  await expect(page.locator('#essai-budget .stat', { hasText: 'Compte non renseigné' })).toBeVisible();
  expectClean(ctx);
});

test('A2-E (A-05) : une date annulée garde ses mouvements faits dans le compte, pas ses montants prévus', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await account(page);
  await seed(page, { shows: [ANNULEE], show_payments: [
    { id: 'x-a', show_id: 'e-2', kind: 'acompte', label: 'Acompte', amount: 2000, payee: 'compte', paid_at: `${Y}-09-01`, sort: 1 },
    { id: 'x-s', show_id: 'e-2', kind: 'solde', label: 'Solde', amount: 2000, payee: 'compte', sort: 2 },
  ], budget_lines: [
    { id: 'x-l1', project_id: 'art-a', show_id: 'e-2', category: 'Transport', label: 'Train déjà payé', amount: 500, payer: 'compte', paid_at: `${Y}-09-02` },
    { id: 'x-l2', project_id: 'art-a', show_id: 'e-2', category: 'Transport', label: 'Hôtel prévu', amount: 300, payer: 'compte' },
  ] });
  const a = await account(page);
  expect(a.inDone - avant.inDone, 'acompte reçu sur une date annulée : toujours dans le compte').toBe(2000);
  expect(a.inTodo - avant.inTodo, 'solde jamais reçu : plus attendu').toBe(0);
  expect(a.outDone - avant.outDone, 'dépense payée : toujours sortie du compte').toBe(500);
  expect(a.outTodo - avant.outTodo, 'dépense prévue : plus attendue').toBe(0);
  expect(a.commission - avant.commission, 'pas de commission sur une date annulée').toBe(0);
  expect(a.moves.some(m => m.startsWith('Acompte — Salle Annulée'))).toBe(true);
  expectClean(ctx);
});

test('A2-A/B : date booking : acomptes / soldes jamais facturés masqués et hors « Reste à encaisser » ; facture émise visible et signalée', async ({ page }) => {
  const ctx = await openApp(page);
  await openFactures(page, 'sh-1');
  const avant = await resteAEncaisser(page);
  await seed(page, { shows: [BOOKING], show_payments: [
    { id: 'b-a', show_id: 'e-3', kind: 'acompte', label: 'Acompte jamais facturé', pct: 50, sort: 1 },
    { id: 'b-s', show_id: 'e-3', kind: 'solde', label: 'Solde déjà facturé', pct: 50, invoice_number: 'F-77', sort: 2 },
    { id: 'b-c', show_id: 'e-3', kind: 'artbo', label: "Commission L'ArtBo", sort: 3 },
  ] });
  await openFactures(page, 'e-3');
  expect(await resteAEncaisser(page) - avant, 'seule la facture émise compte dans le reste à encaisser').toBe(4000);
  await expect(page.locator('[data-id="b-a"]')).toHaveCount(0);
  const ligne = page.locator('tr', { has: page.locator('[data-id="b-s"][data-f="label"]') });
  await expect(ligne.locator('.warn-badge', { hasText: 'facture émise sur une date booking' })).toBeVisible();
  await expect(page.locator('input[data-id="b-s"][data-f="amount"]'), 'facture émise : toujours verrouillée').toBeDisabled();
  // aucune donnée modifiée
  expect(await dbPay(page, 'b-a')).toMatchObject({ pct: 50 });
  expect((await dbPay(page, 'b-a')).paid_at ?? null).toBeNull();
  expectClean(ctx);
});

test('A2-D (A-03) : rattacher la pièce d’une facture émise ne la marque pas payée', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [PROD], show_payments: [
    { id: 'p-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 },
    { id: 'p-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 50, sort: 2 },
  ] });
  await page.evaluate(async () => (await import('./js/budget-actions.js')).applyPiece({
    doc: { type: 'facture_emise', numero: 'F-55', montant_ht: 5000, acompte_ou_solde: 'acompte', date: `${new Date().getFullYear()}-10-01` },
    path: 'essai/f-55.pdf', name: 'f-55.pdf', show_id: 'e-1', project_id: 'art-a', line: null }));
  const p = await dbPay(page, 'p-a');
  expect(p.invoice_number).toBe('F-55');
  expect(p.file_name).toBe('f-55.pdf');
  expect(p.paid_at ?? null, 'pas de date de paiement inventée').toBeNull();
  expect(p.amount ?? null, 'montant inchangé').toBeNull();
  expectClean(ctx);
});

test('A2-F : marquer payé un encaissement sans compte demande le compte ; « Annuler » le laisse « Non renseigné »', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [PROD, BOOKING], show_payments: [
    { id: 'f-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 },
    { id: 'f-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 50, sort: 2 },
    { id: 'f-c', show_id: 'e-1', kind: 'autre', label: 'Avec compte', amount: 100, payee: 'artiste', sort: 3 },
    { id: 'f-b', show_id: 'e-3', kind: 'solde', label: 'Solde booking', pct: 50, invoice_number: 'F-88', sort: 2 },
  ] });
  const jour = `${Y}-10-21`;
  // 1. choix du compte
  let fin = page.evaluate(async d => (await import('./js/actions.js')).ACTIONS['change:show_payments.paid_at']({ dataset: { id: 'f-a' } }, d), jour);
  await expect(page.locator('#modal h2')).toHaveText('Sur quel compte ce paiement est-il arrivé ?');
  await expect(page.locator('#modal select[name="payee"]'), 'aucun compte présélectionné').toHaveValue('');
  await page.locator('#modal select[name="payee"]').selectOption('compte');
  await page.locator('#modal button[type=submit]').click();
  await fin;
  expect(await dbPay(page, 'f-a')).toMatchObject({ paid_at: jour, payee: 'compte' });
  // 2. « Annuler » : payé, compte toujours vide
  fin = page.evaluate(async d => (await import('./js/actions.js')).ACTIONS['change:show_payments.paid_at']({ dataset: { id: 'f-s' } }, d), jour);
  await expect(page.locator('#modal h2')).toHaveText('Sur quel compte ce paiement est-il arrivé ?');
  await page.locator('#modal .modal-foot button', { hasText: 'Annuler' }).click();
  await fin;
  const s = await dbPay(page, 'f-s');
  expect(s.paid_at).toBe(jour);
  expect(s.payee ?? null).toBeNull();
  // 3. compte déjà renseigné, ou date en booking : aucune question
  await page.evaluate(async d => {
    const { ACTIONS } = await import('./js/actions.js');
    await ACTIONS['change:show_payments.paid_at']({ dataset: { id: 'f-c' } }, d);
    await ACTIONS['change:show_payments.paid_at']({ dataset: { id: 'f-b' } }, d);
  }, jour);
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await dbPay(page, 'f-c')).toMatchObject({ paid_at: jour, payee: 'artiste' });
  expect((await dbPay(page, 'f-b')).payee ?? null).toBeNull();
  expectClean(ctx);
});
