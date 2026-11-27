// v1.70 — L2a du point 02 (décisions d'Anthony du 26/11/2026, 18 h 47 : D10, E1 à E4, R1, R2) : encaissements et remboursements réels
// d'après les virements Pennylane, sur de FAUSSES données (aucun appel à Pennylane ni à la base). Module : pennylane/regles.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encaisseNet, planAvoir, planEncaissement, planRemboursement, remboursementsAutoActifs } from '../../supabase/functions/pennylane/regles.ts';

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

t('remboursements automatiques : désactivés sauf réglage explicite « oui » (format Pennylane confirmé) ; sinon rien enregistré ni réservé', () => {
  for (const v of [undefined, null, '', 'non', false, 'false', 0, '1', { on: true }]) assert.equal(remboursementsAutoActifs(v), false, String(v));
  for (const v of ['oui', '"oui"', 'Oui', true, 'true']) assert.equal(remboursementsAutoActifs(v), true, String(v));
  const src = readFileSync(new URL('../../supabase/functions/pennylane/index.ts', import.meta.url), 'utf8');
  const f = src.slice(src.indexOf('const rembourserAvoir'), src.indexOf('// paiements repris'));
  const garde = f.indexOf('if (!rembAuto)');
  assert.ok(garde > 0 && garde < f.indexOf('await reserver(') && garde < f.indexOf("from('reglements')"), 'garde avant toute réservation ou écriture');
});

