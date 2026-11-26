// v1.69 — L1 du point 02 (décisions d'Anthony du 26/11/2026, D7) : import des avoirs Pennylane, sur de FAUSSES données (aucun appel à
// Pennylane ni à la base). Module testé : supabase/functions/pennylane/regles.ts ; contrôle du code de la synchronisation (index.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encaissementPennylane, estAvoir, montantAvoir, origineAvoir, planAvoir, rattacherAvoir } from '../../supabase/functions/pennylane/regles.ts';

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
  assert.equal(garde.origine_changee, false);   // origine précédente inconnue : rien à signaler
  // Pennylane indique maintenant une autre facture d'origine : laissé sur sa ligne, signalé
  const change = planAvoir({ ...x, credited_invoice: { id: 202 } }, { etat: 'rattache', payment_id: 'l-1', show_id: 'd-1', credited_pennylane_id: '101' }, lignes, VU);
  assert.equal(change.payment_id, 'l-1'); assert.equal(change.origine_changee, true);
  assert.equal(planAvoir(x, { etat: 'rattache', payment_id: 'l-1', show_id: 'd-1', credited_pennylane_id: '101' }, lignes, VU).origine_changee, false);
  // « À rattacher » puis facture d'origine reliée à une ligne : rattaché à la synchronisation suivante
  const avant = planAvoir({ ...x, credited_invoice: { id: 555 } }, null, lignes, VU);
  assert.equal(avant.etat, 'a_rattacher');
  const apres = planAvoir({ ...x, credited_invoice: { id: 555 } }, { etat: 'a_rattacher', payment_id: null, show_id: null }, [...lignes, { id: 'l-9', show_id: 'd-9', pennylane_id: '555' }], VU);
  assert.equal(apres.etat, 'rattache'); assert.equal(apres.payment_id, 'l-9');
  // aucun champ d'encaissement ni de remboursement dans ce qui est enregistré
  for (const k of Object.keys(neuf)) assert.doesNotMatch(k, /paid|rembours|encaiss/);
});
t('jamais d’encaissement sur la seule base de « paid = true » ni d’un avoir', () => {
  // facture soldée par un avoir total, sans virement (cas Produc’son, fictif) : annulée dans Pennylane → rien
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'cancelled' }, [], false), { paid_at: null, signal: null });
  // « paid » sans virement rapproché → rien, signalé
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'paid' }, [], false), { paid_at: null, signal: 'sans_transaction' });
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'paid' }, [null, ''], false), { paid_at: null, signal: 'sans_transaction' });
  // ligne couverte par un avoir (partiel) : jamais reprise, même avec un virement
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'paid' }, ['2026-10-29'], true), { paid_at: null, signal: 'avec_avoir' });
  // virement rapproché, sans avoir : date du virement le plus récent
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'paid' }, ['2026-10-01', '2026-10-29T08:00:00Z'], false), { paid_at: '2026-10-29', signal: null });
  assert.deepEqual(encaissementPennylane({ paid: false, status: 'upcoming' }, ['2026-10-29'], false), { paid_at: null, signal: null });
});
t('avoir créé par erreur puis facture réémise (cas Champs des Notes, fictif) : l’avoir se rattache à l’acompte d’origine, aucun encaissement', () => {
  const acompte = { id: 'l-ac', show_id: 'd-cn', pennylane_id: '77' };
  const avoir = planAvoir({ id: 117, invoice_number: 'AV-117', currency_amount_before_tax: '-1750.0', credited_invoice: { id: 77 } }, null, [acompte], VU);
  assert.equal(avoir.etat, 'rattache'); assert.equal(avoir.payment_id, 'l-ac');
  // facture d'origine annulée dans Pennylane mais « payée » : rien n'est repris (le paiement d'octobre noté dans MATRICE est conservé)
  assert.deepEqual(encaissementPennylane({ paid: true, status: 'cancelled' }, ['2026-10-29'], true), { paid_at: null, signal: null });
  // la réémission n'est pas un avoir : jamais importée comme tel
  assert.equal(estAvoir({ id: 120, currency_amount_before_tax: '1750.0', credited_invoice: null }), false);
});
t('code de la synchronisation : plus de date du jour comme date de paiement, encaissement seulement via encaissementPennylane', () => {
  const src = readFileSync(new URL('../../supabase/functions/pennylane/index.ts', import.meta.url), 'utf8');
  const bloc = src.slice(src.indexOf('const isPaid ='), src.indexOf('pennylaneLate.push'));
  assert.match(bloc, /encaissementPennylane\(x, dates, avoir\)/);
  assert.doesNotMatch(bloc, /today\(\)/);
  assert.match(bloc, /update\(\{ paid_at: date \}\)/);
  assert.match(bloc, /const date = enc\.paid_at;/);
  // les avoirs sont importés avec un upsert sur l'identifiant Pennylane (aucun doublon) et jamais supprimés
  assert.match(src, /from\('pennylane_avoirs'\)\.upsert\(.*\{ onConflict: 'pennylane_id' \}\)/);
  assert.doesNotMatch(src, /from\('pennylane_avoirs'\)\.delete/);
});

let ok = 0;
for (const [nom, f] of cas) { try { f(); ok++; } catch (e) { console.error('ÉCHEC :', nom, '\n', e.message); process.exitCode = 1; } }
console.log(`Avoirs Pennylane (fausses données) : ${ok}/${cas.length} réussies.`);
