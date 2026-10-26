// Règles de la synchronisation Pennylane (lot C1) sur de FAUSSES données : aucun appel à Pennylane ni à la base.
// Lancé par « npm test » (node --experimental-strip-types). Module testé : supabase/functions/pennylane/regles.ts
import assert from 'node:assert/strict';
import { acomptesFactures, emise, factureIsolee, montantAttendu, payable, relieAuDevis } from '../../supabase/functions/pennylane/regles.ts';

const cas = [];
const t = (nom, f) => cas.push([nom, f]);

t('booking : seule la commission se reprend (payée / numéro) ; jamais les factures de l’artiste', () => {
  assert.equal(payable({ kind: 'artbo' }, 'booking'), true);
  for (const k of ['acompte', 'solde', 'autre', 'partner']) assert.equal(payable({ kind: k }, 'booking'), false, k);
});
t('production : acompte, solde, autre ligne repris ; jamais la commission (pas une facture)', () => {
  for (const k of ['acompte', 'solde', 'autre']) assert.equal(payable({ kind: k }, 'production'), true, k);
  assert.equal(payable({ kind: 'artbo' }, 'production'), false);
  assert.equal(payable({ kind: 'artbo' }, null), false);   // mode vide = production
});
t('rapprochement avec le devis : acompte / solde de production seulement', () => {
  assert.equal(relieAuDevis({ kind: 'solde' }, 'production'), true);
  assert.equal(relieAuDevis({ kind: 'acompte' }, 'booking'), false);
  assert.equal(relieAuDevis({ kind: 'solde' }, 'booking'), false);
  assert.equal(relieAuDevis({ kind: 'artbo' }, 'production'), false);
});
t('facture isolée : commission en booking, autre ligne en production ; jamais la commission de production', () => {
  assert.equal(factureIsolee({ kind: 'artbo' }, 'booking'), true);
  assert.equal(factureIsolee({ kind: 'artbo' }, 'production'), false);
  assert.equal(factureIsolee({ kind: 'autre' }, 'production'), true);
  assert.equal(factureIsolee({ kind: 'autre' }, 'booking'), false);
});
t('solde attendu = cession − acomptes facturés (10 000 → 10 000 sans acompte facturé, 7 000 avec 30 % facturé)', () => {
  const prevu = { kind: 'acompte', pct: 30 }, facture = { kind: 'acompte', pct: 30, invoice_number: 'F-AB-1' };
  assert.equal(acomptesFactures([prevu], 10000), 0);
  assert.equal(montantAttendu({ kind: 'solde', pct: 70 }, 10000, acomptesFactures([prevu], 10000)), 10000);
  assert.equal(montantAttendu({ kind: 'solde', pct: 70 }, 10000, acomptesFactures([facture], 10000)), 7000);
  assert.equal(montantAttendu({ kind: 'solde', amount: 3600 }, 4500, 900), 3600);   // montant saisi : il fait foi
  assert.equal(montantAttendu({ kind: 'acompte', pct: 20 }, 4500, 0), 900);
  assert.equal(montantAttendu({ kind: 'solde' }, 1000, 1500), 0);                   // jamais négatif
});
t('facture émise : même définition que l’application', () => {
  assert.equal(emise({ kind: 'acompte' }), false);
  assert.equal(emise({ kind: 'acompte', invoice_number: '  ' }), false);
  for (const f of ['sent_at', 'paid_at', 'invoice_number', 'pennylane_id']) assert.equal(emise({ kind: 'acompte', [f]: 'x' }), true, f);
});

let ko = 0;
for (const [nom, f] of cas) { try { f(); } catch (e) { ko++; console.error('✗ ' + nom + '\n  ' + e.message); } }
console.log(`Règles Pennylane (fausses données) : ${cas.length - ko}/${cas.length} réussies.`);
if (ko) process.exit(1);
