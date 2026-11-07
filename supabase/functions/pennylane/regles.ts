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
/** Facture émise : envoyée, payée, numérotée ou liée à Pennylane (même définition que js/calc.js isInvoiced, hors commission de
 *  production : l'application ne la traite pas comme une facture, et cette fonction ne la facture jamais — factureIsolee) */
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
/** Acompte ou solde relié depuis le devis : son montant est figé sur celui de la facture Pennylane (le montant réel de la
 *  facture fait référence — décision d'Anthony du 26/10, lot D1) QUE s'il n'est pas déjà émis (envoyé / payé / numéroté / lié)
 *  et sans montant saisi — une ligne émise ne change jamais de montant (A1, relecture C1). Sans cela, la base figerait le
 *  calcul de la Matrice (rapprochement à 0,05 € près). Facture groupée (plusieurs dates) : jamais reliée (montant ≠ une ligne). */
export const figerMontant = (p: Ligne) => ['acompte', 'solde'].includes(p.kind) && !plein(p.amount) && !emise(p);
/** Ligne pour laquelle la Matrice peut créer un brouillon de facture isolée */
export const factureIsolee = (p: Ligne, mode: string | null | undefined) => isBooking(mode) ? p.kind === 'artbo' : p.kind === 'autre';

/** % de commission d'une ligne (§6.3, v1.46) : % de la ligne > % de la date > défaut (% de l'artiste, sinon Réglages selon le mode
 *  de la date : fonction SQL default_commission_pct) ; null si aucun n'est connu — jamais de 15 ni de 0 en dur.
 *  Même règle côté application : js/calc.js payAmount, js/selectors.js showCommissionPct. */
export const pctCommission = (linePct: unknown, showPct: unknown, defaut: unknown): number | null =>
  plein(linePct) ? Number(linePct) : plein(showPct) ? Number(showPct) : plein(defaut) ? Number(defaut) : null;

/** Base de la commission (v1.51, décision d'Anthony du 27/10/2026) : cachet HT ; en coréalisation, MG + part du résultat VALIDÉE
 *  (shows.corea_share) — rémunération brute de l'artiste. Même règle : application (commissionBase), base (payment_amount_for). */
export const baseCommission = (s: { fee_ht?: unknown; contract_type?: unknown; corea_share?: unknown }): number =>
  (Number(s?.fee_ht) || 0) + (s?.contract_type === 'Co-Réalisation' && plein(s?.corea_share) ? Number(s.corea_share) : 0);

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

/**
 * Solde douteux (Monestier, 06/11/2026) : la facture Pennylane faite depuis le devis a le montant d'un acompte de la date DÉJÀ
 * compté comme facturé dans la Matrice sans être relié à Pennylane (numéro, envoi ou paiement noté à la main). Elle peut être cet
 * acompte : elle n'est jamais reliée automatiquement au solde — signalée « à rattacher » (le choix revient à l'utilisateur).
 */
export const soldeDouteux = (p: Ligne, montantFacture: number, lignesDeLaDate: Ligne[], fee: number) =>
  p.kind === 'solde' && lignesDeLaDate.some(a => a.kind === 'acompte' && emise(a) && !plein(a.pennylane_id)
    && Math.abs((montantAcompte(a, fee) ?? -1) - Number(montantFacture)) < 0.05);

/** Date d'un concert au format JJ/MM/AAAA (AAAA-MM-JJ reçu tel quel, sans fuseau) */
export const frDate = (d: string | null | undefined) => d ? String(d).split('-').reverse().join('/') : '';

/** Code du lieu entre parenthèses : département de la date (2 chiffres : même règle que « {{cp}} », v1.17.0 ; nomenclature v1.15.2) ;
 *  sinon tiré de son code postal (2A / 2B en Corse, 971… outre-mer) — même règle que js/contract.js deptOf. */
export function codeLieu(s: { department?: unknown; postal_code?: unknown }): string {
  const d = String(s?.department ?? '').trim();
  if (d) return /^\d$/.test(d) ? '0' + d : d.toUpperCase();
  const cp = String(s?.postal_code ?? '').replace(/\s/g, '');
  if (!/^\d{5}$/.test(cp)) return '';
  return /^9[78]/.test(cp) ? cp.slice(0, 3) : /^20/.test(cp) ? (Number(cp) < 20200 ? '2A' : '2B') : cp.slice(0, 2);
}

/** « 12/03/2027 • Bagnols-sur-Cèze (30) • LA MOBA » : date, ville (code), lieu réel de la date — devis, factures de cession et
 *  de commission (v1.60.2 : la commission reprend le même format, lieu et code compris) */
export function describe(s: { date?: string | null; city?: string | null; venue?: string | null; department?: unknown; postal_code?: unknown }) {
  const cp = codeLieu(s);
  return [frDate(s.date), s.city ? s.city + (cp ? ` (${cp})` : '') : '', s.venue].filter(Boolean).join(' • ');
}

/** Textes d'une NOUVELLE facture de commission booking (v1.60.2) : description de la facture et de sa ligne, lieu réel et code
 *  compris. Une facture déjà émise n'est jamais refaite (emise) : ces textes ne touchent aucun document Pennylane existant. */
export function texteCommission(s: Parameters<typeof describe>[0], artist: string) {
  const lieu = [s.city ? s.city + (codeLieu(s) ? ` (${codeLieu(s)})` : '') : '', s.venue].filter(Boolean).join(' • ');
  return {
    description: ['Commission booking', describe(s)].filter(Boolean).join(' • '),
    ligne: `Commission booking pour ${artist} • Concert le ${frDate(s.date)}${lieu ? ' • ' + lieu : ''}`,
  };
}
