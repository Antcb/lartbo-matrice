// Règles métier de la synchronisation Pennylane (lot C1, décisions d'Anthony du 26/10/2026), sans réseau ni base :
// testées par tests/static/pennylane-regles.mjs (fausses données). Même règle côté application : js/calc.js.
//  - Booking : L'ArtBo n'est qu'agent. Seule sa facture de commission (kind « artbo ») est suivie ; les acomptes / soldes sont
//    les factures de l'artiste à l'organisateur : jamais reliés, jamais marqués payés depuis Pennylane.
//  - Production : la commission n'est pas une facture (L'ArtBo se la verse) : jamais reliée ni marquée payée depuis Pennylane.
//  - Production : solde attendu = cession − TOUS les acomptes de la date, prévus et facturés (décision d'Anthony du 10/11/2026, qui
//    remplace « cession − acomptes effectivement facturés » du lot C1). Plus d'acompte « caduc » : un acompte non facturé reste dû
//    et se relie normalement, même après le solde.

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
/** Total HT de TOUS les acomptes d'une date, prévus et facturés (lignes hors calcul exclues par l'appelant) — décision du 10/11/2026.
 *  Même règle : js/calc.js soldeDue, base payment_amount_for (migration v1.61.1). */
export const acomptesDeLaDate = (lignes: Ligne[], fee: number) =>
  r2(lignes.filter(p => p.kind === 'acompte').reduce((t, p) => t + (montantAcompte(p, fee) || 0), 0));
/** Montant HT attendu dans Pennylane pour une ligne pas encore reliée : acompte prévu ; solde = cession − acomptes de la date */
export function montantAttendu(p: Ligne, fee: number, acomptes: number): number | null {
  if (plein(p.amount)) return Number(p.amount);
  if (p.kind === 'solde') return Math.max(0, r2(fee - acomptes));
  return montantAcompte(p, fee);
}

/**
 * (Inchangé le 10/11/2026 : seul un acompte ÉMIS à la main est concerné ; un acompte prévu, lui, est une ligne candidate comme le
 * solde — deux lignes du même montant ne sont jamais reliées seules, « à choisir ».)
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

// v1.64 (décision d'Anthony du 09/11) : délai de paiement des brouillons de facture (14 j par défaut) et validité des devis (30 j par
// défaut) réglables dans la Matrice (Réglages › Délais et automatismes), pour les NOUVEAUX documents seulement. Valeur lisible =
// entier (5 ou 5.0) dans les bornes ; sinon la valeur par défaut. Même contrôle que js/reminders.js taskDelay et la contrainte
// reglage_simple_ok (supabase/migrations/2026-11-09_v1.64_delais.sql).
export const DELAIS_DOCUMENTS = { pennylane_payment_days: { defaut: 14, min: 0, max: 365 }, pennylane_quote_days: { defaut: 30, min: 1, max: 365 } } as const;
export function delaiDocument(cle: keyof typeof DELAIS_DOCUMENTS, valeur: unknown): number {
  const r = DELAIS_DOCUMENTS[cle];
  return typeof valeur === 'number' && Number.isInteger(valeur) && valeur >= r.min && valeur <= r.max ? valeur : r.defaut;
}

// ── Avoirs (L1, point 02 — décisions d'Anthony du 26/11/2026, D7) ─────────────────────────────────────────────────────────────
// Anthony crée les avoirs dans Pennylane ; MATRICE les importe et les affiche (table pennylane_avoirs), sans doublon (clé =
// identifiant Pennylane de l'avoir), rattachés à la ligne dont la facture d'ORIGINE a cet identifiant Pennylane — jamais sur un
// montant, un client ou un numéro. Lien ambigu (origine non indiquée, absente de MATRICE, ou reliée à plusieurs lignes) : « À
// rattacher ». Un avoir ne crée JAMAIS d'encaissement ni de remboursement. Même règle côté application : js/calc.js (avoirsOf,
// avoirCouvert, resteDu, soldeeParAvoir) et base (pennylane_avoirs, avoir_couvert, reminder_candidates — migration v1.69).

type DocPl = { id?: unknown; credit_note?: unknown; document_type?: unknown; credited_invoice?: unknown; credited_invoice_id?: unknown;
  currency_amount_before_tax?: unknown; amount?: unknown; currency_amount?: unknown; paid?: unknown; status?: unknown; draft?: unknown };

/** Identifiant Pennylane de la facture d'origine d'un avoir, ou null. Forme du champ de l'API v2 NON VÉRIFIÉE sur un avoir réel
 *  (objet { id, … } attendu ; l'ancien champ credited_invoice_id, retiré le 06/06/2025, est encore accepté). */
