// v1.70 — L2a du point 02 (décisions d'Anthony du 26/11/2026, 18 h 47 : D10, E1 à E4, R1, R2) : encaissements et remboursements réels
// d'après les virements Pennylane, sur de FAUSSES données (aucun appel à Pennylane ni à la base). Module : pennylane/regles.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encaisseNet, planEncaissement, planRemboursement } from '../../supabase/functions/pennylane/regles.ts';

const cas = [];
const t = (nom, f) => cas.push([nom, f]);
// facture 4 200 € HT à 5,5 % = 4 431,00 € TTC ; avoir 1 500 € HT = 1 582,50 € TTC ; reste dû 2 848,50 € TTC (= 2 700 € HT)
const F = { currency_amount: '4431.0', status: 'upcoming', paid: false }, AV = [1582.5];
const vir = (id, amount, date = '2026-11-20') => ({ id, amount: String(amount), date });
const reg = (o) => ({ id: o.id, sens: o.sens || 'encaissement', etat: o.etat || 'fait', montant_ttc: o.m, date: o.date ?? '2026-11-10', source: o.source || 'manuel', transaction_id: o.tx ?? null, annule_at: o.annule ?? null });
const S0 = new Set();

t('4 200 € facturés, 1 500 € d’avoir, 2 700 € HT encaissés (2 848,50 € TTC) : encaissement créé, payée — même base TTC', () => {
  const p = planEncaissement(F, AV, [vir('v1', 2848.5)], S0, []);
  assert.deepEqual(p.creer, [{ transaction_id: 'v1', montant: 2848.5, date: '2026-11-20' }]);
  assert.equal(p.paid_at, '2026-11-20'); assert.equal(p.signal, null); assert.equal(p.reste, 2848.5);
});
t('paiement partiel : enregistré, la facture reste due ; le virement suivant la solde (date du plus récent)', () => {
  const p1 = planEncaissement(F, AV, [vir('v1', 2000)], S0, []);
  assert.equal(p1.creer.length, 1); assert.equal(p1.paid_at, null); assert.equal(p1.signal, 'partiel'); assert.equal(p1.encaisse, 2000);
  const deja = [reg({ id: 'r1', m: 2000, source: 'pennylane', tx: 'v1', date: '2026-11-20' })];
  const p2 = planEncaissement(F, AV, [vir('v1', 2000), vir('v2', 848.5, '2026-11-25')], S0, deja);
  assert.deepEqual(p2.creer.map(c => c.transaction_id), ['v2']);   // v1 déjà enregistré pour cette ligne : jamais recréé
  assert.equal(p2.paid_at, '2026-11-25');
});
t('R1 : saisie manuelle puis virement Pennylane du même montant → rapprochée, jamais dupliquée', () => {
  const p = planEncaissement(F, AV, [vir('v9', 2000)], S0, [reg({ id: 'm1', m: 2000 })]);
  assert.deepEqual(p.creer, []); assert.deepEqual(p.rapprocher, [{ reglement_id: 'm1', transaction_id: 'v9' }]);
  assert.equal(p.encaisse, 2000); assert.equal(p.signal, 'partiel');
});
t('R1 : saisie manuelle et virement de montant différent, ou deux saisies candidates → à vérifier, rien de fait', () => {
  assert.equal(planEncaissement(F, AV, [vir('v9', 1500)], S0, [reg({ id: 'm1', m: 2000 })]).signal, 'a_verifier');
  const deux = planEncaissement(F, AV, [vir('v9', 1000)], S0, [reg({ id: 'm1', m: 1000 }), reg({ id: 'm2', m: 1000 })]);
  assert.equal(deux.signal, 'a_verifier'); assert.deepEqual(deux.creer, []); assert.deepEqual(deux.rapprocher, []);
});
t('saisie manuelle annulée : ne compte plus et ne bloque pas le virement', () => {
  const p = planEncaissement(F, AV, [vir('v9', 2848.5)], S0, [reg({ id: 'm1', m: 2000, annule: '2026-11-21' })]);
  assert.equal(p.creer.length, 1); assert.equal(p.paid_at, '2026-11-20');
});
t('saisies manuelles couvrant tout le reste dû, sans virement : payée à la date de la plus récente', () => {
  const p = planEncaissement(F, AV, [], S0, [reg({ id: 'm1', m: 2000, date: '2026-11-05' }), reg({ id: 'm2', m: 848.5, date: '2026-11-12' })]);
  assert.equal(p.paid_at, '2026-11-12'); assert.deepEqual(p.creer, []);
});
t('virement groupé plus grand que le reste dû → affectation non établie, rien de noté ; virement compté ailleurs → déjà compté', () => {
  assert.equal(planEncaissement(F, AV, [vir('g', 5000)], S0, []).signal, 'non_etabli');
  const dj = planEncaissement(F, AV, [vir('x', 2848.5)], new Set(['x']), []);
  assert.equal(dj.signal, 'deja_compte'); assert.deepEqual(dj.creer, []);
});
t('virement sortant, sans montant ou sans identifiant : jamais un encaissement', () => {
  for (const v of [vir('s', -2848.5), { id: 'n', date: '2026-11-20' }, { amount: '2848.5', date: '2026-11-20' }]) {
    const p = planEncaissement(F, AV, [v], S0, []); assert.deepEqual(p.creer, []); assert.equal(p.paid_at, null);
  }
});
t('facture soldée par l’avoir, ou annulée dans Pennylane : rien à encaisser', () => {
  assert.equal(planEncaissement({ currency_amount: '949.5', status: 'upcoming' }, [949.5], [vir('v', 949.5)], S0, []).signal, 'soldee');
  assert.deepEqual(planEncaissement({ currency_amount: '949.5', status: 'cancelled', paid: true }, [], [vir('v', 949.5)], S0, []).creer, []);
});
t('facture sans avoir, virement partiel puis complet (sans « paid ») ; « paid » sans virement → rien', () => {
  const G = { currency_amount: '1055', status: 'upcoming', paid: false };
  assert.equal(planEncaissement(G, [], [vir('a', 500)], S0, []).signal, 'partiel');
  assert.equal(planEncaissement(G, [], [vir('a', 1055)], S0, []).paid_at, '2026-11-20');
  const p = planEncaissement({ ...G, paid: true }, [], [], S0, []);
  assert.equal(p.paid_at, null); assert.deepEqual(p.creer, []);
});
t('remboursements (D10, R1) : virement sortant de l’avoir rapproché du remboursement manuel fait, sinon du « à faire », sinon créé', () => {
  const sortant = [vir('o1', -500, '2026-12-01')];
  assert.deepEqual(planRemboursement(sortant, S0, [reg({ id: 'rf', sens: 'remboursement', m: 500 })]).rapprocher, [{ reglement_id: 'rf', transaction_id: 'o1', date: '2026-12-01', a_faire: false }]);
  const af = planRemboursement(sortant, S0, [reg({ id: 'ra', sens: 'remboursement', etat: 'a_faire', m: 500, date: null })]);
  assert.deepEqual(af.rapprocher, [{ reglement_id: 'ra', transaction_id: 'o1', date: '2026-12-01', a_faire: true }]); assert.deepEqual(af.creer, []);
  assert.deepEqual(planRemboursement(sortant, S0, []).creer, [{ transaction_id: 'o1', montant: 500, date: '2026-12-01' }]);
  // saisie manuelle de montant différent → à vérifier, rien de fait ; virement entrant (cas Champs des Notes) → ignoré
  assert.equal(planRemboursement(sortant, S0, [reg({ id: 'rf', sens: 'remboursement', m: 300 })]).signal, 'a_verifier');
  assert.deepEqual(planRemboursement([vir('in', 1846.25)], S0, []), { creer: [], rapprocher: [], signal: null });
  // déjà rapproché ou compté ailleurs : jamais deux fois
  assert.deepEqual(planRemboursement(sortant, S0, [reg({ id: 'rf', sens: 'remboursement', m: 500, source: 'pennylane', tx: 'o1' })]).creer, []);
  assert.deepEqual(planRemboursement(sortant, new Set(['o1']), []).creer, []);
});
t('encaissé net : encaissements − remboursements faits ; « à faire » et annulés exclus ; un remboursement rapproché ne compte qu’une fois', () => {
  const rs = [reg({ id: 'a', m: 1000 }), reg({ id: 'b', sens: 'remboursement', m: 200 }), reg({ id: 'c', sens: 'remboursement', etat: 'a_faire', m: 50, date: null }), reg({ id: 'd', m: 999, annule: 'x' })];
  assert.equal(encaisseNet(rs), 800);
  // la saisie manuelle « b » rapprochée plus tard : même ligne, un identifiant de virement en plus → toujours 800
  assert.equal(encaisseNet(rs.map(r => r.id === 'b' ? { ...r, transaction_id: 'o1' } : r)), 800);
});

