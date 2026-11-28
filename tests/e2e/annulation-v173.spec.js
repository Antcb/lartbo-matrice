// (repris de annulation-v172.spec.js) v1.72 — L3 du point 02 « Annuler la date » (décisions d'Anthony du 28/11/2026, 12 h 08). Données FICTIVES (« Lune Ardente ») ;
// écritures par les fonctions serveur simulées (même calcul que le SQL, essayé sur une vraie base :
// supabase/repetitions/2026-11-28_v1.72_annulation_essai.sql).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear() + 1;
const iso = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function preparer(page, { shows, payments, budget = [] }){
  await page.evaluate(async ([shows, payments, budget, Y]) => {
    const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
    for (const db of [S.db, window.__DB]){
      db.shows.push(...structuredClone(shows)); db.show_payments.push(...structuredClone(payments)); db.budget_lines.push(...structuredClone(budget));
      db.annulations ||= []; db.annulations_journal ||= []; db.reglements ||= []; db.pennylane_avoirs ||= [];
    }
    for (const t of ['shows', 'show_payments', 'budget_lines', 'annulations']) touch(t);
    S.year = Y; app.go('production'); S.openProd = new Set(shows.map(s => s.id)); app.render();
  }, [shows, payments, budget, Y]);
}
// Lune Ardente · Le Hangar Bleu, Nantes : cession 4 000 € HT (TVA 5,5 %), contrat signé ; acompte 30 % facturé et encaissé ; solde calculé
const date = (id, extra = {}) => ({ id, project_id: 'art-a', venue: 'Le Hangar Bleu ' + id.slice(-1), city: 'Nantes', date: `${Y}-03-1${id.slice(-1)}`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 4000, vat_rate: 5.5, artbo_pct: 15, prod_mode: 'production', contract_sent: iso(-45), contract_signed: iso(-40), ...extra });
const lignes = (sid, { soldeEmis = false } = {}) => [
  { id: sid + '-a', show_id: sid, kind: 'acompte', label: 'Acompte', pct: 30, amount: 1200, sort: 1, invoice_number: 'F-TEST-' + sid + '-A', sent_at: iso(-60), paid_at: iso(-50), payee: 'compte' },
  { id: sid + '-s', show_id: sid, kind: 'solde', label: 'Solde', pct: 70, amount: soldeEmis ? 2800 : null, sort: 2, ...(soldeEmis ? { invoice_number: 'F-TEST-' + sid + '-S', sent_at: iso(-20) } : {}) },
  { id: sid + '-c', show_id: sid, kind: 'artbo', label: 'Commission L’ArtBo', pct: null, amount: null, sort: 3 },
];
const etat = (page, sid) => page.evaluate(async sid => {
  const calc = await import('./js/calc.js'); const rem = await import('./js/reminders.js'); const { S } = await import('./js/state.js');
  const s = S.db.shows.find(x => x.id === sid);
  return { status: s.status, lignes: S.db.show_payments.filter(p => p.show_id === sid).map(p => ({ id: p.id, amount: p.amount ?? null, annulation: p.annulation ?? null, invoice_number: p.invoice_number ?? null, paid_at: p.paid_at ?? null })),
    relances: rem.remindersOf(s).map(r => r.key), etat: (({ du, factureNet, resteAFacturer, depassement, encaisse, relanceGardee }) => ({ du, factureNet, resteAFacturer, depassement, encaisse, relanceGardee }))(calc.etatAnnulation(s) || {}),
    reste: calc.financeOf([s]).resteProd, fiches: (S.db.annulations || []).filter(a => a.show_id === sid).length };
}, sid);
const ecritures = page => page.evaluate(() => window.__calls.filter(c => (c.table && c.op !== 'select') || c.rpc).map(c => c.rpc || `${c.table}.${c.op}`));
async function annuler(page, sid, { montant, motif = 'L’organisateur annule (essai fictif)', statut = 'Annulée', origine = 'organisateur', commission } = {}){
  await page.locator(`#prod-${sid} select.st-sel`).selectOption(statut);
  await expect(page.locator('#modal h2')).toHaveText('Annuler la date');
  if (origine) await page.locator('#modal [name=origine]').selectOption(origine);
  if (commission) await page.locator('#modal [name=commission]').selectOption(commission);
  if (montant != null) await page.locator('#modal [name=montant]').fill(String(montant));
  await page.locator('#modal [name=motif]').fill(motif);
  await page.locator('#modal [name=justificatif]').fill('Mail fictif du 20/02');
}
const confirmer = async page => { await page.locator('#modal button[type=submit]').click(); await page.locator('dialog.ask button', { hasText: 'Annuler la date' }).click(); };


