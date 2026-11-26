// v1.70 — L2a du point 02 « Encaissements et remboursements » (décisions d'Anthony du 26/11/2026, 18 h 47 : D10, E1 à E4, R1, R2 ;
// réponses du 26/11 : encaissement partiel compté partout en équivalent HT ; au-delà du reste dû → accepté après confirmation).
// Données FICTIVES. Écritures par les fonctions serveur simulées (mêmes contrôles que le SQL, essayé sur une vraie base).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear() + 1;
const iso = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function preparer(page, {shows, payments, avoirs = [], reglements = []}){
  await page.evaluate(async ([shows, payments, avoirs, reglements, Y]) => {
    const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
    for (const db of [S.db, window.__DB]){
      db.shows.push(...structuredClone(shows)); db.show_payments.push(...structuredClone(payments));
      db.pennylane_avoirs = [...(db.pennylane_avoirs || []), ...structuredClone(avoirs)];
      db.reglements = [...(db.reglements || []), ...structuredClone(reglements)];
    }
    for (const t of ['shows', 'show_payments', 'pennylane_avoirs', 'reglements']) touch(t);
    S.year = Y; app.go('production'); S.openProd = new Set(shows.map(s => s.id)); shows.forEach(s => { S.tab['prod:' + s.id] = 'factures'; }); app.render();
  }, [shows, payments, avoirs, reglements, Y]);
}
const show = (id, venue, extra = {}) => ({ id, project_id: 'art-a', venue, city: 'Ville fictive', date: `${Y}-04-1${id.slice(-1)}`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 4200, vat_rate: 5.5, prod_mode: 'production', ...extra });
const etat = (page, id) => page.evaluate(async id => {
  const calc = await import('./js/calc.js'); const { S } = await import('./js/state.js');
  const s = S.db.shows.find(x => x.id === id), ps = S.db.show_payments.filter(p => p.show_id === id);
  return { fin: calc.financeOf([s]), restes: calc.restesDate(s), paid: Object.fromEntries(ps.map(p => [p.id, p.paid_at ?? null])),
    payee: Object.fromEntries(ps.map(p => [p.id, p.payee ?? null])), reglements: (S.db.reglements || []).filter(r => r.show_id === id) };
}, id);
const ecritures = (page, table) => page.evaluate(t => window.__calls.filter(c => c.table === t && c.op !== 'select'), table);
const rpcs = page => page.evaluate(() => window.__calls.filter(c => c.rpc && c.rpc.startsWith('reglement_')).map(c => c.rpc));

async function encaisser(page, payId, {montant, date, compte = 'compte', reference = ''}){
  await page.locator(`[data-act="reglementEncaisser"][data-id="${payId}"]`).click();
  const m = page.locator('#modal');
  await m.locator('[name=montant]').fill(String(montant));
  await m.locator('[name=date]').fill(date);
  await m.locator('[name=compte]').selectOption(compte);
  if (reference) await m.locator('[name=reference]').fill(reference);
  await m.locator('button[type=submit]').click();
}

test('v1.70 — encaissement partiel puis complet (4 200 € facturés, avoir 1 500 €) : non rapproché, compté partout en HT, « Payée » à la date du dernier', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('en-d1', 'Salle Partiel')],
    payments: [{ id: 'en-p1', show_id: 'en-d1', kind: 'acompte', label: 'Acompte', pct: 100, amount: 4200, vat_rate: 5.5, sort: 1, invoice_number: 'F-FICT-1', pennylane_id: 'pl-fict-1', sent_at: iso(-30), invoiced_on: iso(-31) }],
    avoirs: [{ id: 'a-1', pennylane_id: 'pl-fict-av1', invoice_number: 'AV-FICT-1', amount_ht: 1500, amount_ttc: 1582.5, credited_pennylane_id: 'pl-fict-1', etat: 'rattache', payment_id: 'en-p1', show_id: 'en-d1' }],
  });
  // la fenêtre propose le reste dû TTC (4 431 − 1 582,50 = 2 848,50)
  await page.locator('[data-act="reglementEncaisser"][data-id="en-p1"]').click();
  await expect(page.locator('#modal [name=montant]')).toHaveValue('2848,5');
  await page.locator('#modal [name=montant]').fill('2000');
  await page.locator('#modal [name=date]').fill(iso(-10));
  await page.locator('#modal [name=compte]').selectOption('compte');
  await page.locator('#modal [name=reference]').fill('VIR FICTIF 1');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('tr.reglement-row', { hasText: 'Encaissement' }).first()).toContainText('saisi à la main, non rapproché');
  let e = await etat(page, 'en-d1');
  expect(e.paid['en-p1']).toBeNull();                       // partiel : la facture reste due
  expect(e.restes).toMatchObject({ factureNet: 2848.5, encaisse: 2000, resteDu: 848.5, aRembourser: 0, trop: 0 });
  expect(e.fin.resteProd).toBe(2304.27);                     // compté partout en équivalent HT : 4 200 − 1 895,73
  // les cinq montants, distincts, au pied de la date
  const pied = page.locator(`[data-restes="en-d1"]`);
  for (const t of ['Reste contractuel', 'Facturé net après avoirs : 2 848,50', 'Encaissé réel : 2 000,00', 'Reste dû : 848,50', 'Reste à rembourser : 0,00']) await expect(pied).toContainText(t);
  // second encaissement : la facture est couverte → « Payée » à la date du plus récent ; plus de bouton d'encaissement
  await encaisser(page, 'en-p1', { montant: '848.50', date: iso(-2) });
  e = await etat(page, 'en-d1');
  expect(e.paid['en-p1']).toBe(iso(-2));
  expect(e.payee['en-p1']).toBe('compte');
  expect(e.restes).toMatchObject({ encaisse: 2848.5, resteDu: 0 });
  await expect(page.locator('[data-act="reglementEncaisser"][data-id="en-p1"]')).toHaveCount(0);
  expect(await rpcs(page)).toEqual(['reglement_saisir', 'reglement_saisir']);
  // seule écriture directe sur la ligne : la date « Payée » (et le compte), une fois
  expect((await ecritures(page, 'show_payments')).length).toBe(1);
  expectClean(ctx);
});