export function origineAvoir(x: DocPl): string | null {
  const c = x?.credited_invoice as any;
  const id = c && typeof c === 'object' ? c.id : c ?? x?.credited_invoice_id;
  // seulement un identifiant (texte ou nombre) : true / false / objet sans id → origine inconnue (relecture v1.69)
  return (typeof id === 'string' || typeof id === 'number') && plein(id) ? String(id) : null;
}
/** Document Pennylane qui est un avoir : marqué comme tel, lié à une facture d'origine, ou de montant HT négatif */
export const estAvoir = (x: DocPl) => !!x && (x.credit_note === true || x.document_type === 'credit_note' || origineAvoir(x) != null
  || Number(x.currency_amount_before_tax) < 0);
/** Montant couvert par un avoir (HT, positif) — le signe renvoyé par Pennylane n'a pas d'importance */
export const montantAvoir = (x: DocPl) => r2(Math.abs(Number(x.currency_amount_before_tax) || 0));

export type LigneAvoir = { id: string; show_id: string; pennylane_id?: string | null; invoice_number?: string | null };
export type Rattachement = { etat: 'rattache'; payment_id: string; show_id: string; reason: null }
  | { etat: 'a_rattacher'; payment_id: null; show_id: string | null; reason: string };

/** Rattachement d'un avoir : à LA ligne dont pennylane_id = identifiant de la facture d'origine, sinon « À rattacher » (motif) */
export function rattacherAvoir(origine: string | null, lignes: LigneAvoir[], numeroOrigine?: string | null): Rattachement {
  const ref = numeroOrigine ? ` (${numeroOrigine})` : '';
  if (!origine) return { etat: 'a_rattacher', payment_id: null, show_id: null, reason: 'Pennylane n’indique pas la facture d’origine de cet avoir' };
  const ls = lignes.filter(l => String(l.pennylane_id ?? '') === origine);
  if (ls.length === 1) return { etat: 'rattache', payment_id: ls[0].id, show_id: ls[0].show_id, reason: null };
  if (!ls.length) return { etat: 'a_rattacher', payment_id: null, show_id: null, reason: `Facture d’origine${ref} reliée à aucune ligne de MATRICE` };
  const dates = [...new Set(ls.map(l => l.show_id))];
  return { etat: 'a_rattacher', payment_id: null, show_id: dates.length === 1 ? dates[0] : null, reason: `Facture d’origine${ref} reliée à ${ls.length} lignes : à choisir` };
}

export type AvoirExistant = { etat: string; payment_id: string | null; show_id: string | null; rattache_origine?: string | null } | null | undefined;
/** Écart persistant (décision d'Anthony du 26/11/2026, point 3) : avoir rattaché dont Pennylane indique maintenant une AUTRE facture
 *  d'origine (ou plus aucune) que celle du rattachement. Jamais de nouveau rattachement automatique ; signalé jusqu'à résolution.
 *  Même règle côté application : js/calc.js origineEcart. */
export const origineEcart = (rattacheOrigine: unknown, origine: string | null) => plein(rattacheOrigine) && String(rattacheOrigine) !== String(origine ?? '');
/** Ligne à enregistrer pour un avoir vu dans Pennylane. Champs Pennylane toujours mis à jour ; rattachement : un avoir déjà
 *  rattaché le reste (jamais déplacé en silence, origine du rattachement gardée) ; un avoir « À rattacher » est réexaminé à chaque
 *  synchronisation. */