// v1.73 — L4 « Suivi des régularisations » (décisions d'Anthony du 28/11/2026, 16 h 46). Données FICTIVES. Les mouvements (avoir importé,
// remboursements) sont posés comme la synchronisation et les fonctions de la base les posent ; la clôture et la réouverture côté base
// sont essayées en SQL (supabase/repetitions/2026-11-28_v1.73_regularisation_essai.sql).
const poser = (page, table, rows) => page.evaluate(async ([table, rows]) => {
  const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
  for (const db of [S.db, window.__DB]) (db[table] ||= []).push(...structuredClone(rows));
  touch(table); app.render();
}, [table, rows]);
const suivi = (page, sid) => page.evaluate(async sid => {
  const calc = await import('./js/calc.js'); const rem = await import('./js/reminders.js'); const { S } = await import('./js/state.js');
  const s = S.db.shows.find(x => x.id === sid), e = calc.etatAnnulation(s);
  return { dossier: e.dossier, codes: e.suivi.blocages.map(b => b.code).sort(), sv: e.suivi, relances: rem.remindersOf(s).map(r => [r.key, r.title, r.due]) };
}, sid);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

test('v1.73 — l’artiste annule : avoir rattaché ≠ remboursement, remboursement partiel puis fait, avenant, clôture refusée puis acceptée', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { shows: [date('an-r1')], payments: lignes('an-r1') });
  await annuler(page, 'an-r1', { montant: 0, origine: 'artiste', commission: 'non_due', motif: 'L’artiste annule (essai)' }); await confirmer(page);
  let x = await suivi(page, 'an-r1');
  expect(x.dossier).toBe('a_regulariser');
  expect(x.codes).toEqual(['avenant', 'avoir', 'remboursement']);
  expect(x.relances.map(r => r[0])).toEqual(['annulation_avoir', 'annulation_remboursement']);
  expect(x.relances.every(r => r[2] === today)).toBe(true);
  const fiche = page.locator('#prod-an-r1 [data-suivi-regularisation]');
  await expect(fiche.locator('[data-dossier]')).toHaveText('À régulariser');
  await expect(fiche.locator('[data-suivi=avoir]')).toContainText('1 200,00');
  await expect(fiche.locator('[data-suivi=remboursement]')).toContainText('1 266,00');
  await expect(fiche.locator('[data-blocage=avoir]')).toHaveCount(1);
  await expect(fiche.locator('[data-act=annulationCloturer]')).toHaveCount(0);
  // avoir importé et rattaché : solde seulement l'avoir
  await poser(page, 'pennylane_avoirs', [{ id: 'av-r1', pennylane_id: 'PL-R1', invoice_number: 'F-AV-R1', invoice_date: today, amount_ht: 1200, amount_ttc: 1266, etat: 'rattache', payment_id: 'an-r1-a', show_id: 'an-r1' }]);
  x = await suivi(page, 'an-r1');
  expect(x.codes).toEqual(['avenant', 'remboursement']);
  expect(x.sv.remboursement.resteTtc).toBe(1266);
  expect(x.relances.map(r => r[0])).toEqual(['annulation_remboursement']);
  await expect(fiche.locator('[data-preuve-avoir]')).toContainText('F-AV-R1');
  // remboursement « à faire » : non compté ; puis 1 000 € faits (non rapprochés) : reste 266 € TTC, rappel au montant restant
  await poser(page, 'reglements', [{ id: 'rg-1', payment_id: 'an-r1-a', show_id: 'an-r1', sens: 'remboursement', etat: 'a_faire', montant_ttc: 1266, source: 'manuel' }]);
  x = await suivi(page, 'an-r1');
  expect([x.sv.remboursement.resteTtc, x.sv.remboursement.faitTtc, x.sv.remboursement.aFaireTtc]).toEqual([1266, 0, 1266]);
  await expect(fiche.locator('[data-preuve-remboursement=a_faire]')).toContainText('non compté');
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); for (const db of [S.db, window.__DB]) { const r = db.reglements.find(y => y.id === 'rg-1'); r.annule_at = new Date().toISOString(); r.annule_motif = 'essai'; } });
  await poser(page, 'reglements', [{ id: 'rg-2', payment_id: 'an-r1-a', show_id: 'an-r1', sens: 'remboursement', etat: 'fait', montant_ttc: 1000, date: today, compte: 'artbo', reference: 'VIR-FICTIF-1', source: 'manuel' }]);
  x = await suivi(page, 'an-r1');
  expect(x.sv.remboursement.resteTtc).toBe(266);
  expect(x.relances.find(r => r[0] === 'annulation_remboursement')[1]).toContain('266,00');
  await expect(fiche.locator('[data-preuve-remboursement=fait]')).toContainText('Non rapproché');
  await expect(fiche.locator('[data-suivi=remboursement]')).toContainText('266,00');
  await poser(page, 'reglements', [{ id: 'rg-3', payment_id: 'an-r1-a', show_id: 'an-r1', sens: 'remboursement', etat: 'fait', montant_ttc: 266, date: today, compte: 'artbo', reference: 'VIR-FICTIF-2', source: 'manuel' }]);
  x = await suivi(page, 'an-r1');
  expect(x.codes).toEqual(['avenant']);
  expect(x.relances).toEqual([]);
  // avenant : case + lien obligatoire
  await fiche.locator('[data-act=annulationAvenant]').click();
  await page.locator('#modal [name=signe]').check();
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('lien');
  await page.locator('#modal [name=lien]').fill('https://drive.example.test/avenant-r1');
  await page.locator('#modal button[type=submit]').click();
  x = await suivi(page, 'an-r1');
  expect(x.dossier).toBe('pret');
  await expect(fiche.locator('[data-dossier]')).toHaveText('Prêt à clôturer');
  await expect(fiche.locator('[data-avenant]')).toContainText('signé');
  // clôture refusée par la base (état changé entre-temps) : rien ne change
  await page.evaluate(() => { window.__RPC_ERROR = { annulation_cloturer: { code: 'P0001', message: 'Clôture impossible : reste à rembourser' } }; });
  await fiche.locator('[data-act=annulationCloturer]').click();
  await page.locator('dialog.ask button', { hasText: 'Clôturer' }).click();
  await expect(page.locator('.toast').last()).toContainText('Clôture impossible');
  expect((await suivi(page, 'an-r1')).dossier).toBe('pret');
  // clôture acceptée : « Régularisé », historique, section « Annulées régularisées »
  await page.evaluate(() => { window.__RPC_ERROR = {}; window.__calls.length = 0; });
  await fiche.locator('[data-act=annulationCloturer]').click();
  await page.locator('dialog.ask button', { hasText: 'Clôturer' }).click();
  await expect(page.locator('#annulees-regularisees #prod-an-r1')).toHaveCount(1);
  expect((await suivi(page, 'an-r1')).dossier).toBe('regularise');
  expect(await ecritures(page)).toEqual(['annulation_cloturer']);   // aucun avoir ni remboursement créé
  expectClean(ctx);
});

