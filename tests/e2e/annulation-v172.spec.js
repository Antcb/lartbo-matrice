// v1.72 — L3 du point 02 « Annuler la date » (décisions d'Anthony du 28/11/2026, 12 h 08). Données FICTIVES (« Lune Ardente ») ;
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

test('v1.72 — variante 1 : 2 000 € HT dus, acompte de 1 200 € encaissé → 800 € HT à facturer ; fermer n’enregistre rien ; fiche affichée', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { shows: [date('an-d1')], payments: lignes('an-d1') });
  await page.evaluate(() => { window.__calls.length = 0; });
  // fermer la fenêtre : rien n'est enregistré (ni statut, ni fiche)
  await page.locator('#prod-an-d1 select.st-sel').selectOption('Annulée');
  await expect(page.locator('#modal h2')).toHaveText('Annuler la date');
  await expect(page.locator('#modal [data-constat="an-d1-a"]')).toContainText('émise');
  await expect(page.locator('#modal .modal-foot button[data-act=closeModal]')).toHaveText('Fermer');
  await page.locator('#modal .modal-foot button[data-act=closeModal]').click();
  expect(await ecritures(page)).toEqual([]);
  expect((await etat(page, 'an-d1')).status).toBe('Confirmée Salle');
  // parcours complet : aperçu en direct, confirmation avant → après, fiche
  await annuler(page, 'an-d1', { montant: 2000 });
  await expect(page.locator('#annul-apercu [data-apercu-ligne="an-d1-s"]')).toContainText('À émettre : 800,00');
  await expect(page.locator('#annul-apercu [data-apercu-ligne="an-d1-a"]')).toContainText('Émise — conservée telle quelle');
  // « Revenir » à la confirmation : rien n'est enregistré, la fenêtre reste ouverte
  await page.locator('#modal button[type=submit]').click();
  await page.locator('dialog.ask button', { hasText: 'Revenir' }).click();
  await expect(page.locator('#modal h2')).toHaveText('Annuler la date');
  expect(await ecritures(page)).toEqual([]);
  await confirmer(page);
  await expect(page.locator('body')).toContainText('fiche d’annulation enregistrée');
  expect(await ecritures(page)).toEqual(['show_annuler']);   // aucune écriture directe : ni statut, ni avoir, ni remboursement
  const e = await etat(page, 'an-d1');
  expect(e.status).toBe('Annulée');
  expect(e.lignes).toEqual([
    { id: 'an-d1-a', amount: 1200, annulation: null, invoice_number: 'F-TEST-an-d1-A', paid_at: iso(-50) },   // facture émise et paiement intacts
    { id: 'an-d1-s', amount: 800, annulation: 'recalculee', invoice_number: null, paid_at: null },            // solde : 800 € HT à émettre
    { id: 'an-d1-c', amount: null, annulation: null, invoice_number: null, paid_at: null },                   // commission inchangée (à revoir)
  ]);
  expect(e.etat).toMatchObject({ du: 2000, factureNet: 1200, resteAFacturer: 800, depassement: 0, encaisse: 1200 });
  expect(e.reste).toBe(800);   // chiffres de Production : montant dû − encaissé, jamais le cachet initial
  // fiche : dans « Annulées à régulariser », onglet Annulation ouvert ; hors du compteur des dates confirmées
  const fiche = page.locator('#annulees-a-regulariser [data-fiche-annulation]');
  await expect(fiche).toBeVisible();
  await expect(fiche.locator('[data-montant-du]')).toContainText('2 000,00');
  await expect(fiche.locator('[data-ligne-annulation="an-d1-s"]')).toContainText('À émettre : 800,00');
  await expect(fiche.locator('[data-ligne-annulation="an-d1-s"]')).toContainText('initialement 2 800,00');
  await expect(fiche.locator('[data-ligne-annulation="an-d1-c"]')).toContainText('à revoir');
  await expect(fiche).toContainText('Cachet HT');
  await expect(fiche).toContainText('4 000,00');                                    // conditions initiales figées
  await expect(page.locator('body')).toContainText('0 date confirmée');   // hors du compteur des dates confirmées
  // statut verrouillé : seulement « Rétablir la date »
  await page.locator('#prod-an-d1 select.st-sel').selectOption('Confirmée Salle');
  await expect(page.locator('body')).toContainText('son statut ne change que par « Rétablir la date »');
  expect((await etat(page, 'an-d1')).status).toBe('Annulée');
  expectClean(ctx);
});

