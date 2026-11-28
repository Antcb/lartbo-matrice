// v1.72 — L3 « Annuler la date » : règles de calcul (js/annulation-regles.js), données FICTIVES (Lune Ardente, cession 4 000 € HT,
// acompte 30 % = 1 200 € HT facturé et encaissé, solde 2 800 € HT non émis). Même calcul côté base : essai SQL v1.72.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// js/utils.js (r2, fonction officielle) ne se charge pas hors du navigateur : seule son arrondi au centime est repris pour l'essai
const src = readFileSync(new URL('../../js/annulation-regles.js', import.meta.url), 'utf8')
  .replace("import { r2 } from './utils.js';", "const r2 = n => Math.round((Number(n) || 0) * 100) / 100;");
const { planAnnulation, regimeAnnulation, relanceImpaye, operationsAnnulation, suiviRegularisation } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

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
// (v1.72.3) qui doit payer qui — TVA 5,5 % ; acompte 1 200 € HT = 1 266 € TTC
const ops = x => operationsAnnulation({ regime: 'cession', tva: 5.5, ...x });
const type = (l, t) => l.find(o => o.type === t);
// l'artiste annule, acompte encaissé restitué intégralement, commission versée → non due
let o = ops({ du: 0, factureNetHt: 1200, factureNetTtc: 1266, encaisseHt: 1200, encaisseTtc: 1266, resteAFacturerHt: 0, commission: { existe: true, statut: 'non_due', montant: 180, versee: true, verse: 180 } });
ok(!type(o, 'facture') && !type(o, 'paiement') && type(o, 'avoir').ht === 1200 && type(o, 'avoir').ttc === 1266, 'artiste : avoir 1 200 € HT / 1 266 € TTC, rien à facturer ni à payer');
ok(type(o, 'remboursement').ttc === 1266 && type(o, 'remboursement').de === 'artbo' && type(o, 'remboursement').vers === 'organisateur', 'artiste : remboursement 1 266 € TTC de L’ArtBoristerie à l’organisateur');
ok(type(o, 'commission').statut === 'a_regulariser', 'commission non due déjà versée : à régulariser');
// acompte facturé jamais encaissé : avoir, aucun remboursement
o = ops({ du: 0, factureNetHt: 1200, factureNetTtc: 1266, encaisseTtc: 0, resteAFacturerHt: 0, commission: { existe: true, statut: 'non_due', montant: 180 } });
ok(type(o, 'avoir').ttc === 1266 && !type(o, 'remboursement') && !type(o, 'paiement'), 'jamais encaissé : avoir sans remboursement');
ok(type(o, 'commission').statut === 'non_due', 'commission non due, ni facturée ni versée : rien à verser');
// 2 000 € dus, 1 266 € encaissés : facture de 800 € HT (844 € TTC), paiement attendu 844 € TTC
o = ops({ du: 2000, factureNetHt: 1200, factureNetTtc: 1266, encaisseHt: 1200, encaisseTtc: 1266, resteAFacturerHt: 800, commission: { existe: true, statut: 'a_revoir', montant: 600 } });
ok(type(o, 'facture').ttc === 844 && type(o, 'paiement').ttc === 844 && type(o, 'paiement').de === 'organisateur' && !type(o, 'avoir') && !type(o, 'remboursement'), 'facture 800 € HT et paiement attendu 844 € TTC');
ok(type(o, 'commission').statut === 'a_revoir', 'commission à revoir');
// remboursement déjà saisi en partie ; booking : commission seule
o = ops({ du: 0, factureNetHt: 1200, factureNetTtc: 1266, encaisseHt: 1200, encaisseTtc: 1266, rembourseSaisiTtc: 266 });
ok(type(o, 'remboursement').saisi === 266 && type(o, 'remboursement').aSaisir === 1000, 'remboursement : déjà saisi / reste à saisir');
// relecture B1 : TVA d'une ligne ≠ TVA de la date — rien n'est dû de part et d'autre : aucune opération inventée ; écart réel : HT seul
o = ops({ du: 1000, tvaUniforme: false, factureNetHt: 1000, factureNetTtc: 1200, encaisseHt: 1000, encaisseTtc: 1200 });
ok(o.length === 0, 'TVA mixte, 1 000 € dus = facturé = encaissé : aucune opération (ni avoir, ni remboursement, ni paiement)');
o = operationsAnnulation({ regime: 'cession', tva: 20, du: 1000, tvaUniforme: false, factureNetHt: 1000, factureNetTtc: 1055, encaisseHt: 1000, encaisseTtc: 1055 });
ok(o.length === 0, 'TVA mixte (ligne 5,5 %, date 20 %) : aucun paiement attendu inventé');
o = ops({ du: 0, tvaUniforme: false, factureNetHt: 1000, factureNetTtc: 1200, encaisseHt: 1000, encaisseTtc: 1200, rembourseSaisiTtc: 200 });
ok(type(o, 'avoir').ht === 1000 && type(o, 'avoir').ttc === null && type(o, 'remboursement').ht === 1000 && type(o, 'remboursement').ttc === null && type(o, 'remboursement').aSaisir === null,
  'TVA mixte, 0 € dus : avoir et remboursement en HT, TTC « à vérifier » (null)');
