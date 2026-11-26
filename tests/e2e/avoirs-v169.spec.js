// v1.69 — L1 du point 02 « Annulations de dates et avoirs » (décisions d'Anthony du 26/11/2026, D7) : avoirs Pennylane importés et
// affichés sous la facture d'origine. Un avoir n'est JAMAIS un encaissement ni un remboursement : il réduit seulement le reste dû.
// Trois cas, données FICTIVES (reproductions de la forme des cas réels, sans aucune donnée réelle) :
//  1. facture soldée par un avoir total, sans encaissement (forme du cas Produc'son) : avoir visible, aucun encaissement créé,
//     hors des impayés et des relances de paiement ;
//  2. avoir créé par erreur sur un acompte déjà encaissé (forme du cas Champs des Notes) : avoir visible, le paiement d'octobre
//     conservé, un seul encaissement ;
//  3. avoir partiel : seul le montant couvert est déduit du reste dû ; un paiement déjà noté est conservé ; aucun paiement fictif.
// Plus : avoir « À rattacher » listé en tête de Production, jamais compté.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear() + 1;
const iso = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function preparer(page, {shows, payments, avoirs}){
  await page.evaluate(async ([shows, payments, avoirs, Y]) => {
    const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
    for (const db of [S.db, window.__DB]){
      db.shows.push(...structuredClone(shows)); db.show_payments.push(...structuredClone(payments));
      db.pennylane_avoirs = [...(db.pennylane_avoirs || []), ...structuredClone(avoirs)];
    }
    for (const t of ['shows', 'show_payments', 'pennylane_avoirs']) touch(t);
    S.year = Y; app.go('production'); S.openProd = new Set(shows.map(s => s.id)); shows.forEach(s => { S.tab['prod:' + s.id] = 'factures'; }); app.render();
  }, [shows, payments, avoirs, Y]);
}
const show = (id, venue, extra = {}) => ({ id, project_id: 'art-a', venue, city: 'Ville fictive', date: `${Y}-03-1${id.slice(-1)}`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 3500, prod_mode: 'production', ...extra });
const etat = (page, ids) => page.evaluate(async ids => {
  const calc = await import('./js/calc.js'); const rem = await import('./js/reminders.js'); const { S } = await import('./js/state.js');
  const shows = S.db.shows.filter(s => ids.includes(s.id));
  return { fin: calc.financeOf(shows), relances: shows.flatMap(s => rem.remindersOf(s).map(r => r.title)),
    paid: Object.fromEntries(S.db.show_payments.filter(p => ids.includes(p.show_id)).map(p => [p.id, p.paid_at ?? null])),
    lignes: S.db.show_payments.filter(p => ids.includes(p.show_id)).length };
}, ids);
const ecrituresFactures = page => page.evaluate(() => window.__calls.filter(c => ['show_payments', 'pennylane_avoirs', 'commission_transfers'].includes(c.table) && c.op !== 'select').length);

test('v1.69 cas 1 — facture soldée par un avoir total, sans encaissement : avoir visible, aucun encaissement, hors impayés et relances de paiement', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('av-d1', 'Salle Avoir Total')],
    payments: [{ id: 'av-p1', show_id: 'av-d1', kind: 'acompte', label: 'Acompte', pct: 25, amount: 900, sort: 1, invoice_number: 'F-FICT-58', pennylane_id: 'pl-fict-58', sent_at: iso(-40), invoiced_on: iso(-41) }],
    avoirs: [{ id: 'a-1', pennylane_id: 'pl-fict-115', invoice_number: 'AV-FICT-115', invoice_date: iso(-3), amount_ht: 900, credited_pennylane_id: 'pl-fict-58', etat: 'rattache', payment_id: 'av-p1', show_id: 'av-d1', url: 'https://app.pennylane.com/fictif-115' }],
  });
  const avant = await etat(page, ['av-d1']);
  // l'avoir est visible sous la facture d'origine, la facture est « soldée par avoir »
  const bloc = page.locator('tr.avoir-row');
  await expect(bloc.first()).toContainText('AV-FICT-115');
  await expect(bloc.first()).toContainText('900,00');
  await expect(page.locator('tr.avoir-row', { hasText: 'Facture soldée par l’avoir' })).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'soldée par avoir' })).toBeVisible();
  // aucun encaissement : la date de paiement reste vide
  expect(avant.paid['av-p1']).toBeNull();
  // hors des impayés et des relances de paiement
  expect(avant.fin.impayesProd).toBe(0);
  expect(avant.fin.factures).toBe(0);
  expect(avant.relances.filter(t => /Paiement à vérifier|Facture à envoyer/.test(t))).toEqual([]);
  // sans l'avoir, la même facture serait impayée et relancée (le test protège bien la règle)
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.pennylane_avoirs = []; touch('pennylane_avoirs'); });
  const sans = await etat(page, ['av-d1']);
  expect(sans.fin.impayesProd).toBe(900);
  expect(sans.relances.some(t => /Paiement à vérifier : Acompte \(F-FICT-58\)/.test(t))).toBe(true);
  expect(await ecrituresFactures(page)).toBe(0);
  expectClean(ctx);
});