export function planAvoir(x: DocPl & { invoice_number?: unknown; date?: unknown; credited_invoice?: any }, existant: AvoirExistant, lignes: LigneAvoir[], vuLe: string) {
  const origine = origineAvoir(x);
  const numeroOrigine = (x.credited_invoice && typeof x.credited_invoice === 'object' && plein(x.credited_invoice.invoice_number)) ? String(x.credited_invoice.invoice_number) : null;
  const pl = { pennylane_id: String(x.id), invoice_number: plein(x.invoice_number) ? String(x.invoice_number) : null, invoice_date: plein(x.date) ? String(x.date).slice(0, 10) : null,
    amount_ht: montantAvoir(x), amount_ttc: plein(x.currency_amount ?? x.amount) && Number.isFinite(Number(x.currency_amount ?? x.amount)) ? r2(Math.abs(Number(x.currency_amount ?? x.amount))) : null,
    credited_pennylane_id: origine, credited_invoice_number: numeroOrigine, pl_status: plein(x.status) ? String(x.status) : null, last_seen_at: vuLe, gone_at: null };
  // déjà rattaché : gardé tel quel (rattache_origine non réécrite) ; écart d'origine signalé, jamais déplacé
  if (existant?.etat === 'rattache') return { ...pl, etat: 'rattache', payment_id: existant.payment_id, show_id: existant.show_id, reason: null, nouveau_rattachement: false,
    origine_changee: origineEcart(existant.rattache_origine, origine) };
  const r = rattacherAvoir(origine, lignes, numeroOrigine);
  return { ...pl, ...r, ...(r.etat === 'rattache' ? { rattache_origine: origine } : {}), nouveau_rattachement: r.etat === 'rattache', origine_changee: false };
}

// ── Encaissements repris de Pennylane (L1 ; décision d'Anthony du 26/11/2026, 17 h 21) ─────────────────────────────────────────
// Jamais sur la seule base de « paid = true », jamais sur le montant d'un avoir. Preuve = virement ENTRANT rapproché de la facture
// (matched_transactions), d'identifiant, de date et de montant établis. Un même virement n'est compté qu'une fois (identifiant
// gardé dans pennylane_virements). Paiement existant : jamais touché (l'appelant ne traite que les lignes sans date de paiement).
export type Virement = { id?: unknown; date?: unknown; amount?: unknown; currency_amount?: unknown };
const idVirement = (v: Virement) => (typeof v?.id === 'string' || typeof v?.id === 'number') && plein(v.id) ? String(v.id) : null;
const montantVirement = (v: Virement) => { const n = Number(v?.amount ?? v?.currency_amount); return plein(v?.amount ?? v?.currency_amount) && Number.isFinite(n) ? n : NaN; };
const plusRecente = (vs: Virement[]) => vs.map(v => String(v.date).slice(0, 10)).sort().pop() || null;

/** Ligne SANS avoir : il faut « paid » ET au moins un virement rapproché (date = le plus récent) pas encore compté ailleurs ;
 *  sinon rien n'est noté : « sans_transaction » (aucun virement) ou « deja_compte » (virements déjà comptés pour une autre ligne). */
export function encaissementPennylane(x: DocPl, virements: Virement[], dejaComptes: Set<string> = new Set()):
  { paid_at: string | null; ids: string[]; signal: null | 'sans_transaction' | 'deja_compte' | 'a_verifier' } {
  if (x?.paid !== true || x?.status === 'cancelled') return { paid_at: null, ids: [], signal: null };
  // virement daté ; montant connu → entrant seulement (relecture v1.69.1 : un virement sortant n'est jamais un encaissement)
  const vs = (virements || []).filter(v => plein(v?.date) && !(Number.isFinite(montantVirement(v)) && montantVirement(v) <= 0));
  if (!vs.length) return { paid_at: null, ids: [], signal: 'sans_transaction' };
  const libres = vs.filter(v => { const i = idVirement(v); return !i || !dejaComptes.has(i); });
  if (!libres.length) return { paid_at: null, ids: [], signal: 'deja_compte' };
  // (v1.69.1, demande d'Anthony du 26/11/2026 17 h 42) virements plus grands que la facture (TTC Pennylane connu) : virement groupé,
  // part de cette facture inconnue → doute, rien n'est noté, rapprochement à vérifier à la main
  const ttc = Math.abs(Number(x?.currency_amount ?? x?.amount)), somme = libres.reduce((t, v) => t + (Number.isFinite(montantVirement(v)) ? montantVirement(v) : 0), 0);
  if (plein(x?.currency_amount ?? x?.amount) && Number.isFinite(ttc) && somme > ttc + 0.01) return { paid_at: null, ids: [], signal: 'a_verifier' };
  return { paid_at: plusRecente(libres), ids: libres.map(idVirement).filter(Boolean) as string[], signal: null };
}