test('v1.72 — variante 2 : 1 200 € dus → solde « ne doit plus être émis », plus de relance ; rétablir remet tout', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { shows: [date('an-d2', { boucle_tech: null })], payments: lignes('an-d2') });
  expect((await etat(page, 'an-d2')).relances.length).toBeGreaterThan(0);   // avant : relances d'organisation
  await annuler(page, 'an-d2', { montant: 1200 });
  await expect(page.locator('#annul-apercu [data-apercu-ligne="an-d2-s"]')).toContainText('Ne doit plus être émise');
  await confirmer(page);
  await expect(page.locator('[data-fiche-annulation] [data-ligne-annulation="an-d2-s"] [data-ne-plus-emettre]')).toBeVisible();
  let e = await etat(page, 'an-d2');
  expect(e.lignes.find(l => l.id === 'an-d2-s')).toMatchObject({ amount: 0, annulation: 'abandonnee' });
  expect(e.relances).toEqual([]);   // organisation et ligne abandonnée : plus de relance
  // onglet Factures : la ligne reste visible avec sa marque
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); S.tab['prod:an-d2'] = 'factures'; app.render(); });
  await expect(page.locator('[data-annulation-ligne="abandonnee"]')).toHaveText('Ne doit plus être émise');
  await expect(page.locator('#prod-an-d2')).toContainText('montant dû après annulation');
  // rétablir : motif obligatoire, rien d'ajouté depuis → statut et lignes d'origine
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); S.tab['prod:an-d2'] = 'annulation'; app.render(); });
  await page.locator('[data-act="annulationRetablir"]').click();
  await page.locator('dialog.ask button', { hasText: 'Rétablir la date' }).click();
  await expect(page.locator('dialog.ask')).toContainText('À remplir');
  await page.locator('dialog.ask #ask-input').fill('Annulation saisie par erreur (essai)');
  await page.locator('dialog.ask button', { hasText: 'Rétablir la date' }).click();
  await expect(page.locator('body')).toContainText('Date rétablie en « Confirmée Salle »');
  e = await etat(page, 'an-d2');
  expect(e.status).toBe('Confirmée Salle');
  expect(e.lignes.find(l => l.id === 'an-d2-s')).toMatchObject({ amount: null, annulation: null });
  expect(e.relances.length).toBeGreaterThan(0);
  expectClean(ctx);
});

