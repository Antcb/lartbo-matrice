/**
 * Règles de rappel de la production (mêmes règles que la fonction serveur qui crée les notifications,
 * voir supabase/migrations/…_rappels.sql). Sert à signaler en rouge les étapes en retard.
 *
 * Production complète :
 *  - 10 j après « Conf + FT + kit » sans « Pré-contrat complété »
 *  - 10 j après « Pré-contrat complété » sans « Contrat envoyé »
 *  - 10 j après « Contrat envoyé » sans « Contrat signé »
 *  - 10 j après « Contrat signé » sans « Contrat co-signé renvoyé »
 *  - Contrat envoyé alors que la facture d'acompte n'est pas envoyée
 *  - 10 j après l'envoi de la facture d'acompte / de solde sans paiement
 *  - 10 j après le premier encaissement (acompte ou solde) : commission L'ArtBo pas encore versée (pas de facture en production) ; facture partenaire pas envoyée / payée
 *  - Jour ouvré le plus proche de J-7 (sans descendre sous 7 jours) : envoyer la facture de solde
 * Booking seul : après le contrat co-signé, envoyer la facture de commission ; 10 j après, vérifier le paiement ;
 *   une facture d'acompte / de solde déjà envoyée (rare en booking) : même vérification du paiement qu'en production.
 */
import { paymentsOf } from './calc.js';
import { CONFIRMED_PROD } from './constants.js';
import { today, workDay } from './utils.js';

export const addDays = (d, n) => { const x = new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
/** Rappel à J+10 : décalé au lundi s'il tombe un samedi ou un dimanche (même règle que la fonction serveur) */
const plus10 = d => workDay(addDays(d, 10));

/** Jour ouvré (lun–ven) le plus proche de J-7 sans être à moins de 7 jours du concert */
export function soldeReminderDay(showDate){
  let d = new Date(addDays(showDate, -7)+'T12:00:00');
  while (d.getDay()===0 || d.getDay()===6) d.setDate(d.getDate()-1);
  return d.toISOString().slice(0,10);
}

const last = p => [p.sent_at, p.reminded_at].filter(Boolean).sort().pop();   // 10 j après l'envoi ou la dernière relance
/** Facture d'acompte / de solde envoyée et impayée : à vérifier 10 j après l'envoi ou la dernière relance */
function paidCheck(ac, so, rule){
  if (ac?.sent_at && !ac.paid_at) rule('acompte', plus10(last(ac)), ac.reminded_at ? 'Acompte toujours impayé après relance' : 'Paiement de l’acompte à vérifier');
  if (so?.sent_at && !so.paid_at) rule('solde', plus10(last(so)), so.reminded_at ? 'Solde toujours impayé après relance' : 'Paiement du solde à vérifier');
}

export function remindersOf(s){
  if (!CONFIRMED_PROD.includes(s.status)) return [];
  const out = [], pays = paymentsOf(s.id), now = today();
  const first = k => pays.find(p => p.kind===k);
  const rule = (step, due, title) => out.push({step, due, title, late: due <= now});
  if (s.prod_mode === 'booking'){
    const com = first('artbo');
    if (s.contract_cosigned_sent && com && !com.sent_at) rule('artbo', s.contract_cosigned_sent, 'Envoyer la facture de commission à l’artiste');
    if (com?.sent_at && !com.paid_at) rule('artbo', plus10(com.sent_at), 'Vérifier le paiement de la facture de commission');
    // facture d'acompte / de solde déjà envoyée sur une date booking : relancée si impayée (même règle qu'en production) ;
    // une ligne jamais facturée (pas de date d'envoi) ne génère aucune relance (décision d'Anthony du 24/10)
    paidCheck(first('acompte'), first('solde'), rule);
    return out;
  }
  const upcoming = !s.date || s.date >= now;
  if (upcoming && s.conf_kit_sent && !s.precontract_done && !s.contract_sent) rule('precontract_done', plus10(s.conf_kit_sent), 'Pré-contrat à compléter');
  if (upcoming && s.precontract_done && !s.contract_sent) rule('contract_sent', plus10(s.precontract_done), 'Contrat à envoyer');
  if (upcoming && s.contract_sent && !s.contract_signed) rule('contract_signed', plus10(s.contract_sent), 'Contrat signé à récupérer');
  if (upcoming && s.contract_signed && !s.contract_cosigned_sent) rule('contract_cosigned_sent', plus10(s.contract_signed), 'Contrat co-signé à renvoyer');
  const ac = first('acompte'), so = first('solde');
  if (s.contract_sent && ac && !ac.sent_at) rule('acompte', s.contract_sent, 'Facture d’acompte à envoyer');
  paidCheck(ac, so, rule);
  if (s.date && so && !so.sent_at && s.date >= addDays(now, -30)) rule('solde', soldeReminderDay(s.date), 'Envoyer la facture de solde');
  if (upcoming && s.date && !s.boucle_tech) rule('boucle_tech', addDays(s.date, -122), 'Boucle accueil & technique à envoyer (J-4 mois)');
  if (upcoming && s.contract_cosigned_sent && !s.boucle_com) rule('boucle_com', s.contract_cosigned_sent, 'Boucle communication à envoyer');
  // en production, la commission L'ArtBo n'est pas facturée : L'ArtBo se la verse depuis le compte de l'artiste
  // dès le premier encaissement (acompte, ou solde quand il n'y a pas d'acompte)
  const com = first('artbo'), part = first('partner');
  const cashed = pays.filter(p => ['acompte','solde'].includes(p.kind) && p.paid_at).map(p => p.paid_at).sort()[0];
  if (cashed && com && !com.paid_at) rule('artbo', plus10(cashed), `${com.label || 'Commission L’ArtBo'} à te verser`);
  if (cashed && part && (!part.sent_at || !part.paid_at)) rule('partner', plus10(cashed), `Facture ${part.label} à ${part.sent_at?'faire payer':'envoyer'}`);
  return out;
}

export const lateSteps = s => new Set(remindersOf(s).filter(r => r.late).map(r => r.step));
