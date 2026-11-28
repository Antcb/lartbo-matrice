/**
 * (v1.72, L3 du point 02 — décisions d'Anthony du 28/11/2026, 12 h 08) Règles de l'annulation d'une date engagée, sans état ni
 * réseau : testées par tests/static/annulation-regles.mjs (données fictives). Même calcul côté base : supabase/migrations/
 * 2026-11-28_v1.72_annulation.sql (annulation_regime, annulation_appliquer, annulation_relance_impaye).
 *  - Factures émises et paiements : jamais modifiés.
 *  - Montant total dû après annulation (HT, acompte compris ; 0 = sans frais) : ce qui reste à facturer = montant dû − facturé net
 *    après avoirs. Il va sur le solde non émis (sinon la première ligne non émise) ; les autres lignes non émises — ou toutes si rien
 *    ne reste — « ne doivent plus être émises » (montant 0, gardées visibles). Montant initial gardé dans la fiche.
 *  - Aucun avoir, aucun remboursement créé : facturé au-delà, encaissé au-delà et reste sans ligne sont seulement « À régulariser ».
 */
import { r2 } from './utils.js';

/** Régime d'une date annulée : booking (commission seule), coproduction et coréalisation (sans calcul, L8), sinon cession */
export const regimeAnnulation = s => (s?.prod_mode || 'production') === 'booking' ? 'booking'
  : s?.contract_type === 'Co-Production' ? 'coprod' : s?.contract_type === 'Co-Réalisation' ? 'corea' : 'cession';
export const REGIME_LABEL = {cession: 'Cession', booking: 'Booking (commission seule)', coprod: 'Coproduction', corea: 'Coréalisation'};

/**
 * Plan d'annulation d'une cession. lignes : [{id, kind (acompte | solde | autre), sort, emise, montant (HT du moment), avoir (HT couvert)}].
 * Renvoie le facturé net, ce qui reste à facturer, le dépassement (facturé au-delà du montant dû → avoir à émettre), la ligne qui
 * porte le reste et le plan des lignes non émises [{id, initial, nouveau, etat: 'recalculee' | 'abandonnee'}].
 */
export function planAnnulation({du, lignes}){
  const ls = (lignes || []).filter(l => ['acompte', 'solde', 'autre'].includes(l.kind));
  const factureNet = r2(ls.filter(l => l.emise).reduce((t, l) => t + Math.max(0, (Number(l.montant) || 0) - Math.min(Number(l.avoir) || 0, Math.max(0, Number(l.montant) || 0))), 0));
  const d = r2(du), resteAFacturer = Math.max(0, r2(d - factureNet)), depassement = Math.max(0, r2(factureNet - d));
  const ordre = (a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.id).localeCompare(String(b.id));
  const nonEmises = ls.filter(l => !l.emise).sort(ordre);
  const cible = (nonEmises.find(l => l.kind === 'solde') || nonEmises[0] || null)?.id ?? null;
  const plan = nonEmises.map(l => { const nouveau = l.id === cible ? resteAFacturer : 0;
    return {id: l.id, kind: l.kind, initial: r2(l.montant), nouveau, etat: nouveau > 0 ? 'recalculee' : 'abandonnee'}; });
  return {du: d, factureNet, resteAFacturer, depassement, cible, plan, resteSansLigne: cible ? 0 : resteAFacturer};
}

/** Relance d'impayé d'une date annulée (décision 6) : gardée seulement si le montant réclamé (restes dus HT des factures relancées) ne
 *  dépasse pas ce qui reste dû après annulation (montant dû − encaissé HT). Booking, coproduction, coréalisation : jamais (à revoir). */
export function relanceImpaye({regime, du, encaisseHt, reclameHt}){
  if (regime !== 'cession' || du == null) return {garde: false, encore: null};
  const encore = Math.max(0, r2(Number(du) - (Number(encaisseHt) || 0)));
  return {garde: r2(reclameHt) <= encore + 0.01, encore};
}