o = operationsAnnulation({ regime: 'booking', du: null, tva: 20, commission: { existe: true, statut: 'non_due', montant: 600, facturee: true } });
ok(o.length === 1 && o[0].type === 'commission' && o[0].statut === 'a_regulariser', 'booking : commission seule, non due déjà facturée → à régulariser');
// (v1.73, L4) suivi des régularisations — mêmes figures que l'essai SQL v1.73 (annulation_suivi)
const sv = x => suiviRegularisation({ regime: 'cession', tva: 5.5, factureEmise: true, commission: { existe: true, statut: 'non_due' }, ...x });
const codes = r => r.blocages.map(b => b.code).sort().join();
// A : l'artiste annule, 0 € dus, acompte 1 200 € HT encaissé (1 266 € TTC)
let v = sv({ du: 0, factureBrutHt: 1200, encaisseHt: 1200, encaisseTtc: 1266 });
ok(v.avoir.reste === 1200 && v.remboursement.resteTtc === 1266 && codes(v) === 'avenant,avoir,remboursement', 'A : avoir 1 200 € HT, 1 266 € TTC à rembourser, avenant manquant');
v = sv({ du: 0, factureBrutHt: 1200, avoirsHt: 1200, encaisseHt: 1200, encaisseTtc: 1266, rembourseAFaireTtc: 1266 });
ok(v.avoir.reste === 0 && v.avoir.fait === 1200 && v.remboursement.resteTtc === 1266 && v.remboursement.faitTtc === 0 && v.remboursement.aFaireTtc === 1266,
  'A : avoir rattaché ≠ remboursement ; « à faire » non compté');
v = sv({ du: 0, factureBrutHt: 1200, avoirsHt: 1200, encaisseHt: 252.13, encaisseTtc: 266, rembourseFaitTtc: 1000 });
ok(v.remboursement.resteTtc === 266 && v.remboursement.prevuTtc === 1266 && v.remboursement.faitTtc === 1000, 'A : remboursement partiel → reste 266 € TTC');
v = sv({ du: 0, factureBrutHt: 1200, avoirsHt: 1200, encaisseHt: 0, encaisseTtc: 0, rembourseFaitTtc: 1266, avenant: { signe: true, lien: 'https://exemple.test/a' } });
ok(v.pret && !v.blocages.length, 'A : tout réglé, avenant, commission non due jamais versée → prêt à clôturer');
ok(!sv({ du: 0, factureBrutHt: 1200, avoirsHt: 1200, rembourseFaitTtc: 1266, avenant: { signe: true, lien: ' ' } }).pret, 'avenant coché sans lien : non prêt');
// A' : commission
ok(codes(sv({ du: 0, commission: { existe: true, statut: 'non_due', versee: true }, factureEmise: false })) === 'commission', "A' : non due déjà versée → bloque");
ok(codes(sv({ du: 0, commission: { existe: true, statut: 'a_revoir' }, factureEmise: false })) === 'commission', "A' : à revoir → bloque");
ok(sv({ du: 0, commission: { existe: false }, factureEmise: false }).pret, 'sans commission : rien ne bloque de ce côté');
// B : jamais encaissé : avoir, aucun remboursement
v = sv({ du: 0, factureBrutHt: 1200 });
ok(codes(v) === 'avenant,avoir' && v.remboursement.resteTtc === 0, 'B : avoir à émettre, aucun remboursement');
// C : maintien partiel 2 000 €
v = sv({ du: 2000, factureBrutHt: 1200, encaisseHt: 1200, encaisseTtc: 1266, avenant: { signe: true, lien: 'x' } });
ok(v.facturation.reste === 800 && v.encaissement.resteTtc === 844 && codes(v) === 'encaissement,facturation', 'C : 800 € HT à facturer, 844 € TTC à encaisser');
v = sv({ du: 2000, factureBrutHt: 2000, encaisseHt: 1579.15, encaisseTtc: 1666, avenant: { signe: true, lien: 'x' } });
ok(v.encaissement.resteTtc === 444 && codes(v) === 'encaissement', 'C : encaissement partiel → reste 444 € TTC');
// D, E : avoir partiel ; avoir à rattacher
v = sv({ du: 0, factureBrutHt: 1200, avoirsHt: 600, encaisseHt: 1200, encaisseTtc: 1266, avoirsARattacher: 1 });
ok(v.avoir.reste === 600 && v.blocages.some(b => b.code === 'a_rattacher'), 'D/E : avoir partiel → 600 € restent ; avoir « à rattacher » bloque');
// F : TVA mixte : pas de montant TTC de remboursement
v = sv({ du: 0, tvaUniforme: false, factureBrutHt: 4000, encaisseHt: 1200, encaisseTtc: 1266 });
ok(v.remboursement.resteTtc === null && v.remboursement.resteHt === 1200 && v.blocages.find(b => b.code === 'remboursement').motif === 'Remboursement à faire : TTC à vérifier', 'F : TVA mixte → TTC à vérifier, aucun montant proposé');
// G : dispense ; H : booking
v = sv({ du: 0, factureEmise: false });
ok(v.pret && v.avenantDispense, 'G : sans frais, aucune facture émise → avenant dispensé, prêt');
ok(!suiviRegularisation({ regime: 'booking', du: null }).pret && suiviRegularisation({ regime: 'booking', du: null }).blocages[0].code === 'regime', 'H : booking non clôturable en L4');
// tolérance d'un centime
ok(sv({ du: 1000, factureBrutHt: 1000, encaisseHt: 1000, encaisseTtc: 1054.99, factureEmise: true, avenant: { signe: true, lien: 'x' } }).pret, 'écart d’un centime toléré');
console.log(`annulation-regles : ${n}/${n} conformes`);