test('v1.69 cas 2 — avoir créé par erreur sur un acompte encaissé : avoir visible, paiement d’octobre conservé, un seul encaissement', async ({ page }) => {
  const ctx = await openApp(page);
  const oct = `${Y - 1}-10-30`;
  await preparer(page, {
    shows: [show('av-d2', 'Salle Avoir Erreur', { contract_type: 'Co-Réalisation' })],
    payments: [{ id: 'av-p2', show_id: 'av-d2', kind: 'acompte', label: 'Acompte', pct: 50, amount: 1750, sort: 1, invoice_number: 'F-FICT-77', pennylane_id: 'pl-fict-77', sent_at: `${Y - 1}-06-10`, paid_at: oct, payee: 'compte' },
      { id: 'av-p2s', show_id: 'av-d2', kind: 'solde', label: 'Solde', pct: 50, sort: 2 }],
    avoirs: [{ id: 'a-2', pennylane_id: 'pl-fict-117', invoice_number: 'AV-FICT-117', invoice_date: `${Y - 1}-11-23`, amount_ht: 1750, credited_pennylane_id: 'pl-fict-77', etat: 'rattache', payment_id: 'av-p2', show_id: 'av-d2' }],
  });
  const e = await etat(page, ['av-d2']);
  await expect(page.locator('tr.avoir-row').first()).toContainText('AV-FICT-117');
  await expect(page.locator('tr.avoir-row', { hasText: 'conservé tel quel' })).toContainText('Paiement noté le');
  // (v1.70) paiement historique lu tel quel sous la facture (E1)
  await expect(page.locator('tr.reglement-row', { hasText: 'conservé tel quel' })).toContainText('avant les encaissements détaillés');
  // un seul encaissement : celui d'octobre, inchangé ; aucun remboursement, aucune nouvelle ligne (la réémission n'est pas importée en L1)
  expect(e.paid).toEqual({ 'av-p2': oct, 'av-p2s': null });
  expect(e.lignes).toBe(2);
  expect(e.fin.impayesProd).toBe(0);
  // reste à encaisser du contrat inchangé par l'avoir : cession − encaissé (3 500 − 1 750)
  expect(e.fin.resteProd).toBe(1750);
  expect(await ecrituresFactures(page)).toBe(0);
  expectClean(ctx);
});

test('v1.69 cas 3 — avoir partiel : seul le montant couvert est déduit du reste dû ; paiement déjà noté conservé ; aucun paiement fictif', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('av-d3', 'Salle Avoir Partiel', { fee_ht: 6000 }), show('av-d4', 'Salle Partiel Payée', { fee_ht: 6000 })],
    payments: [
      { id: 'av-p3', show_id: 'av-d3', kind: 'solde', label: 'Solde', amount: 4200, sort: 2, invoice_number: 'F-FICT-300', pennylane_id: 'pl-fict-300', sent_at: iso(-30) },
      { id: 'av-p4', show_id: 'av-d4', kind: 'solde', label: 'Solde', amount: 4200, sort: 2, invoice_number: 'F-FICT-400', pennylane_id: 'pl-fict-400', sent_at: iso(-30), paid_at: iso(-5), payee: 'compte' }],
    avoirs: [
      { id: 'a-3', pennylane_id: 'pl-fict-301', invoice_number: 'AV-FICT-301', amount_ht: 1500, credited_pennylane_id: 'pl-fict-300', etat: 'rattache', payment_id: 'av-p3', show_id: 'av-d3' },
      { id: 'a-4', pennylane_id: 'pl-fict-401', invoice_number: 'AV-FICT-401', amount_ht: 1500, credited_pennylane_id: 'pl-fict-400', etat: 'rattache', payment_id: 'av-p4', show_id: 'av-d4' }],
  });
  const partiel = await etat(page, ['av-d3']), payee = await etat(page, ['av-d4']);
  // facture partiellement couverte, pas payée : reste dû = 4 200 − 1 500 = 2 700, toujours impayée et relancée
  await expect(page.locator('tr.avoir-row', { hasText: 'Reste dû sur cette facture après avoir' })).toContainText('2 700,00');
  // deux restes distincts (décision du 26/11/2026, point 2) : contrat inchangé par l'avoir, factures après avoir
  const pied = page.locator('.prod-bill', { hasText: 'AV-FICT-301' }).locator('tfoot');
  // (v1.70, E3) cinq montants distincts, en TTC (5,5 %) : contrat inchangé par l'avoir (6 330 TTC = 6 000 HT), facturé net après avoir
  // et reste dû 2 848,50 TTC (= 2 700 HT)
  await expect(pied).toContainText('Reste contractuel : 6 330,00');
  await expect(pied).toContainText('(6 000,00 € HT)');
  await expect(pied).toContainText('Facturé net après avoirs : 2 848,50');
  await expect(pied).toContainText('Reste dû : 2 848,50');
  expect(partiel.fin.impayesProd).toBe(2700);
  expect(partiel.fin.factures).toBe(1);
  expect(partiel.relances.some(t => /Paiement à vérifier : Solde \(F-FICT-300\)/.test(t))).toBe(true);
  expect(partiel.paid['av-p3']).toBeNull();   // aucun paiement fictif
  // facture déjà payée puis avoir partiel : paiement conservé tel quel, plus rien d'impayé, aucun remboursement créé
  expect(payee.paid['av-p4']).toBe(iso(-5));
  expect(payee.fin.impayesProd).toBe(0);
  await expect(page.locator('tr.avoir-row', { hasText: 'AV-FICT-401' })).toBeVisible();
  expect(await page.evaluate(() => window.__DB.show_payments.filter(p => /^av-d[34]$/.test(p.show_id)).length)).toBe(2);
  expect(await ecrituresFactures(page)).toBe(0);
  expectClean(ctx);
});