test('v1.72 — variante 3 : sans frais (0 €) → facturé et encaissé au-delà « À régulariser », aucun avoir ni remboursement ; correction motivée', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { shows: [date('an-d3')], payments: lignes('an-d3') });
  await page.evaluate(() => { window.__calls.length = 0; });
  await annuler(page, 'an-d3', { montant: 0, motif: 'Annulation sans frais (essai)' });
  await expect(page.locator('#annul-apercu [data-a-regulariser]')).toContainText('Facturé au-delà du montant dû');
  await expect(page.locator('#annul-apercu [data-operation=avoir]')).toContainText('1 200,00');
  await confirmer(page);
  const fiche = page.locator('[data-fiche-annulation]');
  await expect(fiche.locator('[data-operation=avoir]')).toContainText('dans Pennylane');
  await expect(fiche.locator('[data-operation=remboursement]')).toContainText('1 266,00');
  expect(await ecritures(page)).toEqual(['show_annuler']);   // ni avoir, ni remboursement, ni document
  // correction : motif de la correction obligatoire ; 0 € → 2 000 € : 800 € à émettre ; trace avant / après
  await fiche.locator('[data-act="annulationCorriger"]').click();
  await page.locator('#modal [name=montant]').fill('2000');
  await expect(page.locator('#annul-apercu [data-apercu-ligne="an-d3-s"]')).toContainText('initialement 2 800,00');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('body')).toContainText('Indique le motif de la correction');
  await page.locator('#modal [name=motif_correction]').fill('Avenant reçu (essai)');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('body')).toContainText('Annulation corrigée');
  const e = await etat(page, 'an-d3');
  expect(e.lignes.find(l => l.id === 'an-d3-s')).toMatchObject({ amount: 800, annulation: 'recalculee' });
  await expect(page.locator('[data-fiche-annulation] details')).toContainText('Corrigée');
  await expect(page.locator('[data-fiche-annulation] details')).toContainText('0,00 € → 2 000,00 €');
  expectClean(ctx);
});

test('v1.72 — facture émise au-delà du montant retenu : relance d’impayé suspendue (« À régulariser ») ; maintien : relance gardée', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { shows: [date('an-d4'), date('an-d5')], payments: [...lignes('an-d4', { soldeEmis: true }), ...lignes('an-d5', { soldeEmis: true })] });
  expect((await etat(page, 'an-d4')).relances).toContain('solde_paye');
  await annuler(page, 'an-d4', { montant: 2000, motif: 'Maintien partiel (essai)' });
  await expect(page.locator('#annul-apercu [data-a-regulariser]')).toContainText('Relance d’impayé suspendue');
  await confirmer(page);
  let e = await etat(page, 'an-d4');
  expect(e.lignes.find(l => l.id === 'an-d4-s')).toMatchObject({ amount: 2800, annulation: null, invoice_number: 'F-TEST-an-d4-S' });   // facture émise intacte
  expect(e.etat).toMatchObject({ factureNet: 4000, depassement: 2000, relanceGardee: false });
  expect(e.relances).toEqual([]);
  await expect(page.locator('#prod-an-d4 [data-a-regulariser]')).toContainText('Relance d’impayé suspendue : 2 800,00');
  await expect(page.locator('#prod-an-d4 [data-operation=avoir]')).toContainText('2 000,00 € HT');
  // maintien intégral : 2 800 € réclamés = encore dus → seule la relance d'impayé reste
  await annuler(page, 'an-d5', { montant: 4000, motif: 'Maintien intégral (essai)' });
  await confirmer(page);
  e = await etat(page, 'an-d5');
  expect(e.relances).toEqual(['solde_paye']);
  expectClean(ctx);
});