t('(v1.71, L2b) part d’un virement groupé réparti à la main : jamais rapprochée d’un autre virement, comptée dans l’encaissé', () => {
  const part = { ...reg({ id: 'g1', m: 1000 }), virement_groupe_id: 'vg-1' };
  const p = planEncaissement(F, AV, [vir('v5', 1848.5)], S0, [part]);
  assert.deepEqual(p.rapprocher, []); assert.deepEqual(p.creer, [{ transaction_id: 'v5', montant: 1848.5, date: '2026-11-20' }]);
  assert.equal(p.paid_at, '2026-11-20');                       // 1 000 + 1 848,50 = 2 848,50 dus
  // le virement groupé lui-même (compté « ailleurs » pour toutes les lignes) n'est jamais repris
  assert.equal(planEncaissement(F, AV, [vir('vg-tx', 5000)], new Set(['vg-tx']), [part]).signal, 'partiel');
});
t('(v1.71, L2b) décision manuelle sur un avoir (rattaché, détaché, hors MATRICE) : jamais défaite par la synchronisation', () => {
  const x = { id: 'av1', invoice_number: 'AV-1', currency_amount_before_tax: '-100', currency_amount: '-105.5', credited_invoice: { id: 'pl-9' } };
  const lignes = [{ id: 'L9', show_id: 'S9', pennylane_id: 'pl-9' }];
  const auto = planAvoir(x, { etat: 'a_rattacher', payment_id: null, show_id: null, rattache_mode: 'auto' }, lignes, 'now');
  assert.equal(auto.etat, 'rattache');                          // réexaminé : rattaché automatiquement
  const det = planAvoir(x, { etat: 'a_rattacher', payment_id: null, show_id: null, rattache_mode: 'manuel', reason: 'Détaché à la main : x' }, lignes, 'now');
  assert.equal(det.etat, 'a_rattacher'); assert.equal(det.payment_id, null); assert.equal(det.reason, 'Détaché à la main : x');
  const hors = planAvoir(x, { etat: 'hors_matrice', payment_id: null, show_id: null, rattache_mode: 'manuel' }, lignes, 'now');
  assert.equal(hors.etat, 'hors_matrice'); assert.equal(hors.payment_id, null);
  const man = planAvoir(x, { etat: 'rattache', payment_id: 'L7', show_id: 'S7', rattache_mode: 'manuel', rattache_origine: 'pl-9' }, lignes, 'now');
  assert.equal(man.payment_id, 'L7'); assert.equal(man.origine_changee, false); assert.equal(man.amount_ht, 100);
  assert.equal(planAvoir(x, { etat: 'rattache', payment_id: 'L7', show_id: 'S7', rattache_mode: 'manuel', rattache_origine: 'pl-8' }, lignes, 'now').origine_changee, true);
});
t('(v1.71, L2b) synchronisation : avoirs d’une facture remplacée hors du net ; virements groupés jamais comptés ; réémission lue puis écrite par la base', () => {
  const src = readFileSync(new URL('../../supabase/functions/pennylane/index.ts', import.meta.url), 'utf8');
  assert.match(src, /select\('id, payment_id, amount_ttc'\)\.eq\('etat', 'rattache'\)\.is\('gone_at', null\)\.eq\('facture_remplacee', false\)/);
  assert.match(src, /rattache_origine, rattache_mode, reason'/);
  assert.match(src, /const autresQue = \(pid: string\) => new Set\(\[\.\.\.\[\.\.\.comptes\]\.filter\(\(\[, l\]\) => l !== pid\)\.map\(\(\[t\]\) => t\), \.\.\.groupes\]\)/);
  assert.match(src, /!comptes\.has\(String\(v\.id\)\) && !groupes\.has\(String\(v\.id\)\)/);
  const r = src.slice(src.indexOf("body.action === 'reemission'"), src.indexOf("body.action === 'sync'"));
  assert.ok(r.includes("admin.rpc('facture_reemise_enregistrer'") && !/from\('show_payments'\)\.update/.test(r), 'écriture par la seule fonction de la base');
  assert.ok(r.indexOf('estAvoir(x)') > 0 && r.indexOf("x.status === 'cancelled'") > 0);
});

t('(v1.71) Champs des Notes après réémission puis resynchronisation : l’avoir de F-77 reste rattaché, sa marque « facture remplacée », sa qualification ne sont jamais réécrites', () => {
  const f117 = { id: 'pl-117', invoice_number: 'AV-117', currency_amount_before_tax: '-1750', currency_amount: '-1846.25', credited_invoice: { id: 'pl-77', invoice_number: 'F-77' } };
  const rec = planAvoir(f117, { etat: 'rattache', payment_id: 'L1', show_id: 'S1', rattache_origine: 'pl-77', rattache_mode: 'auto' }, [{ id: 'L1', show_id: 'S1', pennylane_id: 'pl-120' }], 'now');
  assert.equal(rec.etat, 'rattache'); assert.equal(rec.payment_id, 'L1'); assert.equal(rec.origine_changee, false);
  for (const k of ['facture_remplacee', 'qualification', 'classement_motif', 'rattache_mode']) assert.ok(!(k in rec), k + ' jamais écrit par la synchronisation');
  // ligne payée (paiement historique du 30/10) : la synchronisation n'y crée aucun encaissement (seules les lignes sans date « Payée »)
  const src = readFileSync(new URL('../../supabase/functions/pennylane/index.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(!p\.paid_at && x\.status !== 'cancelled'\) \{ await encaisserLigne/);
});

t('(v1.71, 27/11 16 h 16) rattachement manuel : écart seulement si Pennylane indique une origine qui le contredit', () => {
  const x = o => ({ id: 'avm', invoice_number: 'AV-M', currency_amount_before_tax: '-10', credited_invoice: o ? { id: o } : null });
  const ex = { etat: 'rattache', payment_id: 'L7', show_id: 'S7', rattache_mode: 'manuel', rattache_origine: null };
  const L = [{ id: 'L7', show_id: 'S7', pennylane_id: 'pl-7' }];
  assert.equal(planAvoir(x(null), ex, L, 'now').origine_changee, false);                         // origine absente : rien
  assert.equal(planAvoir(x('pl-7'), ex, L, 'now').origine_changee, false);                       // concorde avec la ligne
  assert.equal(planAvoir(x('pl-77'), ex, [], 'now', [{ payment_id: 'L7', pennylane_id: 'pl-77' }]).origine_changee, false);   // facture remplacée de la ligne
  const c = planAvoir(x('pl-autre'), ex, L, 'now');
  assert.equal(c.origine_changee, true); assert.equal(c.payment_id, 'L7'); assert.equal(c.etat, 'rattache');   // signalé, gardé
  assert.equal(planAvoir(x('pl-autre'), { ...ex, rattache_origine: 'pl-autre' }, L, 'now').origine_changee, false);   // confirmé
});
t('(v1.71, 27/11 16 h 16) parts saisies d’un virement groupé : la synchronisation n’enregistre jamais de nouveau le virement entier', () => {
  const parts = [{ ...reg({ id: 'g1', m: 1000 }), virement_groupe_id: 'vg-1' }];
  // le virement (identifiant obligatoire, compté « ailleurs » pour toutes les lignes) rapproché ensuite d'une seule facture
  const p = planEncaissement(F, AV, [vir('9000002', 1000)], new Set(['9000002']), parts);
  assert.deepEqual(p.creer, []); assert.deepEqual(p.rapprocher, []); assert.equal(p.encaisse, 1000);
  const src = readFileSync(new URL('../../supabase/functions/pennylane/index.ts', import.meta.url), 'utf8');
  assert.match(src, /identifiant Pennylane : \$\{vs\.map/);   // le signal donne l'identifiant à saisir
});

let ok = 0;
for (const [nom, f] of cas) { try { f(); ok++; } catch (e) { console.error('ÉCHEC :', nom, '\n', e.message); process.exitCode = 1; } }
console.log(`Encaissements Pennylane (fausses données) : ${ok}/${cas.length} réussies.`);
