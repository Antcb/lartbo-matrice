// v1.69 — L1 du point 02 (décisions d'Anthony du 26/11/2026, D7) : import des avoirs Pennylane, sur de FAUSSES données (aucun appel à
// Pennylane ni à la base). Module testé : supabase/functions/pennylane/regles.ts ; contrôle du code de la synchronisation (index.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encaissementAvecAvoir, encaissementPennylane, estAvoir, montantAvoir, origineAvoir, origineEcart, planAvoir, rattacherAvoir } from '../../supabase/functions/pennylane/regles.ts';

const cas = [];
const t = (nom, f) => cas.push([nom, f]);
const VU = '2026-11-26T12:00:00.000Z';

t('facture d’origine lue par son identifiant Pennylane (objet API v2, nombre, ancien champ), sinon null', () => {
  assert.equal(origineAvoir({ credited_invoice: { id: 101, url: 'x' } }), '101');
  assert.equal(origineAvoir({ credited_invoice: 202 }), '202');
  assert.equal(origineAvoir({ credited_invoice_id: 303 }), '303');
  assert.equal(origineAvoir({ credited_invoice: null }), null);
  assert.equal(origineAvoir({}), null);
  assert.equal(origineAvoir({ credited_invoice: false }), null);   // relecture v1.69 : un booléen n'est pas un identifiant
  assert.equal(origineAvoir({ credited_invoice: true }), null);
  assert.equal(origineAvoir({ credited_invoice: {} }), null);
});
t('avoir reconnu : marqué, lié à une origine, ou montant négatif ; une facture ordinaire n’en est pas un', () => {
  assert.equal(estAvoir({ credit_note: true }), true);
  assert.equal(estAvoir({ credited_invoice: { id: 1 } }), true);
  assert.equal(estAvoir({ currency_amount_before_tax: '-900.0' }), true);
  assert.equal(estAvoir({ currency_amount_before_tax: '900.0', credited_invoice: null }), false);
  assert.equal(estAvoir({ currency_amount_before_tax: '900.0', credited_invoice: false }), false);
  assert.equal(montantAvoir({ currency_amount_before_tax: '-1750.0' }), 1750);
  assert.equal(montantAvoir({ currency_amount_before_tax: '1750' }), 1750);   // signe ignoré
});
const lignes = [{ id: 'l-1', show_id: 'd-1', pennylane_id: '101' }, { id: 'l-2', show_id: 'd-2', pennylane_id: '202' }, { id: 'l-3', show_id: 'd-2', pennylane_id: '202' },
  { id: 'l-4', show_id: 'd-3', pennylane_id: null, invoice_number: 'F-404' }];
