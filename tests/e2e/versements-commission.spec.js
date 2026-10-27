// Lot D1 — commission de production = un TOTAL dû + l'historique de ses VERSEMENTS réels (option B, décision d'Anthony du 27/10/2026).
// Côté base : migration 2026-10-27_v1.43_versements_commission.sql (essais SQL de la répétition). Données FICTIVES, sauf le cas
// Carcassonne repris avec ses montants confirmés (cachet 12 306,15 ; commission 1 650 dont 1 500 retenus le 25/08/2026 ; Pyrprod 495).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
const DATE = { id: 'v-1', project_id: 'art-a', venue: 'Salle Versements', date: `${Y}-12-10`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 10000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15, partner_pct: 30 };
const CARCA = { id: 'v-c', project_id: 'art-a', venue: 'Féria de Carcassonne (essai)', date: `${Y}-12-20`, status: 'Confirmée Festival',
  contract_type: 'Cession', fee_ht: 12306.15, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15, partner_pct: 30 };
const COM = { id: 'c-1', show_id: 'v-1', kind: 'artbo', label: 'Commission L’ArtBo', sort: 30 };

async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) {
      for (const r of rows) { window.__DB[table].push({ ...r }); (S.db[table] ||= []).push({ ...r }); }
      touch(table);
    }
  }, tables);
}
const state = (page, id) => page.evaluate(async i => {
  const { commissionState } = await import('./js/calc.js'); const { byId } = await import('./js/selectors.js');
  const st = commissionState(byId('show_payments', i)); return { total: st.total, transferred: st.transferred, remaining: st.remaining, full: st.full, partial: st.partial, n: st.transfers.length };
}, id);
const account = page => page.evaluate(async () => {
  const b = await import('./js/budget.js'); const a = b.accountOf('art-a');
  return { outDone: a.outDone, outTodo: a.outTodo, real: a.real, commission: a.byCat.Commission || 0, moves: b.accountMoves('art-a').map(m => `${m.date} ${m.label} ${m.amount}`) };
});
const reminders = (page, showId) => page.evaluate(async i => {
  const { remindersOf } = await import('./js/reminders.js'); const { byId } = await import('./js/selectors.js');
  return remindersOf(byId('shows', i)).filter(r => r.step === 'artbo').map(r => r.title.replace(/[\u202f\u00a0]/g, ' '));
}, showId);
const save = (page, table, id, patch) => page.evaluate(async ([t, i, p]) => !!(await (await import('./js/data.js')).save(t, i, p)), [table, id, patch]);
const toasts = page => page.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(e => e.textContent).join(' ').replace(/[\u202f\u00a0]/g, ' '));
/** « Noter un versement » par la fenêtre de l'application (montant saisi, date du jour par défaut) */
async function noterVersement(page, id, montant) {
  const run = page.evaluate(async i => (await import('./js/actions.js')).ACTIONS.addTransfer({ dataset: { id: i } }), id);
  await expect(page.locator('#modal h2')).toHaveText('Noter un versement de commission');
  if (montant != null) await page.locator('#modal input[name="amount"]').fill(String(montant));
  await page.locator('#modal button[type=submit]').click();
  await run;
}

test('1. commission versée en une fois : total transféré, « versée », plus de rappel, compte débité du total', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await account(page);
  await seed(page, { shows: [DATE], show_payments: [COM, { id: 'a-1', show_id: 'v-1', kind: 'acompte', pct: 50, paid_at: `${Y}-10-01`, payee: 'compte', sort: 10 }] });
  expect(await reminders(page, 'v-1')).toEqual(['Commission L’ArtBo : 1 500,00 € à te verser']);
  await noterVersement(page, 'c-1');
  expect(await state(page, 'c-1')).toMatchObject({ total: 1500, transferred: 1500, remaining: 0, full: true, n: 1 });
  const p = await page.evaluate(() => window.__DB.show_payments.find(x => x.id === 'c-1'));
  expect([p.amount, !!p.paid_at], 'total figé et date de versement notée').toEqual([1500, true]);
  expect(await reminders(page, 'v-1')).toEqual([]);
  const a = await account(page);
  expect(a.outDone - avant.outDone).toBe(1500);
  expectClean(ctx);
});