/** Ligne AVEC avoir(s) : comparaison sur la MÊME base (TTC Pennylane) — reste dû = TTC de la facture − TTC des avoirs ; virements
 *  ENTRANTS établis (identifiant, date, montant > 0) et pas encore comptés. Égaux au reste (à 1 centime près) → payée à la date
 *  du plus récent ; plus grands que le reste → affectation non établie (« non_etabli ») ; une partie seulement → « partiel » (paiement partiel : enregistrable en L2, rien n'est noté) ; aucun →
 *  « sans_virement » ; virement sans montant ou sans identifiant → « non_etabli » ; TTC de la facture ou d'un avoir inconnu →
 *  « non_etabli » ; reste nul → « soldee » (rien à encaisser). Facture annulée dans Pennylane : rien. */
export function encaissementAvecAvoir(x: DocPl, avoirsTtc: (number | null | undefined)[], virements: Virement[], dejaComptes: Set<string> = new Set()):
  { paid_at: string | null; ids: string[]; encaisse: number; reste: number | null; signal: null | 'soldee' | 'partiel' | 'sans_virement' | 'non_etabli' | 'deja_compte' } {
  if (x?.status === 'cancelled') return { paid_at: null, ids: [], encaisse: 0, reste: null, signal: null };
  const facture = Math.abs(Number(x?.currency_amount ?? x?.amount));
  if (!plein(x?.currency_amount ?? x?.amount) || !Number.isFinite(facture) || !avoirsTtc.length || avoirsTtc.some(a => a == null || !Number.isFinite(Number(a))))
    return { paid_at: null, ids: [], encaisse: 0, reste: null, signal: 'non_etabli' };
  const reste = r2(facture - avoirsTtc.reduce((t: number, a) => t + Math.abs(Number(a)), 0));
  if (reste <= 0.005) return { paid_at: null, ids: [], encaisse: 0, reste: 0, signal: 'soldee' };
  const vs = virements || [];
  const etablis = vs.filter(v => idVirement(v) && plein(v?.date) && montantVirement(v) > 0);
  const libres = etablis.filter(v => !dejaComptes.has(idVirement(v)!));
  const encaisse = r2(libres.reduce((t, v) => t + montantVirement(v), 0));
  // affectation non établie (relecture v1.69.1, B2) : virements PLUS grands que le reste dû (au-delà d'1 centime) — virement groupé
  // ou rapproché de plusieurs factures, dont la part pour CETTE facture est inconnue : jamais compté, rien n'est noté
  if (libres.length && encaisse > reste + 0.01) return { paid_at: null, ids: [], encaisse: 0, reste, signal: 'non_etabli' };
  if (libres.length && encaisse >= reste - 0.01) return { paid_at: plusRecente(libres), ids: libres.map(v => idVirement(v)!), encaisse, reste, signal: null };
  if (encaisse > 0) return { paid_at: null, ids: [], encaisse, reste, signal: 'partiel' };
  if (etablis.length) return { paid_at: null, ids: [], encaisse: 0, reste, signal: 'deja_compte' };
  if (vs.length) return { paid_at: null, ids: [], encaisse: 0, reste, signal: 'non_etabli' };
  return { paid_at: null, ids: [], encaisse: 0, reste, signal: 'sans_virement' };
}

