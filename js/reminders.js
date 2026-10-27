/**
 * Règles de rappel de la production (mêmes règles que la fonction serveur qui crée les notifications,
 * supabase/migrations/2026-10-27_v1.46_finances.sql generate_reminders). Sert à signaler en rouge les étapes en retard.
 *
 * Production complète :
 *  - 10 j après « Conf + FT + kit » sans « Pré-contrat complété »
 *  - 10 j après « Pré-contrat complété » sans « Contrat envoyé »
 *  - 10 j après « Contrat envoyé » sans « Contrat signé »
 *  - 10 j après « Contrat signé » sans « Contrat co-signé renvoyé »
 *  - Contrat envoyé alors que la facture d'acompte n'est pas faite (sauf acompte caduc : solde déjà facturé)
 *  - Jour ouvré le plus proche de J-7 (sans descendre sous 7 jours) : faire la facture de solde
 *  - Facture faite (numéro ou lien Pennylane) sans date d'envoi : « Facture à envoyer » 3 j après, jusqu'à la saisie de la date
 *    d'envoi (décision d'Anthony du 27/10, v1.46a : la date d'envoi se saisit toujours à la main)
 *  - Facture envoyée impayée : 10 j après l'envoi ou la dernière relance, sans limite de durée, jusqu'au paiement ;
 *    suspension possible à la main, ligne par ligne (reminders_paused)
 *  - 10 j après le premier encaissement (acompte ou solde) : commission L'ArtBo pas encore versée (pas de facture en production) ; facture partenaire pas envoyée / payée
 * Booking seul : après le contrat co-signé, faire la facture de commission ; puis mêmes règles d'envoi et de paiement.
 *   Jamais de relance d'acompte ni de solde (factures de l'artiste à l'organisateur).
 */
import { commissionState, isInvoiced, paymentsOf } from './calc.js';
import { CONFIRMED_PROD } from './constants.js';
import { addDays, eur2, today, workDay, addMonths, workDayBefore } from './utils.js';

export { addDays };   // fonction officielle de js/utils.js (§1.6), gardée ici pour les modules qui l'importent d'ici
/** Rappel à J+10 : décalé au lundi s'il tombe un samedi ou un dimanche (même règle que la fonction serveur) */
const plus10 = d => workDay(addDays(d, 10));

/** Jour ouvré (lun–ven) le plus proche de J-7 sans être à moins de 7 jours du concert */
export function soldeReminderDay(showDate){
  let d = new Date(addDays(showDate, -7)+'T12:00:00');
  while (d.getDay()===0 || d.getDay()===6) d.setDate(d.getDate()-1);
  return d.toISOString().slice(0,10);
}

const last = p => [p.sent_at, p.reminded_at].filter(Boolean).sort().pop();   // 10 j après l'envoi ou la dernière relance
const filled = v => v != null && String(v).trim() !== '';
/** Délai entre la facture faite et le rappel « Facture à envoyer » (décision d'Anthony du 27/10, v1.46a) */
export const SEND_DELAY = 3;
/** Factures que L'ArtBo émet et suit : production = acomptes, soldes, autres lignes ; booking = sa facture de commission */
export const followedInvoice = (p, booking) => booking ? p.kind === 'artbo' : ['acompte', 'solde', 'autre'].includes(p.kind);
/** Facture faite (numéro ou lien Pennylane) mais sans date d'envoi ni de paiement */
const madeNotSent = p => (filled(p.invoice_number) || filled(p.pennylane_id)) && !p.sent_at && !p.paid_at;
/** Jour où la facture a été faite : date de la facture Pennylane, sinon jour où le numéro a été noté (invoiced_on), sinon création de la ligne */
const madeOn = p => p.invoiced_on || (p.created_at ? new Date(p.created_at).toLocaleDateString('sv-SE', {timeZone: 'Europe/Paris'}) : null);   // jour de Paris, comme le serveur
const nameOf = p => [p.label || '', filled(p.invoice_number) ? `(${String(p.invoice_number).trim()})` : ''].filter(Boolean).join(' ');
/** Libellés communs avec la fonction serveur (generate_reminders) */
export const sendTitle = p => `Facture à envoyer : ${nameOf(p)}`;
export const paidTitle = p => `Paiement à vérifier : ${nameOf(p)}${p.reminded_at ? ' (toujours impayée après relance)' : ''}`;