test('2 + 5. Carcassonne (montants confirmés) : 1 650 dus, 1 500 retenus sur l’acompte le 25/08, 150 à transférer — jamais déduits avant leur transfert', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await account(page);
  await seed(page, { shows: [CARCA], show_payments: [
    { id: 'cc', show_id: 'v-c', kind: 'artbo', label: 'Commission L’ArtBo', amount: 1650, sort: 30 },
    { id: 'cp', show_id: 'v-c', kind: 'partner', label: 'Commission Pyrprod', amount: 495, paid_at: `${Y}-08-25`, invoice_number: '26_2941_08_LARTBO', sort: 40 },
    { id: 'ca', show_id: 'v-c', kind: 'acompte', amount: 6153.07, pct: 50, invoice_number: 'F-AB-ESSAI-89', sent_at: `${Y}-08-10`, paid_at: `${Y}-08-20`, payee: 'compte', sort: 10 } ],
    commission_transfers: [{ id: 't-cc', payment_id: 'cc', amount: 1500, transferred_at: `${Y}-08-25`, reference: 'VIR INT. TL CARCASSONNE ACOMPT',
      note: 'retenue sur l’acompte, sans virement distinct', created_at: `${Y}-08-25T10:00:00Z` }] });
  expect(await state(page, 'cc')).toMatchObject({ total: 1650, transferred: 1500, remaining: 150, full: false, partial: true });
  // compte de l'artiste : seuls les 1 500 transférés sont déduits ; 150 restent à venir ; Pyrprod (payée par L'ArtBo) jamais déduite ici
  const a = await account(page);
  expect([a.outDone - avant.outDone, a.outTodo - avant.outTodo]).toEqual([1500, 150]);
  expect(a.moves.filter(m => m.includes('Carcassonne') && m.includes('Commission'))).toEqual([`${Y}-08-25 Commission L'ArtBo — Féria de Carcassonne (essai) (20/12/${Y}) (versement) · VIR INT. TL CARCASSONNE ACOMPT -1500`]);
  // budget : commission totale comptée UNE fois (cachet − 1 650 − dépenses), 1 500 versés, 150 à verser
  const b = await page.evaluate(async () => { const { showBudget } = await import('./js/budget.js'); const { byId } = await import('./js/selectors.js'); const x = showBudget(byId('shows', 'v-c')); return { com: x.com, available: x.available }; });
  expect(b).toEqual({ com: 1650, available: 10656.15 });
  const html = await page.evaluate(async () => { const { showBudgetHTML } = await import('./js/views/budget.js'); const { byId } = await import('./js/selectors.js'); return showBudgetHTML(byId('shows', 'v-c')).replace(/[\u202f\u00a0]/g, ' '); });
  expect(html).toContain('versée en partie : 1 500,00 € transférés');
  expect(html).toContain('reste 150,00 € à transférer');
  expect(html).toContain('Noter un versement');
  // rappel : sur le reste seulement
  expect(await reminders(page, 'v-c')).toEqual(['Commission L’ArtBo : 150,00 € à te verser']);
  // part Pyrprod : 495 figés (montant réellement versé), jamais recalculés sur le cachet actuel (553,78)
  expect(await page.evaluate(async () => (await import('./js/calc.js')).payAmount(window.__DB.show_payments.find(x => x.id === 'cp')))).toBe(495);
  expectClean(ctx);
});

test('9. export artiste : commission totale, transfert réel et reste — les 150 € jamais présentés comme transférés', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [CARCA], show_payments: [{ id: 'cc', show_id: 'v-c', kind: 'artbo', label: 'Commission', amount: 1650, sort: 30 }],
    commission_transfers: [{ id: 't-cc', payment_id: 'cc', amount: 1500, transferred_at: `${Y}-08-25`, note: 'retenue sur l’acompte' }] });
  const html = await page.evaluate(async () => {
    let out = ''; const w = window.open; window.open = () => ({ document: { open() {}, write(h) { out += h; }, close() {} } });
    try { (await import('./js/artist-export.js')).exportArtistBudget('v-c'); } finally { window.open = w; }
    return out.replace(/[\u202f\u00a0]/g, ' ');
  });
  expect(html).toContain('− 1 650,00 €');
  expect(html).toContain('dont transféré le 25/08/' + Y);
  expect(html).toContain('reste à transférer (pas encore prélevé sur ton compte)');
  expect(html).not.toContain('(15 %)');   // 1 650 n'est pas 15 % du cachet actuel : pas de % trompeur
  expectClean(ctx);
});

test('3. commission versée en plusieurs fois : « versée » seulement au dernier versement', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DATE], show_payments: [COM] });
  await noterVersement(page, 'c-1', 1000);
  expect(await state(page, 'c-1')).toMatchObject({ total: 1500, transferred: 1000, remaining: 500, full: false });
  expect((await page.evaluate(() => window.__DB.show_payments.find(x => x.id === 'c-1'))).paid_at ?? null, 'pas encore versée').toBeNull();
  // une date de versement ne remplace pas le versement du reste
  expect(await save(page, 'show_payments', 'c-1', { paid_at: `${Y}-10-05` })).toBe(false);
  expect(await toasts(page)).toMatch(/note le versement du reste \(500,00 €\)/);
  // au-delà du reste : refusé dans la fenêtre
  const run = page.evaluate(async () => (await import('./js/actions.js')).ACTIONS.addTransfer({ dataset: { id: 'c-1' } }));
  await page.locator('#modal input[name="amount"]').fill('600');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal[open]')).toHaveCount(1);
  await page.locator('#modal input[name="amount"]').fill('500');
  await page.locator('#modal button[type=submit]').click();
  await run;
  expect(await state(page, 'c-1')).toMatchObject({ transferred: 1500, remaining: 0, full: true, n: 2 });
  expect(!!(await page.evaluate(() => window.__DB.show_payments.find(x => x.id === 'c-1'))).paid_at).toBe(true);
  expectClean(ctx);
});