test('v1.73 — acompte jamais encaissé, commission bloquante, avenant dispensé, TVA mixte, réouverture affichée, booking', async ({ page }) => {
  const ctx = await openApp(page);
  const jamais = sid => lignes(sid).map(p => p.kind === 'acompte' ? { ...p, paid_at: null, payee: null } : p);
  const sansFacture = sid => lignes(sid).map(p => p.kind === 'acompte' ? { id: p.id, show_id: sid, kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 } : p).filter(p => p.kind !== 'artbo');
  await preparer(page, { shows: [date('an-r2'), date('an-r3'), date('an-r4'), date('an-r5')],
    payments: [...jamais('an-r2'), ...lignes('an-r3'), ...sansFacture('an-r4'), ...lignes('an-r5').map(p => p.kind === 'solde' ? { ...p, vat_rate: 20 } : p)] });
  // B : avoir à émettre, aucun remboursement
  await annuler(page, 'an-r2', { montant: 0, origine: 'commun', commission: 'non_due' }); await confirmer(page);
  let x = await suivi(page, 'an-r2');
  expect(x.codes).toEqual(['avenant', 'avoir']);
  expect(x.sv.remboursement.resteTtc).toBe(0);
  expect(x.relances.map(r => r[0])).toEqual(['annulation_avoir']);
  // commission « à revoir » : bloque, motif affiché
  await annuler(page, 'an-r3', { montant: 1200, origine: 'organisateur' }); await confirmer(page);
  x = await suivi(page, 'an-r3');
  expect(x.codes).toContain('commission');
  await expect(page.locator('#prod-an-r3 [data-blocage=commission]')).toContainText('commission');
  // G : sans frais, aucune facture émise → avenant dispensé, prêt (date engagée par le contrat signé)
  await annuler(page, 'an-r4', { montant: 0, origine: 'organisateur', commission: 'non_due' }); await confirmer(page);
  x = await suivi(page, 'an-r4');
  expect([x.dossier, x.sv.avenantDispense]).toEqual(['pret', true]);
  await expect(page.locator('#prod-an-r4 [data-avenant]')).toContainText('non requis');
  // F : TVA mixte → TTC à vérifier, aucun montant de remboursement proposé
  await annuler(page, 'an-r5', { montant: 0, origine: 'artiste', commission: 'non_due' }); await confirmer(page);
  x = await suivi(page, 'an-r5');
  expect(x.sv.remboursement.resteTtc).toBe(null);
  expect(x.relances.find(r => r[0] === 'annulation_remboursement')[1]).toBe('Remboursement à faire (date annulée) : TTC à vérifier');
  await expect(page.locator('#prod-an-r5 [data-suivi=remboursement]')).toContainText('TTC à vérifier');
  // réouverture automatique (posée par la base) : signal et cause affichés, de nouveau « À régulariser »
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
    const a = S.db.annulations.find(y => y.show_id === 'an-r2'); Object.assign(a, { reouvert_at: new Date().toISOString(), reouvert_cause: 'Avoir modifié : avoir à émettre' });
    touch('annulations'); app.render(); });
  await expect(page.locator('#prod-an-r2 [data-reouvert]')).toContainText('Avoir modifié : avoir à émettre');
  expectClean(ctx);
});
