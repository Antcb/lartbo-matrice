// Règles métier de la synchronisation Pennylane (lot C1, décisions d'Anthony du 26/10/2026), sans réseau ni base :
// testées par tests/static/pennylane-regles.mjs (fausses données). Même règle côté application : js/calc.js.
//  - Booking : L'ArtBo n'est qu'agent. Seule sa facture de commission (kind « artbo ») est suivie ; les acomptes / soldes sont
//    les factures de l'artiste à l'organisateur : jamais reliés, jamais marqués payés depuis Pennylane.
//  - Production : la commission n'est pas une facture (L'ArtBo se la verse) : jamais reliée ni marquée payée depuis Pennylane.
//  - Production : solde attendu = cession − acomptes effectivement facturés (comme Pennylane, qui déduit les acomptes facturés).

export type Ligne = {
  id?: string; show_id?: string; kind: string; amount?: number | string | null; pct?: number | string | null;
  sent_at?: string | null; paid_at?: string | null; invoice_number?: string | null; pennylane_id?: string | null;
};

const plein = (v: unknown) => v != null && String(v).trim() !== '';
export const isBooking = (mode: string | null | undefined) => mode === 'booking';
/** Facture émise : envoyée, payée, numérotée ou liée à Pennylane (même définition que js/calc.js isInvoiced) */
export const emise = (p: Ligne) => !!(p.sent_at || p.paid_at || plein(p.invoice_number) || plein(p.pennylane_id));
/** Ligne dont le paiement (et le numéro / le lien) se reprend de Pennylane */
export const payable = (p: Ligne, mode: string | null | undefined) =>
  isBooking(mode) ? p.kind === 'artbo' : ['acompte', 'solde', 'autre'].includes(p.kind);
/** PDF de la facture rangé automatiquement dans le Drive (compta + dossier de la date) : comme avant le lot C1, acomptes / soldes /
 *  autres lignes ; la commission booking, dont seul le paiement est repris (lot C1), n'est pas rangée (non demandé) */
export const rangeeDansLeDrive = (p: Ligne) => p.kind !== 'artbo';
/** Ligne qui peut être reliée à une facture faite depuis le devis Pennylane : acompte ou solde de production */
export const relieAuDevis = (p: Ligne, mode: string | null | undefined) => !isBooking(mode) && ['acompte', 'solde'].includes(p.kind);
/** Acompte caduc : jamais facturé alors que le solde de la date l'est (plus réclamé ; jamais relié automatiquement) */
export const caduc = (p: Ligne, lignesDeLaDate: Ligne[]) => p.kind === 'acompte' && !emise(p) && lignesDeLaDate.some(l => l.kind === 'solde' && emise(l));
/** Ligne pour laquelle la Matrice peut créer un brouillon de facture isolée */
export const factureIsolee = (p: Ligne, mode: string | null | undefined) => isBooking(mode) ? p.kind === 'artbo' : p.kind === 'autre';

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Montant HT prévu d'un acompte (saisi, ou % × cachet) */
export const montantAcompte = (p: Ligne, fee: number) =>
  plein(p.amount) ? Number(p.amount) : plein(p.pct) ? Math.round(fee * Number(p.pct)) / 100 : null;
/** Total HT des acomptes effectivement facturés d'une date */
export const acomptesFactures = (lignes: Ligne[], fee: number) =>
  r2(lignes.filter(p => p.kind === 'acompte' && emise(p)).reduce((t, p) => t + (montantAcompte(p, fee) || 0), 0));
/** Montant HT attendu dans Pennylane pour une ligne pas encore reliée : acompte prévu ; solde = cession − acomptes facturés */
export function montantAttendu(p: Ligne, fee: number, dejaFactures: number): number | null {
  if (plein(p.amount)) return Number(p.amount);
  if (p.kind === 'solde') return Math.max(0, r2(fee - dejaFactures));
  return montantAcompte(p, fee);
}