test('v1.72 — « Sans Suite » renvoie vers l’annulation ; date non engagée inchangée ; booking limité à la commission ; coréalisation sans calcul', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [date('an-d6'), date('an-d7', { contract_signed: null, contract_sent: null }), date('an-d8', { prod_mode: 'booking' }), date('an-d9', { contract_type: 'Co-Réalisation' })],
    payments: [...lignes('an-d6'), { id: 'an-d7-a', show_id: 'an-d7', kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 },
      { id: 'an-d8-c', show_id: 'an-d8', kind: 'artbo', label: 'Facture commission (artiste)', amount: 600, sort: 30, invoice_number: 'F-TEST-B', sent_at: iso(-20) }, ...lignes('an-d9')],
  });
  // Sans Suite sur une date engagée : fenêtre d'annulation, qui le dit
  await page.locator('#prod-an-d6 select.st-sel').selectOption('Sans Suite');
  await expect(page.locator('#modal')).toContainText('« Sans Suite » n’est pas possible pour une date engagée');
  await page.locator('#modal button[data-act=closeModal]').first().click();
  expect((await etat(page, 'an-d6')).status).toBe('Confirmée Salle');
  // date non engagée : passe en « Annulée » directement (comportement inchangé, 5 s pour annuler)
  await page.locator('#prod-an-d7 select.st-sel').selectOption('Annulée');
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect.poll(async () => (await etat(page, 'an-d7')).status).toBe('Annulée');
  expect((await etat(page, 'an-d7')).fiches).toBe(0);
  // fenêtre de la date : le statut demandé n'est pas enregistré, les autres champs oui, puis « Annuler la date » s'ouvre
  await page.evaluate(async () => { const f = await import('./js/forms.js'); f.editShow('an-d6'); });
  await page.locator('#modal [name=status]').selectOption('Annulée');
  await page.locator('#modal [name=notes]').fill('Note gardée (essai)');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal h2')).toHaveText('Annuler la date');
  expect(await page.evaluate(async () => { const { S } = await import('./js/state.js'); const s = S.db.shows.find(x => x.id === 'an-d6'); return [s.status, s.notes]; })).toEqual(['Confirmée Salle', 'Note gardée (essai)']);
  await page.locator('#modal button[data-act=closeModal]').first().click();
  // booking : pas de montant, commission seule ; relance de la facture de commission suspendue (à revoir)
  await annuler(page, 'an-d8', { motif: 'Festival annulé (essai)' });
  await expect(page.locator('#modal [name=montant]')).toHaveCount(0);
  await expect(page.locator('#modal')).toContainText('écran limité à la commission');
  await confirmer(page);
  let e = await etat(page, 'an-d8');
  expect(e.lignes).toEqual([{ id: 'an-d8-c', amount: 600, annulation: null, invoice_number: 'F-TEST-B', paid_at: null }]);
  expect(e.relances).toEqual([]);
  await expect(page.locator('#prod-an-d8 [data-a-regulariser]')).toContainText('commission à revoir');
  // coréalisation : motif, documents et mouvements ; aucune ligne modifiée
  await annuler(page, 'an-d9', { motif: 'Salle fermée (essai)' });
  await expect(page.locator('#modal [name=montant]')).toHaveCount(0);
  await confirmer(page);
  e = await etat(page, 'an-d9');
  expect(e.lignes.every(l => l.annulation === null) && e.lignes.find(l => l.id === 'an-d9-s').amount === null).toBe(true);
  await expect(page.locator('#prod-an-d9 [data-fiche-annulation]')).toContainText('Sans calcul automatique');
  expectClean(ctx);
});

