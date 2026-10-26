// Calculs financiers et formats : comportement ACTUEL figé (caractérisation).
// Un lot qui change volontairement une règle (ex. B1 commission) met à jour le cas concerné, avec justification.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

// Jeu de données fictif injecté dans l'état de l'application
const FIXTURE = {
  shows: [
    { id: 'x-book', project_id: 'art-b', fee_ht: 6000, artbo_pct: 15, partner_pct: 5, prod_mode: 'booking', status: 'Confirmée Salle' },
    { id: 'x-prod', project_id: 'art-a', fee_ht: 6000, artbo_pct: 20, prod_mode: 'production', status: 'Confirmée Salle' },
    { id: 'x-sans', project_id: 'art-b', fee_ht: 1000, prod_mode: 'booking', status: 'Option Salle' },
    { id: 'x-arr', project_id: 'art-b', fee_ht: 1234.56, prod_mode: 'booking', status: 'Option Salle' },
  ],
  show_payments: [
    { id: 'p1', show_id: 'x-book', kind: 'acompte', pct: 30, sort: 1 },
    { id: 'p2', show_id: 'x-book', kind: 'solde', amount: 4200, sort: 2 },
    { id: 'p3', show_id: 'x-book', kind: 'artbo', sort: 3 },
    { id: 'p4', show_id: 'x-book', kind: 'partner', sort: 4 },
    { id: 'p5', show_id: 'x-prod', kind: 'artbo', sort: 1 },
    { id: 'p6', show_id: 'x-arr', kind: 'acompte', pct: 33, sort: 1 },
  ],
  budget_lines: [
    { id: 'b1', show_id: 'x-prod', project_id: 'art-a', category: 'Technique', amount: 500, sort: 1 },
    { id: 'b2', show_id: 'x-prod', project_id: 'art-a', category: 'Solde artiste', auto: 'solde_artiste', amount: 3000, sort: 2 },
  ],
};

test('calculs des factures, commissions et budget', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async F => {
    const { S, touch } = await import('./js/state.js');
    for (const [t, rows] of Object.entries(F)) { S.db[t] = rows.map(x => ({ ...x })); touch(t); }
    const c = await import('./js/calc.js'), b = await import('./js/budget.js');
    const pay = id => S.db.show_payments.find(p => p.id === id), show = id => S.db.shows.find(s => s.id === id);
    const bill = c.billingOf(show('x-book')), bud = b.showBudget(show('x-prod'));
    return {
      acompte: c.payAmount(pay('p1')), soldeSaisi: c.payAmount(pay('p2')), commission: c.payAmount(pay('p3')), partenaire: c.payAmount(pay('p4')),
      net: c.netArtbo(show('x-book')), arrondi: c.payAmount(pay('p6')), pctDeduit: c.billPct(pay('p2')),
      tvaAcompte: c.payVat(pay('p1')), tvaCommissionBooking: c.payVat(pay('p3')), tvaCommissionProduction: c.payVat(pay('p5')),
      ttc: c.ttc(1800, 5.5), billHt: bill.ht, billTtc: bill.ttc, billPct: bill.pct, billGap: bill.gap,
      comProd: b.commissionAmount(show('x-prod')), comSansLigne: b.commissionAmount(show('x-sans')),
      budget: { fee: bud.fee, com: bud.com, expenses: bud.expenses, available: bud.available, solde: bud.solde, result: bud.result },
      prodMode: [b.isProdShow(show('x-prod')), b.isProdShow(show('x-book'))],
    };
  }, FIXTURE);
  expect(r).toEqual({
    acompte: 1800, soldeSaisi: 4200, commission: 900, partenaire: 45, net: 855, arrondi: 407.4, pctDeduit: 70,
    tvaAcompte: 5.5, tvaCommissionBooking: 20, tvaCommissionProduction: 0,
    // lot C1 (26/10) : un acompte seulement prévu (non facturé) n'entre plus dans le total facturé (il ne réduit pas le solde)
    ttc: 1899, billHt: 4200, billTtc: 4431, billPct: 70, billGap: 1800,
    comProd: 1200,
    comSansLigne: 150,   // défaut de 15 % écrit en dur : sera corrigé par le lot B1 (Q1/Q2)
    budget: { fee: 6000, com: 1200, expenses: 500, available: 4300, solde: 3000, result: 1300 },
    prodMode: [true, false],
  });
  expectClean(ctx);
});

test('formats des montants et des dates', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async () => {
    const u = await import('./js/utils.js');
    const sp = s => s.replace(/[  ]/g, ' ');
    return { eurRond: sp(u.eur(1200)), eurCentimes: sp(u.eur(8967.5)), eur2: sp(u.eur2(1200)), vide: u.eur(null),
      date: u.fmtDate('2027-03-01'), samedi: u.workDay('2026-10-24'), dimanche: u.workDay('2026-10-25'), lundi: u.workDay('2026-10-26'),
      ecart: u.daysBetween('2027-02-27', '2027-03-01') };
  });
  expect(r).toEqual({ eurRond: '1 200 €', eurCentimes: '8 967,50 €', eur2: '1 200,00 €', vide: '—', date: '01/03/2027',
    samedi: '2026-10-26', dimanche: '2026-10-26', lundi: '2026-10-26', ecart: 2 });
  expectClean(ctx);
});