/** Factures suivies : « à envoyer » (faite, pas de date d'envoi) puis « paiement à vérifier » (envoyée, impayée, relances non suspendues) */
function invoiceRules(pays, booking, rule){
  for (const p of pays.filter(x => followedInvoice(x, booking))){
    if (madeNotSent(p) && madeOn(p)) rule(p.kind, workDay(addDays(madeOn(p), SEND_DELAY)), sendTitle(p));
    if (p.sent_at && !p.paid_at && !p.reminders_paused) rule(p.kind, plus10(last(p)), paidTitle(p));
  }
}

export function remindersOf(s){
  if (!CONFIRMED_PROD.includes(s.status)) return [];
  const out = [], pays = paymentsOf(s.id), now = today();
  const first = k => pays.find(p => p.kind===k);
  const rule = (step, due, title) => out.push({step, due, title, late: due <= now});
  if (s.prod_mode === 'booking'){
    const com = first('artbo');
    if (s.contract_cosigned_sent && com && !isInvoiced(com)) rule('artbo', s.contract_cosigned_sent, 'Facture de commission à faire (contrat co-signé)');
    invoiceRules(pays, true, rule);
    // acomptes / soldes : factures de l'artiste à l'organisateur, jamais relancées par L'ArtBo (décision d'Anthony du 26/10, lot C1)
    return out;
  }
  const upcoming = !s.date || s.date >= now;
  if (upcoming && s.conf_kit_sent && !s.precontract_done && !s.contract_sent) rule('precontract_done', plus10(s.conf_kit_sent), 'Pré-contrat à compléter');
  if (upcoming && s.precontract_done && !s.contract_sent) rule('contract_sent', plus10(s.precontract_done), 'Contrat à envoyer');
  if (upcoming && s.contract_sent && !s.contract_signed) rule('contract_signed', plus10(s.contract_sent), 'Contrat signé à récupérer');
  if (upcoming && s.contract_signed && !s.contract_cosigned_sent) rule('contract_cosigned_sent', plus10(s.contract_signed), 'Contrat co-signé à renvoyer');
  const ac = first('acompte'), so = first('solde');
  // acompte devenu caduc (solde déjà facturé) : plus réclamé (lot C1) — même règle côté serveur (generate_reminders, facture_acompte)
  // une fois la facture faite (numéro / lien Pennylane), c'est la règle « Facture à envoyer » qui prend le relais (v1.46a)
  if (s.contract_sent && ac && !isInvoiced(ac) && !isInvoiced(so)) rule('acompte', s.contract_sent, 'Facture d’acompte à faire (contrat envoyé)');
  if (s.date && so && !isInvoiced(so) && s.date >= addDays(now, -30)) rule('solde', soldeReminderDay(s.date), 'Facture de solde à faire');
  invoiceRules(pays, false, rule);
  // 4 mois calendaires avant le concert ; samedi / dimanche → vendredi précédent (Q12, v1.49) — même règle côté serveur
  if (upcoming && s.date && !s.boucle_tech) rule('boucle_tech', workDayBefore(addMonths(s.date, -4)), 'Boucle accueil & technique à envoyer (J-4 mois)');
  if (upcoming && s.contract_cosigned_sent && !s.boucle_com) rule('boucle_com', s.contract_cosigned_sent, 'Boucle communication à envoyer');
  // en production, la commission L'ArtBo n'est pas facturée : L'ArtBo se la verse depuis le compte de l'artiste
  // dès le premier encaissement (acompte, ou solde quand il n'y a pas d'acompte)
  const com = first('artbo'), part = first('partner');
  const cashed = pays.filter(p => ['acompte','solde'].includes(p.kind) && p.paid_at).map(p => p.paid_at).sort()[0];
  // reste à transférer (versements partiels compris, lot D1) — même règle côté serveur (generate_reminders, migration v1.43)
  const reste = com ? commissionState(com).remaining : 0;
  if (cashed && com && reste >= 0.005) rule('artbo', plus10(cashed), `${com.label || 'Commission L’ArtBo'} : ${eur2(reste)} à te verser`);
  if (cashed && part && (!part.sent_at || !part.paid_at)) rule('partner', plus10(cashed), `Facture ${part.label || 'Commission partenaire'} à ${part.sent_at?'faire payer':'envoyer'}`);
  return out;
}

export const lateSteps = s => new Set(remindersOf(s).filter(r => r.late).map(r => r.step));