test('v1.72 — ajustement du 28/11 (13 h 25) : solde recalculé « à faire » puis « à envoyer » ; facture au-delà sans relance ; aucun ajout de ligne', async ({ page }) => {
  const ctx = await openApp(page);
  const faite = sid => ({ ...lignes(sid)[1], amount: 2800, invoice_number: 'F-TEST-' + sid + '-S', invoiced_on: iso(-5) });
  await preparer(page, { shows: [date('an-d6'), date('an-d7'), date('an-d8')],
    payments: [...lignes('an-d6'), ...lignes('an-d7').map(p => p.kind === 'solde' ? faite('an-d7') : p), ...lignes('an-d8').map(p => p.kind === 'solde' ? faite('an-d8') : p)] });
  // solde recalculé (800 € à émettre) : « Facture de solde à faire » rétablie, seule relance de la date
  await annuler(page, 'an-d6', { montant: 2000 }); await confirmer(page);
  let e = await etat(page, 'an-d6');
  expect(e.lignes.find(l => l.id === 'an-d6-s')).toMatchObject({ amount: 800, annulation: 'recalculee' });
  expect(e.relances).toEqual(['annulation_facture']);
  // une fois émis (800 € = montant retenu) : « Facture à envoyer » prend le relais ; envoyé : relance d'impayé (800 € encore dus)
  await page.evaluate(async () => { const { save } = await import('./js/data.js'); await save('show_payments', 'an-d6-s', { invoice_number: 'F-TEST-an-d6-S', invoiced_on: new Date().toISOString().slice(0, 10) }); });
  e = await etat(page, 'an-d6');
  expect(e.lignes.find(l => l.id === 'an-d6-s')).toMatchObject({ amount: 800, invoice_number: 'F-TEST-an-d6-S' });
  expect(e.relances).toEqual(['facture_envoi']);
  await page.evaluate(async d => { const { save } = await import('./js/data.js'); await save('show_payments', 'an-d6-s', { sent_at: d }); }, iso(0));
  expect((await etat(page, 'an-d6')).relances).toEqual(['solde_paye']);
  // solde de 2 800 € fait mais pas envoyé, 2 000 € dus : facture « à régulariser » → aucune relance ; 4 000 € dus : « à envoyer » gardée
  await annuler(page, 'an-d7', { montant: 2000, motif: 'Maintien partiel (essai)' }); await confirmer(page);
  e = await etat(page, 'an-d7');
  expect(e.etat).toMatchObject({ depassement: 2000 });
  expect(e.relances).toEqual([]);
  await annuler(page, 'an-d8', { montant: 4000, motif: 'Maintien intégral (essai)' }); await confirmer(page);
  expect((await etat(page, 'an-d8')).relances).toEqual(['facture_envoi']);
  // aucun ajout d'acompte, de solde ni d'« Autre ligne » sur une date annulée (même refus que la base) ; boutons absents
  await expect(page.locator('#prod-an-d6 [data-act=addPay]')).toHaveCount(0);
  await page.evaluate(() => { window.__calls.length = 0; });
  const refus = await page.evaluate(async () => { const { insertRow } = await import('./js/data.js'); const out = [];
    for (const kind of ['acompte', 'autre', 'solde']) out.push((await insertRow('show_payments', { show_id: 'an-d6', kind, label: 'Essai', sort: 9 })).error?.message || '');
    return out; });
  refus.forEach(m => expect(m).toContain('Date annulée : aucune ligne de facturation'));
  const rattache = await page.evaluate(async () => (await import('./js/calc.js')).changeBlocked('show_payments', 'an-d6-c', { kind: 'autre' }));
  expect(rattache).toContain('Date annulée : aucune ligne de facturation');
  expect(await ecritures(page)).toEqual([]);
  expect((await etat(page, 'an-d6')).lignes).toHaveLength(3);
  expectClean(ctx);
});