test('v1.69 avoir « À rattacher » et avoir disparu de Pennylane : listé / affiché à part, jamais compté', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('av-d5', 'Salle Ambiguë')],
    payments: [{ id: 'av-p5', show_id: 'av-d5', kind: 'acompte', label: 'Acompte', amount: 1000, sort: 1, invoice_number: 'F-FICT-500', pennylane_id: 'pl-fict-500', sent_at: iso(-30) }],
    avoirs: [
      { id: 'a-5', pennylane_id: 'pl-fict-999', invoice_number: 'AV-FICT-999', amount_ht: 1000, credited_pennylane_id: 'pl-inconnue', credited_invoice_number: 'F-FICT-HORS', etat: 'a_rattacher', reason: 'Facture d’origine (F-FICT-HORS) reliée à aucune ligne de MATRICE' },
      { id: 'a-6', pennylane_id: 'pl-fict-501', invoice_number: 'AV-FICT-501', amount_ht: 1000, credited_pennylane_id: 'pl-fict-500', etat: 'rattache', payment_id: 'av-p5', show_id: 'av-d5', gone_at: new Date().toISOString() }],
  });
  const panel = page.locator('#avoirs-a-rattacher');
  await expect(panel).toContainText('AV-FICT-999');
  await expect(panel).toContainText('reliée à aucune ligne de MATRICE');
  await expect(panel).toContainText('F-FICT-HORS');
  const e = await etat(page, ['av-d5']);
  expect(e.fin.impayesProd).toBe(1000);   // ni l'avoir à rattacher ni l'avoir disparu ne réduisent ce qui est dû
  await expect(page.locator('tr.avoir-row')).toHaveCount(0);
  // (point 3) avoir rattaché dont Pennylane indique une AUTRE facture d'origine : signal persistant, rien de déplacé
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
    S.db.pennylane_avoirs.push({ id: 'a-7', pennylane_id: 'pl-fict-502', invoice_number: 'AV-FICT-502', amount_ht: 100, credited_pennylane_id: 'pl-autre', credited_invoice_number: 'F-FICT-AUTRE',
      rattache_origine: 'pl-fict-500', etat: 'rattache', payment_id: 'av-p5', show_id: 'av-d5' }); touch('pennylane_avoirs'); app.render(); });
  await expect(page.locator('#avoirs-a-verifier')).toContainText('AV-FICT-502');
  await expect(page.locator('#avoirs-a-verifier')).toContainText('F-FICT-AUTRE');
  await expect(page.locator('tr.avoir-row', { hasText: 'AV-FICT-502' })).toContainText('facture d’origine changée dans Pennylane');
  expect(await page.evaluate(() => window.__DB.pennylane_avoirs.find(a => a.id === 'a-7')?.payment_id ?? 'av-p5')).toBe('av-p5');
  // relecture v1.69 (B1) : montant nul sans avoir → jamais « soldée » (même règle que la base)
  expect(await page.evaluate(async () => { const c = await import('./js/calc.js');
    return [c.soldeeParAvoir({ id: 'x0', kind: 'autre', amount: 0, sent_at: '2026-01-01', invoice_number: 'F-0' }), c.soldeeParAvoir({ id: 'x1', kind: 'autre', amount: -100, sent_at: '2026-01-01' })]; })).toEqual([false, false]);
  expectClean(ctx);
});