test('v1.70 — encaissement au-delà du reste dû : confirmation ; refusée → rien ; acceptée → trop-perçu affiché, aucun remboursement créé', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('en-d2', 'Salle Trop', { fee_ht: 1000 })],
    payments: [{ id: 'en-p2', show_id: 'en-d2', kind: 'solde', label: 'Solde', amount: 1000, vat_rate: 5.5, sort: 2, invoice_number: 'F-FICT-2', sent_at: iso(-20) }],
  });
  await encaisser(page, 'en-p2', { montant: '1200', date: iso(-1) });
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('1 055,00');
  await dlg.locator('button', { hasText: 'Annuler' }).click();
  await expect(page.locator('#modal')).toBeVisible();          // la saisie reste ouverte
  expect(await rpcs(page)).toEqual([]);
  await page.locator('#modal button[type=submit]').click();
  await page.locator('dialog.ask button', { hasText: 'Enregistrer quand même' }).click();
  await expect(page.locator(`[data-restes="en-d2"]`)).toContainText('encaissé au-delà du net facturé : 145,00');
  const e = await etat(page, 'en-d2');
  expect(e.paid['en-p2']).toBe(iso(-1));
  expect(e.reglements.map(r => r.sens)).toEqual(['encaissement']);   // aucun remboursement créé d'office
  expectClean(ctx);
});

test('v1.70 — remboursement à faire puis fait (D10) ; annulation motivée : saisie gardée, barrée, plus comptée (R2)', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('en-d3', 'Salle Rembourse', { fee_ht: 1000 })],
    payments: [{ id: 'en-p3', show_id: 'en-d3', kind: 'solde', label: 'Solde', amount: 1000, vat_rate: 5.5, sort: 2, invoice_number: 'F-FICT-3', sent_at: iso(-20) }],
    reglements: [{ id: 'rg-1', payment_id: 'en-p3', show_id: 'en-d3', sens: 'encaissement', etat: 'fait', montant_ttc: 1200, date: iso(-5), compte: 'compte', source: 'manuel', transaction_id: null, created_at: iso(-5) }],
  });
  await expect(page.locator(`[data-restes="en-d3"]`)).toContainText('encaissé au-delà du net facturé : 145,00');
  // remboursement à faire : la fenêtre propose le trop-perçu
  await page.locator('[data-act="reglementRembourser"][data-id="en-p3"][data-etat="a_faire"]').click();
  await expect(page.locator('#modal [name=montant]')).toHaveValue('145');
  await page.locator('#modal [name=motif]').fill('Trop-perçu fictif');
  await page.locator('#modal button[type=submit]').click();
  const aFaire = page.locator('tr.reglement-row', { hasText: 'Trop-perçu fictif' });
  await expect(aFaire).toContainText('Remboursement à faire');
  let e = await etat(page, 'en-d3');
  expect(e.restes).toMatchObject({ encaisse: 1200, aRembourser: 145, trop: 0 });   // à faire : aucun mouvement d'argent
  // marqué fait : date, compte
  await aFaire.locator('[data-act="reglementFait"]').click();
  await page.locator('#modal [name=date]').fill(iso(-1));
  await page.locator('#modal [name=compte]').selectOption('compte');
  await page.locator('#modal button[type=submit]').click();
  await expect(aFaire).toContainText('Remboursement fait');
  await expect(aFaire).toContainText('− 145,00');
  e = await etat(page, 'en-d3');
  expect(e.restes).toMatchObject({ encaisse: 1055, aRembourser: 0, trop: 0, resteDu: 0 });
  // annulation du remboursement : motif obligatoire ; la saisie reste, barrée, et ne compte plus
  await aFaire.locator('[data-act="reglementAnnuler"]').click();
  const dlg = page.locator('dialog.ask');
  await dlg.locator('button', { hasText: 'Annuler la saisie' }).click();
  await expect(dlg).toContainText('À remplir');
  await dlg.locator('#ask-input').fill('Saisie en double (essai)');
  await dlg.locator('button', { hasText: 'Annuler la saisie' }).click();
  const barre = page.locator('tr.reglement-row.is-cancelled');
  await expect(barre).toContainText('Saisie en double (essai)');
  await expect(barre.locator('s')).toContainText('Remboursement fait');
  e = await etat(page, 'en-d3');
  expect(e.reglements).toHaveLength(2);                              // jamais effacée
  expect(e.restes).toMatchObject({ encaisse: 1200, trop: 145 });
  expect(await rpcs(page)).toEqual(['reglement_saisir', 'reglement_effectuer', 'reglement_annuler']);
  expect((await ecritures(page, 'reglements')).length).toBe(0);      // aucune écriture directe : tout passe par les fonctions serveur
  expectClean(ctx);
});