test('v1.72.3 — qui doit payer qui : l’artiste annule (acompte encaissé restitué, commission non due) ; acompte jamais encaissé ; rappel immédiat hors solde', async ({ page }) => {
  const ctx = await openApp(page);
  const jamais = sid => lignes(sid).map(p => p.kind === 'acompte' ? { ...p, paid_at: null, payee: null } : p);
  const deuxAcomptes = sid => [lignes(sid)[0], { id: sid + '-b', show_id: sid, kind: 'acompte', label: 'Acompte 2', pct: 10, amount: 400, sort: 2 }, lignes(sid)[2]];
  await preparer(page, { shows: [date('an-e1'), date('an-e2'), date('an-e3')],
    payments: [...lignes('an-e1').map(p => p.kind === 'artbo' ? { ...p, amount: 180 } : p), ...jamais('an-e2'), ...deuxAcomptes('an-e3')] });
  await page.evaluate(async () => { const { S } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) (db.commission_transfers ||= []).push({ id: 'tr-e1', payment_id: 'an-e1-c', amount: 180, transferred_at: new Date().toISOString().slice(0, 10) }); });
  await page.evaluate(() => { window.__calls.length = 0; });

  // 1. l'artiste annule, accord : acompte encaissé restitué intégralement → 0 € dus par l'organisateur, commission non due
  await annuler(page, 'an-e1', { montant: 0, origine: 'artiste', commission: 'non_due', motif: 'L’artiste annule ; acompte restitué (essai)' });
  await expect(page.locator('#annul-apercu [data-operation=remboursement]')).toContainText('1 266,00');
  await confirmer(page);
  let e = await etat(page, 'an-e1');
  expect(e.lignes.find(l => l.id === 'an-e1-a')).toMatchObject({ amount: 1200, invoice_number: 'F-TEST-an-e1-A', annulation: null });   // facture et encaissement gardés
  expect(e.lignes.find(l => l.id === 'an-e1-s')).toMatchObject({ amount: 0, annulation: 'abandonnee' });
  expect(e.lignes.find(l => l.id === 'an-e1-c')).toMatchObject({ amount: 180 });   // commission : montant et versement intacts (L5)
  expect(e.relances).toEqual([]);
  const f1 = page.locator('#prod-an-e1 [data-fiche-annulation]');
  await expect(f1.locator('[data-origine=artiste]')).toContainText('L’artiste');
  await expect(f1.locator('[data-commission=non_due]')).toContainText('Non due');
  await expect(f1.locator('[data-operation]')).toHaveCount(3);
  await expect(f1.locator('[data-operation=avoir]')).toContainText('L’ArtBoristerie →');
  await expect(f1.locator('[data-operation=avoir]')).toContainText('1 200,00');
  await expect(f1.locator('[data-operation=remboursement]')).toContainText('1 266,00');
  await expect(f1.locator('[data-operation=remboursement]')).toContainText('(bénéficiaire)');
  await expect(f1.locator('[data-operation=commission][data-statut=a_regulariser]')).toContainText('déjà versée : 180,00');
  await expect(f1.locator('[data-a-regulariser]')).toContainText('Commission L’ArtBo non due');
  expect(await page.locator('#prod-an-e1 .subtab, #prod-an-e1 [data-tab=annulation]').first().textContent()).toContain('⚠︎');

  // 2. acompte facturé mais jamais encaissé, 0 € dus : avoir à émettre, AUCUN remboursement ; relance d'impayé suspendue
  await annuler(page, 'an-e2', { montant: 0, origine: 'commun', motif: 'Annulation d’un commun accord (essai)' }); await confirmer(page);
  e = await etat(page, 'an-e2');
  expect(e.relances).toEqual([]);
  const f2 = page.locator('#prod-an-e2 [data-fiche-annulation]');
  await expect(f2.locator('[data-operation=avoir]')).toContainText('aucun remboursement');
  await expect(f2.locator('[data-operation=remboursement]')).toHaveCount(0);
  await expect(f2.locator('[data-operation=commission][data-statut=a_revoir]')).toHaveCount(1);

  // 3. ligne recalculée autre qu'un solde (acompte 2 : 800 €), concert dans plusieurs mois : « Facture à faire » due aujourd'hui
  await annuler(page, 'an-e3', { montant: 2000 }); await confirmer(page);
  const r = await page.evaluate(async () => { const rem = await import('./js/reminders.js'); const { S } = await import('./js/state.js');
    return rem.remindersOf(S.db.shows.find(x => x.id === 'an-e3')).map(x => ({ key: x.key, step: x.step, due: x.due, late: x.late, title: x.title })); });
  expect(r).toEqual([{ key: 'annulation_facture', step: 'acompte', due: iso(0), late: true, title: 'Facture à faire (date annulée) : Acompte 2' }]);
  const f3 = page.locator('#prod-an-e3 [data-fiche-annulation]');
  await expect(f3.locator('[data-operation=facture]')).toContainText('800,00 € HT');
  await expect(f3.locator('[data-operation=paiement]')).toContainText('844,00 € TTC');

  expect(await ecritures(page)).toEqual(['show_annuler', 'show_annuler', 'show_annuler']);   // ni avoir, ni remboursement, ni document
  expectClean(ctx);
});