// ── L2a (décisions d'Anthony du 26/11/2026, 18 h 47 : D10, E1 à E4, R1, R2) ─────────────────────────────────────────────────────
// Encaissements et remboursements RÉELS enregistrés un par mouvement (table reglements, TTC). Paiement historique (date « Payée »
// sans mouvement enregistré) : jamais réécrit ni reconstitué (E1) — l'appelant ne traite que les lignes sans date de paiement.
// R1 : un virement Pennylane ne duplique JAMAIS une saisie manuelle : rapproché de LA saisie manuelle non rapprochée du même sens et du
// même montant (à 1 centime) ; plusieurs candidates, ou une saisie manuelle de montant différent : rien n'est fait, « à vérifier ».
export type Reglement = { id: string; sens: 'encaissement' | 'remboursement'; etat: 'a_faire' | 'fait'; montant_ttc: number | string;
  date?: string | null; source: 'manuel' | 'pennylane'; transaction_id?: string | null; annule_at?: string | null };
const actif = (r: Reglement) => !r.annule_at;
/** Encaissé net d'une ligne (TTC) d'après ses mouvements enregistrés : encaissements faits − remboursements faits */
export const encaisseNet = (rs: Reglement[]) => r2(rs.filter(r => actif(r) && r.etat === 'fait')
  .reduce((t, r) => t + (r.sens === 'encaissement' ? 1 : -1) * Number(r.montant_ttc), 0));

export type PlanEncaissement = { creer: { transaction_id: string; montant: number; date: string }[]; rapprocher: { reglement_id: string; transaction_id: string }[];
  paid_at: string | null; encaisse: number; reste: number | null; signal: null | 'soldee' | 'partiel' | 'non_etabli' | 'a_verifier' | 'deja_compte' | 'sans_virement' };
/**
 * Encaissements d'une ligne SANS date de paiement, d'après les virements rapprochés de sa facture dans Pennylane (même base TTC, E2) :
 * reste dû = TTC facture − TTC avoirs ; virements ENTRANTS établis (identifiant, date, montant > 0), pas comptés pour une autre ligne.
 * Déjà enregistrés pour cette ligne : comptés, rien à faire. Nouveaux : rapprochés d'une saisie manuelle (R1) ou créés. Nouveaux
 * plus grands que ce qui reste dû (au-delà d'1 centime) : affectation non établie, rien n'est fait. Payée (paid_at = mouvement le plus
 * récent) quand l'encaissé net couvre le reste dû ; sinon encaissement partiel enregistré (signal « partiel »).
 */
export function planEncaissement(x: DocPl, avoirsTtc: (number | null | undefined)[], virements: Virement[], dejaAilleurs: Set<string>, reglements: Reglement[]): PlanEncaissement {
  const vide = (signal: PlanEncaissement['signal'], reste: number | null = null, encaisse = 0): PlanEncaissement => ({ creer: [], rapprocher: [], paid_at: null, encaisse, reste, signal });
  if (x?.status === 'cancelled') return vide(null);
  const facture = Math.abs(Number(x?.currency_amount ?? x?.amount));
  if (!plein(x?.currency_amount ?? x?.amount) || !Number.isFinite(facture) || avoirsTtc.some(a => a == null || !Number.isFinite(Number(a)))) return vide('non_etabli');
  const reste = r2(facture - avoirsTtc.reduce((t: number, a) => t + Math.abs(Number(a)), 0));
  const rs = (reglements || []).filter(actif), deja = encaisseNet(rs);
  if (reste <= 0.005) return vide('soldee', 0, deja);
  const ici = new Set(rs.map(r => r.transaction_id).filter(Boolean) as string[]);
  const etablis = (virements || []).filter(v => idVirement(v) && plein(v?.date) && montantVirement(v) > 0);
  const nouveaux = etablis.filter(v => !dejaAilleurs.has(idVirement(v)!) && !ici.has(idVirement(v)!));
  const manuels = rs.filter(r => r.source === 'manuel' && !r.transaction_id && r.sens === 'encaissement' && r.etat === 'fait');
  const creer: PlanEncaissement['creer'] = [], rapprocher: PlanEncaissement['rapprocher'] = [], pris = new Set<string>();
  for (const v of nouveaux) {
    const m = montantVirement(v), cands = manuels.filter(r => !pris.has(r.id) && Math.abs(Number(r.montant_ttc) - m) <= 0.01);
    if (cands.length === 1) { pris.add(cands[0].id); rapprocher.push({ reglement_id: cands[0].id, transaction_id: idVirement(v)! }); continue; }
    if (cands.length > 1 || manuels.some(r => !pris.has(r.id))) return vide('a_verifier', reste, deja);   // R1 : jamais de doublon
    creer.push({ transaction_id: idVirement(v)!, montant: r2(m), date: String(v.date).slice(0, 10) });
  }
  const ajout = r2(creer.reduce((t, c) => t + c.montant, 0));
  if (ajout > Math.max(0, r2(reste - deja)) + 0.01) return vide('non_etabli', reste, deja);   // virement groupé : part inconnue
  const encaisse = r2(deja + ajout), paye = deja + ajout > 0 && encaisse >= reste - 0.01;
  const dates = [...rs.filter(r => r.etat === 'fait' && r.sens === 'encaissement').map(r => String(r.date || '')), ...creer.map(c => c.date)].filter(Boolean).sort();
  if (paye) return { creer, rapprocher, paid_at: dates.pop() || null, encaisse, reste, signal: null };
  if (creer.length || rapprocher.length || deja > 0) return { creer, rapprocher, paid_at: null, encaisse, reste, signal: 'partiel' };
  return vide(etablis.length && etablis.every(v => dejaAilleurs.has(idVirement(v)!)) ? 'deja_compte' : 'sans_virement', reste, deja);
}