t('rattachement par l’identifiant Pennylane de la facture d’origine : une seule ligne → rattaché', () => {
  assert.deepEqual(rattacherAvoir('101', lignes), { etat: 'rattache', payment_id: 'l-1', show_id: 'd-1', reason: null });
});
t('lien ambigu → « À rattacher » avec motif : origine non indiquée, absente de MATRICE, plusieurs lignes', () => {
  assert.equal(rattacherAvoir(null, lignes).etat, 'a_rattacher');
  assert.match(rattacherAvoir(null, lignes).reason, /n’indique pas/);
  const absent = rattacherAvoir('999', lignes, 'F-999');
  assert.equal(absent.etat, 'a_rattacher'); assert.equal(absent.payment_id, null); assert.match(absent.reason, /F-999.*aucune ligne/);
  const deux = rattacherAvoir('202', lignes);
  assert.equal(deux.etat, 'a_rattacher'); assert.equal(deux.payment_id, null); assert.equal(deux.show_id, 'd-2'); assert.match(deux.reason, /2 lignes/);
});
t('jamais de rattachement par numéro, montant ou client : une ligne qui n’a que le numéro n’est pas retenue', () => {
  assert.equal(rattacherAvoir('404', lignes, 'F-404').etat, 'a_rattacher');
});
t('sans doublon : la clé est l’identifiant Pennylane ; un avoir rattaché le reste (jamais déplacé), un « À rattacher » est réexaminé', () => {
  const x = { id: 7001, invoice_number: 'AV-1', date: '2026-11-23', currency_amount_before_tax: '-900.0', currency_amount: '-949.5', credited_invoice: { id: 101 }, status: 'cancelled' };
  const neuf = planAvoir(x, null, lignes, VU);
  assert.equal(neuf.pennylane_id, '7001'); assert.equal(neuf.etat, 'rattache'); assert.equal(neuf.payment_id, 'l-1'); assert.equal(neuf.nouveau_rattachement, true);
  assert.equal(neuf.amount_ht, 900); assert.equal(neuf.amount_ttc, 949.5); assert.equal(neuf.gone_at, null); assert.equal(neuf.last_seen_at, VU);
  // déjà rattaché : même si les lignes ont changé, il reste où il est
  const garde = planAvoir(x, { etat: 'rattache', payment_id: 'l-1', show_id: 'd-1' }, [], VU);
  assert.equal(garde.payment_id, 'l-1'); assert.equal(garde.nouveau_rattachement, false);
  assert.equal(garde.origine_changee, false);   // origine du rattachement inconnue : rien à signaler
  assert.equal('rattache_origine' in garde, false);   // jamais réécrite sur un avoir déjà rattaché
  assert.equal(neuf.rattache_origine, '101');   // nouveau rattachement : origine gardée
  // Pennylane indique maintenant une autre facture d'origine : laissé sur sa ligne, signalé À CHAQUE synchronisation (persistant)
  const exist = { etat: 'rattache', payment_id: 'l-1', show_id: 'd-1', rattache_origine: '101' };
  for (let i = 0; i < 2; i++){ const change = planAvoir({ ...x, credited_invoice: { id: 202 } }, exist, lignes, VU);
    assert.equal(change.payment_id, 'l-1'); assert.equal(change.origine_changee, true); assert.equal(change.credited_pennylane_id, '202'); }
  assert.equal(planAvoir({ ...x, credited_invoice: null }, exist, lignes, VU).origine_changee, true);   // origine disparue : écart aussi
  assert.equal(planAvoir(x, exist, lignes, VU).origine_changee, false);
  assert.equal(planAvoir({ ...x, credited_invoice: { id: 101 } }, exist, lignes, VU).origine_changee, false);   // nombre ou texte : même origine
  assert.equal(origineEcart('101', '202'), true); assert.equal(origineEcart(null, '202'), false);
  // « À rattacher » puis facture d'origine reliée à une ligne : rattaché à la synchronisation suivante
  const avant = planAvoir({ ...x, credited_invoice: { id: 555 } }, null, lignes, VU);
  assert.equal(avant.etat, 'a_rattacher');
  const apres = planAvoir({ ...x, credited_invoice: { id: 555 } }, { etat: 'a_rattacher', payment_id: null, show_id: null }, [...lignes, { id: 'l-9', show_id: 'd-9', pennylane_id: '555' }], VU);
  assert.equal(apres.etat, 'rattache'); assert.equal(apres.payment_id, 'l-9');
  // aucun champ d'encaissement ni de remboursement dans ce qui est enregistré
  for (const k of Object.keys(neuf)) assert.doesNotMatch(k, /paid|rembours|encaiss/);
});
t('sans avoir : « paid » ET virement rapproché ; jamais la seule base de « paid = true » ; un virement n’est compté qu’une fois', () => {
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'cancelled' }, [{ id: 1, date: '2026-10-01' }]), { paid_at: null, ids: [], signal: null });
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'paid' }, []), { paid_at: null, ids: [], signal: 'sans_transaction' });
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'paid' }, [{ id: 'v1', date: '2026-10-01' }, { id: 'v2', date: '2026-10-29T08:00:00Z' }]), { paid_at: '2026-10-29', ids: ['v1', 'v2'], signal: null });
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'paid' }, [{ id: 'v1', date: '2026-10-01' }], new Set(['v1'])), { paid_at: null, ids: [], signal: 'deja_compte' });
  assert.deepEqual(encaissementPennylane({ paid: false, status: 'upcoming' }, [{ id: 'v1', date: '2026-10-29' }]), { paid_at: null, ids: [], signal: null });
});
// mêmes bases : TTC Pennylane (facture 4 200 € HT à 5,5 % = 4 431,00 € TTC ; avoir 1 500 € HT = 1 582,50 € TTC)
const F = { currency_amount: '4431.0', currency_amount_before_tax: '4200.0', status: 'upcoming', paid: false };
t('4 200 € facturés, 1 500 € d’avoir, 2 700 € HT réellement encaissés (2 848,50 € TTC) : payée, même base TTC, virement mémorisé', () => {
  const r = encaissementAvecAvoir(F, [1582.5], [{ id: 'vir-1', date: '2026-11-20', amount: '2848.5' }]);
  assert.deepEqual(r, { paid_at: '2026-11-20', ids: ['vir-1'], encaisse: 2848.5, reste: 2848.5, signal: null });
  // « paid » de Pennylane sans importance : la preuve est le virement
  assert.equal(encaissementAvecAvoir({ ...F, paid: true }, [1582.5], [{ id: 'vir-1', date: '2026-11-20', amount: '2848.5' }]).paid_at, '2026-11-20');
  // deux virements qui couvrent ensemble le reste : date du plus récent
  assert.equal(encaissementAvecAvoir(F, [1582.5], [{ id: 'a', date: '2026-11-01', amount: 1000 }, { id: 'b', date: '2026-11-15', amount: 1848.5 }]).paid_at, '2026-11-15');
});
t('affectation non établie (relecture B2) : virement groupé plus grand que le reste dû → rien de noté', () => {
  const G = { currency_amount: '5040', status: 'upcoming' };
  assert.deepEqual(encaissementAvecAvoir(G, [1800], [{ id: '9', date: '2026-11-20', amount: 5000 }]), { paid_at: null, ids: [], encaisse: 0, reste: 3240, signal: 'non_etabli' });
  assert.equal(encaissementAvecAvoir(G, [1800], [{ id: 'a', date: '2026-11-20', amount: 2000 }, { id: 'b', date: '2026-11-21', amount: 2000 }]).signal, 'non_etabli');
  assert.equal(encaissementAvecAvoir(G, [1800], [{ id: 'c', date: '2026-11-20', amount: 3240.01 }]).paid_at, '2026-11-20');   // à 1 centime près
});
t('sans avoir : virement plus grand que la facture (groupé) → à vérifier, rien de noté (17 h 42)', () => {
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'paid', currency_amount: '1055' }, [{ id: 'g', date: '2026-11-20', amount: 3000 }]), { paid_at: null, ids: [], signal: 'a_verifier' });
  assert.equal(encaissementPennylane({ paid: true, status: 'paid', currency_amount: '1055' }, [{ id: 'h', date: '2026-11-20', amount: 1055 }]).paid_at, '2026-11-20');
  // reprise : virement réservé pour CETTE ligne (absent des « déjà comptés ailleurs ») → repris ; réservé pour une autre → jamais
  assert.equal(encaissementPennylane({ paid: true, status: 'paid' }, [{ id: 'r', date: '2026-11-20', amount: 10 }], new Set()).paid_at, '2026-11-20');
  assert.equal(encaissementPennylane({ paid: true, status: 'paid' }, [{ id: 'r', date: '2026-11-20', amount: 10 }], new Set(['r'])).signal, 'deja_compte');
});
t('sans avoir : un virement sortant n’est jamais un encaissement (relecture v1.69.1)', () => {
  assert.equal(encaissementPennylane({ paid: true, status: 'paid' }, [{ id: '5', date: '2026-11-20', amount: -100 }]).signal, 'sans_transaction');
  assert.equal(encaissementPennylane({ paid: true, status: 'paid' }, [{ id: '6', date: '2026-11-20', amount: '100' }]).paid_at, '2026-11-20');
});
t('virement partiel après avoir : rien de noté, signalé pour L2 (montants TTC)', () => {
  assert.deepEqual(encaissementAvecAvoir(F, [1582.5], [{ id: 'vir-2', date: '2026-11-20', amount: '2000' }]), { paid_at: null, ids: [], encaisse: 2000, reste: 2848.5, signal: 'partiel' });
});
t('jamais l’avoir ni « paid = true » comme preuve ; virement non établi, sortant ou déjà compté : rien de noté', () => {
  assert.equal(encaissementAvecAvoir({ ...F, paid: true }, [1582.5], []).signal, 'sans_virement');
  assert.equal(encaissementAvecAvoir(F, [1582.5], [{ id: 'v', date: '2026-11-20' }]).signal, 'non_etabli');   // montant inconnu
  assert.equal(encaissementAvecAvoir(F, [1582.5], [{ date: '2026-11-20', amount: 2848.5 }]).signal, 'non_etabli');   // sans identifiant
  assert.equal(encaissementAvecAvoir(F, [1582.5], [{ id: 'v', date: '2026-11-20', amount: -2848.5 }]).signal, 'non_etabli');   // sortant
  assert.equal(encaissementAvecAvoir(F, [1582.5], [{ id: 'v', date: '2026-11-20', amount: 2848.5 }], new Set(['v'])).signal, 'deja_compte');
  assert.equal(encaissementAvecAvoir(F, [null], [{ id: 'v', date: '2026-11-20', amount: 2848.5 }]).signal, 'non_etabli');   // TTC de l'avoir inconnu
  assert.equal(encaissementAvecAvoir({ status: 'upcoming' }, [1582.5], [{ id: 'v', date: '2026-11-20', amount: 2848.5 }]).signal, 'non_etabli');   // TTC facture inconnu
});
t('facture soldée par un avoir total sans encaissement (forme Produc’son) : rien à encaisser, aucun paiement', () => {
  assert.equal(encaissementAvecAvoir({ currency_amount: '949.5', status: 'upcoming' }, [949.5], []).signal, 'soldee');
  assert.equal(encaissementAvecAvoir({ currency_amount: '949.5', status: 'upcoming' }, [949.5], []).paid_at, null);
  // annulée dans Pennylane (cas réel observé) : rien
  assert.deepEqual(encaissementAvecAvoir({ currency_amount: '949.5', status: 'cancelled', paid: true }, [949.5], []), { paid_at: null, ids: [], encaisse: 0, reste: null, signal: null });
});
t('avoir créé par erreur puis facture réémise (forme Champs des Notes) : l’avoir se rattache à l’acompte d’origine, aucun encaissement', () => {
  const acompte = { id: 'l-ac', show_id: 'd-cn', pennylane_id: '77' };
  const avoir = planAvoir({ id: 117, invoice_number: 'AV-117', currency_amount_before_tax: '-1750.0', currency_amount: '-1846.25', credited_invoice: { id: 77 } }, null, [acompte], VU);
  assert.equal(avoir.etat, 'rattache'); assert.equal(avoir.payment_id, 'l-ac'); assert.equal(avoir.amount_ttc, 1846.25);
  // facture d'origine annulée dans Pennylane : rien n'est repris (le paiement d'octobre noté dans MATRICE est conservé par l'appelant)
  assert.equal(encaissementAvecAvoir({ currency_amount: '1846.25', status: 'cancelled', paid: true }, [1846.25], [{ id: 'oct', date: '2026-10-29', amount: '1846.25' }]).paid_at, null);
  // la réémission n'est pas un avoir : jamais importée comme tel
  assert.equal(estAvoir({ id: 120, currency_amount_before_tax: '1750.0', credited_invoice: null }), false);
});
t('code de la synchronisation : plus de date du jour comme date de paiement, encaissement seulement via encaissementPennylane', () => {
  const src = readFileSync(new URL('../../supabase/functions/pennylane/index.ts', import.meta.url), 'utf8');
  const bloc = src.slice(src.indexOf('const isPaid ='), src.indexOf('pennylaneLate.push'));
  assert.match(bloc, /av \? encaissementAvecAvoir\(x, av, vs, dejaAilleurs\) : encaissementPennylane\(x, vs, dejaAilleurs\)/);
  // (17 h 42, cas 1) reprise : un virement réservé pour CETTE ligne n'est pas « déjà compté » pour elle, ni réinséré ; retrait signalé s'il échoue
  assert.match(src, /const autresQue = \(pid: string\) => new Set\(\[\.\.\.comptes\]\.filter\(\(\[, l\]\) => l !== pid\)/);
  assert.match(bloc, /const dejaAilleurs = autresQue\(String\(p\.id\)\)/);
  assert.match(bloc, /const nouveaux = enc\.ids\.filter\(id => comptes\.get\(id\) !== String\(p\.id\)\)/);
  assert.match(bloc, /réservation du virement non retirée/);
  assert.match(bloc, /\.neq\('origine', 'historique'\)/);
  // (17 h 42, cas 2) historique : virements des lignes déjà payées de la même date réservés AVANT de compter ; doute → à vérifier
  assert.ok(bloc.indexOf('await reserverHistorique(') > 0 && bloc.indexOf('await reserverHistorique(') < bloc.indexOf('const enc = av ?'));
  assert.match(bloc, /if \(enc\.paid_at && doute\.length\) \{ aVerifier\.push/);
  assert.match(bloc, /if \(enc\.signal === 'a_verifier'\) \{ aVerifier\.push/);
  assert.match(src, /origine: 'historique'/);
  assert.doesNotMatch(bloc, /today\(\)/);
  assert.match(bloc, /const date = enc\.paid_at;/);
  // paiement existant jamais écrasé : écriture conditionnée à une date vide ; virements mémorisés (jamais deux fois)
  assert.match(bloc, /update\(\{ paid_at: date \}\)\.eq\('id', p\.id\)\.is\('paid_at', null\)/);
  assert.match(bloc, /if \(!p\.paid_at && x\.status !== 'cancelled'/);
  // virements mémorisés AVANT d'écrire le paiement (deux synchronisations simultanées : le second insert échoue, rien n'est noté)
  const ins = bloc.indexOf("from('pennylane_virements').insert("), upd = bloc.indexOf("update({ paid_at: date })");
  assert.ok(ins > 0 && upd > ins, 'insert des virements avant le paiement');
  assert.doesNotMatch(bloc, /pennylane_virements'\)\.upsert/);
  assert.match(src, /action === 'lire_avoir'/);
  const lecture = src.slice(src.indexOf("action === 'lire_avoir'"), src.indexOf("action === 'sync'"));
  assert.doesNotMatch(lecture, /admin\.from|'POST'|'PUT'|'PATCH'|'DELETE'/);   // lecture seule
  // les avoirs sont importés avec un upsert sur l'identifiant Pennylane (aucun doublon) et jamais supprimés
  assert.match(src, /from\('pennylane_avoirs'\)\.upsert\(.*\{ onConflict: 'pennylane_id' \}\)/);
  assert.doesNotMatch(src, /from\('pennylane_avoirs'\)\.delete/);
});

let ok = 0;
for (const [nom, f] of cas) { try { f(); ok++; } catch (e) { console.error('ÉCHEC :', nom, '\n', e.message); process.exitCode = 1; } }
console.log(`Avoirs Pennylane (fausses données) : ${ok}/${cas.length} réussies.`);