t('synchronisation : compte de la ligne lu (encaissement Pennylane sur le bon compte) ; réservation avant toute écriture ; ligne payée jamais retouchée (E1)', () => {
  const src = readFileSync(new URL('../../supabase/functions/pennylane/index.ts', import.meta.url), 'utf8');
  assert.match(src, /select\('id, show_id, kind, label, invoice_number, pennylane_id, paid_at, payee,/);
  const f = src.slice(src.indexOf('const encaisserLigne'), src.indexOf('const rembourserAvoir'));
  assert.ok(f.indexOf('await reserver(') < f.indexOf("from('reglements')"), 'réservation avant l’écriture des mouvements');
  assert.ok(f.indexOf("from('reglements')") < f.indexOf("from('show_payments')"), 'mouvements avant la date « Payée »');
  assert.match(f, /\.eq\('id', p\.id\)\.is\('paid_at', null\)/);
  assert.match(src, /if \(!p\.paid_at && x\.status !== 'cancelled'\) \{ await encaisserLigne/);
});

let ok = 0;
for (const [nom, f] of cas) { try { f(); ok++; } catch (e) { console.error('ÉCHEC :', nom, '\n', e.message); process.exitCode = 1; } }
console.log(`Encaissements Pennylane (fausses données) : ${ok}/${cas.length} réussies.`);