export type PlanRemboursement = { creer: { transaction_id: string; montant: number; date: string }[]; rapprocher: { reglement_id: string; transaction_id: string; date: string; a_faire: boolean }[];
  signal: null | 'a_verifier' };
/**
 * Remboursements d'un avoir d'après les virements SORTANTS rapprochés de l'avoir dans Pennylane (montant < 0) : rapprochés d'abord d'un
 * remboursement manuel fait non rapproché, sinon d'un remboursement « à faire », du même montant (à 1 centime, une seule candidate) ;
 * sinon créés — sauf s'il reste une saisie manuelle non rapprochée (R1 : à vérifier, rien n'est fait). Virements entrants : ignorés.
 */
export function planRemboursement(virementsAvoir: Virement[], dejaAilleurs: Set<string>, reglements: Reglement[]): PlanRemboursement {
  const rs = (reglements || []).filter(actif), ici = new Set(rs.map(r => r.transaction_id).filter(Boolean) as string[]);
  const sortants = (virementsAvoir || []).filter(v => idVirement(v) && plein(v?.date) && montantVirement(v) < 0 && !dejaAilleurs.has(idVirement(v)!) && !ici.has(idVirement(v)!));
  const ouverts = rs.filter(r => r.sens === 'remboursement' && !r.transaction_id);
  const creer: PlanRemboursement['creer'] = [], rapprocher: PlanRemboursement['rapprocher'] = [], pris = new Set<string>();
  for (const v of sortants) {
    const m = Math.abs(montantVirement(v)), date = String(v.date).slice(0, 10);
    const pour = (etat: string) => ouverts.filter(r => r.etat === etat && !pris.has(r.id) && Math.abs(Number(r.montant_ttc) - m) <= 0.01);
    const faits = pour('fait'), aFaire = pour('a_faire');
    const c = faits.length === 1 ? faits[0] : !faits.length && aFaire.length === 1 ? aFaire[0] : null;
    if (c) { pris.add(c.id); rapprocher.push({ reglement_id: c.id, transaction_id: idVirement(v)!, date, a_faire: c.etat === 'a_faire' }); continue; }
    if (faits.length > 1 || aFaire.length > 1 || ouverts.some(r => r.etat === 'fait' && r.source === 'manuel' && !pris.has(r.id))) return { creer: [], rapprocher: [], signal: 'a_verifier' };
    creer.push({ transaction_id: idVirement(v)!, montant: r2(m), date });
  }
  return { creer, rapprocher, signal: null };
}