test('v1.70 — paiement historique (E1) : lu tel quel, aucune écriture ; mouvement rapproché Pennylane non annulable ; comptes alimentés', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('en-d4', 'Salle Historique', { contract_type: 'Co-Réalisation', fee_ht: 3500 })],
    payments: [
      { id: 'en-p4', show_id: 'en-d4', kind: 'acompte', label: 'Acompte', pct: 50, amount: 1750, vat_rate: 5.5, sort: 1, invoice_number: 'F-FICT-77', pennylane_id: 'pl-fict-77', sent_at: `${Y - 1}-06-10`, paid_at: `${Y - 1}-10-30`, payee: 'compte' },
      { id: 'en-p5', show_id: 'en-d4', kind: 'solde', label: 'Solde', pct: 50, amount: 1750, vat_rate: 5.5, sort: 2, invoice_number: 'F-FICT-78', pennylane_id: 'pl-fict-78', sent_at: iso(-3) }],
    reglements: [{ id: 'rg-p', payment_id: 'en-p5', show_id: 'en-d4', sens: 'encaissement', etat: 'fait', montant_ttc: 1000, date: iso(-1), compte: 'compte', source: 'pennylane', transaction_id: 'tx-fictif', created_at: iso(-1), rapproche_at: iso(-1) }],
  });
  await expect(page.locator('tr.reglement-row', { hasText: 'conservé tel quel' })).toContainText('Paiement noté le');
  const rap = page.locator('tr.reglement-row', { hasText: 'rapproché Pennylane' });
  await expect(rap).toContainText('1 000,00');
  await expect(rap.locator('[data-act="reglementAnnuler"]')).toHaveCount(0);
  await expect(page.locator('[data-act="reglementEncaisser"][data-id="en-p4"]')).toHaveCount(0);   // payée : paiement conservé
  const e = await etat(page, 'en-d4');
  expect(e.paid).toEqual({ 'en-p4': `${Y - 1}-10-30`, 'en-p5': null });
  // encaissé réel = paiement historique (1 846,25 TTC) + 1 000 rapprochés ; reste dû = 1 846,25 − 1 000
  expect(e.restes).toMatchObject({ encaisse: 2846.25, resteDu: 846.25 });
  expect(e.fin.resteProd).toBe(802.13);                      // 3 500 − 1 750 − 947,87 (équivalent HT des 1 000 TTC)
  // comptes d'encaissement : les deux mouvements sur le compte dédié
  const moves = await page.evaluate(async () => { const b = await import('./js/budget.js');
    return b.accountMoves('art-a').filter(m => m.label.includes('Salle Historique')).map(m => [m.label.split(' — ')[0], m.amount]); });
  expect(moves).toEqual([['Acompte', 1750], ['Solde (encaissement)', 947.87]]);
  expect((await ecritures(page, 'show_payments')).length).toBe(0);
  expect(await rpcs(page)).toEqual([]);
  expectClean(ctx);
});