test('4. commission pas encore versée : reste = total, calculé sur le cachet tant qu’aucun versement n’existe', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DATE], show_payments: [COM] });
  expect(await state(page, 'c-1')).toMatchObject({ total: 1500, transferred: 0, remaining: 1500, full: false, partial: false });
  expect(await save(page, 'shows', 'v-1', { fee_ht: 12000 })).toBe(true);
  expect(await state(page, 'c-1')).toMatchObject({ total: 1800, remaining: 1800 });
  expectClean(ctx);
});

test('6 + 7. après un versement : cachet ou % changés → avertissement ; total et versements inchangés', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DATE], show_payments: [{ ...COM, amount: 1500 }], commission_transfers: [{ id: 't-1', payment_id: 'c-1', amount: 1000, transferred_at: `${Y}-10-01` }] });
  for (const patch of [{ fee_ht: 20000 }, { artbo_pct: 20 }]) {
    const run = save(page, 'shows', 'v-1', patch);
    await expect(page.locator('#modal h2')).toHaveText('Factures déjà émises sur cette date');
    await page.locator('#modal button[type=submit]').click();
    expect(await run).toBe(true);
    expect(await state(page, 'c-1')).toMatchObject({ total: 1500, transferred: 1000, remaining: 500 });
  }
  // la commission versée en partie : son montant total et son % ne se modifient plus, elle ne se supprime pas
  expect(await save(page, 'show_payments', 'c-1', { amount: 1800 })).toBe(false);
  expect(await save(page, 'show_payments', 'c-1', { pct: 20 })).toBe(false);
  const del = await page.evaluate(async () => (await import('./js/calc.js')).changeBlocked('show_payments', 'c-1', null));
  expect(del).toMatch(/ne se supprime pas/);
  expectClean(ctx);
});

test('8 + 10. compte artiste, tableau Production et indicateurs : la commission comptée une seule fois', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [DATE], show_payments: [{ ...COM, amount: 1500 }], commission_transfers: [
    { id: 't-1', payment_id: 'c-1', amount: 1000, transferred_at: `${Y}-10-01` }, { id: 't-2', payment_id: 'c-1', amount: 300, transferred_at: `${Y}-10-15` }] });
  const a = await account(page);
  expect(a.moves.filter(m => m.includes('Salle Versements')).length, 'un mouvement par versement réel').toBe(2);
  const prod = await page.evaluate(async () => {
    const { financeOf, paymentsOf, payAmount } = await import('./js/calc.js'); const { byId } = await import('./js/selectors.js');
    return { artbo: paymentsOf('v-1').filter(p => p.kind === 'artbo').reduce((t, p) => t + payAmount(p), 0), f: financeOf([byId('shows', 'v-1')]) };
  });
  expect(prod.artbo, 'une seule ligne, comptée une fois').toBe(1500);
  expect([prod.f.commissionsBooking, prod.f.impayesProd], 'commission de production : hors indicateurs ②③').toEqual([0, 0]);
  expectClean(ctx);
});

test('13. booking et coproduction : pas de versement sur une commission booking (facture) ; coproduction hors compte artiste', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [{ ...DATE, id: 'v-b', prod_mode: 'booking' }, { ...DATE, id: 'v-p', contract_type: 'Co-Production', venue: 'Salle Coprod' }],
    show_payments: [{ ...COM, id: 'cb', show_id: 'v-b' }, { ...COM, id: 'cpp', show_id: 'v-p', amount: 1500 }],
    commission_transfers: [{ id: 't-p', payment_id: 'cpp', amount: 500, transferred_at: `${Y}-10-01` }] });
  await page.evaluate(async () => (await import('./js/actions.js')).ACTIONS.addTransfer({ dataset: { id: 'cb' } }));
  await expect(page.locator('#modal[open]')).toHaveCount(0);
  expect(await toasts(page)).toMatch(/Rien à transférer/);
  const a = await account(page);
  expect(a.moves.some(m => m.includes('Salle Coprod')), 'date en coproduction : budget propre, hors compte artiste').toBe(false);
  expectClean(ctx);
});

test('compatibilité : commission marquée versée avant ce lot, sans versement détaillé = versée en totalité à sa date', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await account(page);
  await seed(page, { shows: [DATE], show_payments: [{ ...COM, paid_at: `${Y}-09-01` }] });
  expect(await state(page, 'c-1')).toMatchObject({ total: 1500, transferred: 1500, remaining: 0, n: 0 });
  expect((await account(page)).outDone - avant.outDone).toBe(1500);
  expect(await reminders(page, 'v-1')).toEqual([]);
  expectClean(ctx);
});
