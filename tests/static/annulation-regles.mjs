// v1.72 — L3 « Annuler la date » : règles de calcul (js/annulation-regles.js), données FICTIVES (Lune Ardente, cession 4 000 € HT,
// acompte 30 % = 1 200 € HT facturé et encaissé, solde 2 800 € HT non émis). Même calcul côté base : essai SQL v1.72.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// js/utils.js (r2, fonction officielle) ne se charge pas hors du navigateur : seule son arrondi au centime est repris pour l'essai
const src = readFileSync(new URL('../../js/annulation-regles.js', import.meta.url), 'utf8')
  .replace("import { r2 } from './utils.js';", "const r2 = n => Math.round((Number(n) || 0) * 100) / 100;");
const { planAnnulation, regimeAnnulation, relanceImpaye } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const lignes = (soldeEmis = false) => [
  { id: 'a', kind: 'acompte', sort: 1, emise: true, montant: 1200, avoir: 0 },
  { id: 's', kind: 'solde', sort: 2, emise: soldeEmis, montant: 2800, avoir: 0 },
];

// variante 1 : 2 000 € HT dus au total → 800 € HT à facturer, sur le solde
let p = planAnnulation({ du: 2000, lignes: lignes() });
ok(p.factureNet === 1200 && p.resteAFacturer === 800 && p.depassement === 0 && p.cible === 's', 'variante 1 : 800 € HT à facturer sur le solde');
ok(p.plan.length === 1 && p.plan[0].initial === 2800 && p.plan[0].nouveau === 800 && p.plan[0].etat === 'recalculee', 'variante 1 : montant initial 2 800 € gardé, 800 € à émettre');
// variante 2 : 1 200 € dus → rien à facturer, le solde ne doit plus être émis
p = planAnnulation({ du: 1200, lignes: lignes() });
ok(p.resteAFacturer === 0 && p.plan[0].etat === 'abandonnee' && p.plan[0].nouveau === 0, 'variante 2 : solde « ne doit plus être émis »');
// variante 3 : sans frais → dépassement de 1 200 € (avoir à émettre, rien créé)
p = planAnnulation({ du: 0, lignes: lignes() });
ok(p.resteAFacturer === 0 && p.depassement === 1200 && p.plan[0].etat === 'abandonnee', 'variante 3 : facturé au-delà de 1 200 € à régulariser');
// facture émise au-delà du montant retenu : solde 2 800 € émis, 2 000 € dus → 2 000 € facturés de trop ; aucune ligne à recalculer
p = planAnnulation({ du: 2000, lignes: lignes(true) });
ok(p.factureNet === 4000 && p.depassement === 2000 && p.plan.length === 0 && p.cible === null, 'au-delà : facturé net 4 000 €, dépassement 2 000 €, rien recalculé');
// avoir déjà rattaché : le facturé net le déduit
p = planAnnulation({ du: 2000, lignes: [{ id: 'a', kind: 'acompte', sort: 1, emise: true, montant: 1200, avoir: 1200 }, { id: 's', kind: 'solde', sort: 2, emise: false, montant: 2800, avoir: 0 }] });
ok(p.factureNet === 0 && p.resteAFacturer === 2000 && p.plan[0].nouveau === 2000, 'avoir déduit du facturé net');
// plusieurs lignes non émises : le reste va au solde, les autres ne doivent plus être émises
p = planAnnulation({ du: 2000, lignes: [...lignes(), { id: 'b', kind: 'acompte', sort: 1.5, emise: false, montant: 400, avoir: 0 }, { id: 'x', kind: 'autre', sort: 3, emise: false, montant: 100, avoir: 0 }] });
ok(p.plan.find(l => l.id === 's').nouveau === 800 && p.plan.filter(l => l.etat === 'abandonnee').map(l => l.id).sort().join() === 'b,x', 'reste sur le solde, autres lignes abandonnées');
// pas de solde non émis : la première ligne non émise porte le reste ; aucune : reste sans ligne
p = planAnnulation({ du: 2000, lignes: [{ id: 'a', kind: 'acompte', sort: 1, emise: true, montant: 1200, avoir: 0 }, { id: 'b', kind: 'acompte', sort: 2, emise: false, montant: 400, avoir: 0 }] });
ok(p.cible === 'b' && p.plan[0].nouveau === 800, 'sans solde : la première ligne non émise porte le reste');
p = planAnnulation({ du: 2000, lignes: [{ id: 'a', kind: 'acompte', sort: 1, emise: true, montant: 1200, avoir: 0 }] });
ok(p.cible === null && p.resteSansLigne === 800, 'aucune ligne non émise : 800 € à régulariser sans ligne');
// commission et parts : jamais dans le calcul
p = planAnnulation({ du: 2000, lignes: [...lignes(), { id: 'c', kind: 'artbo', sort: 3, emise: false, montant: 600, avoir: 0 }] });
ok(!p.plan.some(l => l.id === 'c'), 'commission jamais recalculée ni abandonnée');

// régime
ok(regimeAnnulation({ prod_mode: 'booking' }) === 'booking' && regimeAnnulation({ contract_type: 'Co-Production' }) === 'coprod'
  && regimeAnnulation({ contract_type: 'Co-Réalisation' }) === 'corea' && regimeAnnulation({ contract_type: 'Cession' }) === 'cession' && regimeAnnulation({}) === 'cession', 'régimes');

// relance d'impayé (décision 6)
ok(relanceImpaye({ regime: 'cession', du: 2000, encaisseHt: 1200, reclameHt: 800 }).garde === true, 'réclamé = encore dû : relance gardée');
ok(relanceImpaye({ regime: 'cession', du: 2000, encaisseHt: 1200, reclameHt: 2800 }).garde === false, 'réclamé au-delà : relance suspendue');
ok(relanceImpaye({ regime: 'cession', du: 0, encaisseHt: 1200, reclameHt: 0 }).garde === true, 'rien de réclamé : rien à suspendre');
ok(relanceImpaye({ regime: 'booking', du: null, encaisseHt: 0, reclameHt: 600 }).garde === false, 'booking : commission à revoir, relance suspendue');
ok(relanceImpaye({ regime: 'cession', du: 4000, encaisseHt: 1200, reclameHt: 2800.005 }).garde === true, 'tolérance d’un centime');
console.log(`annulation-regles : ${n}/${n} conformes`);
