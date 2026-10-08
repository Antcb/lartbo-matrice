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
 *  - 10 j après le paiement de l'acompte sans facture de commission L'ArtBo / partenaire envoyée et payée
 *  - Jour ouvré le plus proche de J-7 (sans descendre sous 7 jours) : envoyer la facture de solde
 * Booking seul : après le contrat co-signé, envoyer la facture de commission ; 10 j après, vérifier le paiement.
 */
import { paymentsOf } from './calc.js';
import { CONFIRMED_PROD } from './constants.js';
import { today } from './utils.js';

export const addDays = (d, n) => { const x = new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };

/** Jour ouvré (lun–ven) le plus proche de J-7 sans être à moins de 7 jours du concert */
export function soldeReminderDay(showDate){
  let d = new Date(addDays(showDate, -7)+'T12:00:00');
  while (d.getDay()===0 || d.getDay()===6) d.setDate(d.getDate()-1);
  return d.toISOString().slice(0,10);
}

export function remindersOf(s){
  if (!CONFIRMED_PROD.includes(s.status)) return [];
  const out = [], pays = paymentsOf(s.id), now = today();
  const first = k => pays.find(p => p.kind===k);
  const rule = (step, due, title) => out.push({step, due, title, late: due <= now});
  if (s.prod_mode === 'booking'){
    const com = first('artbo');
    if (s.contract_cosigned_sent && com && !com.sent_at) rule('artbo', s.contract_cosigned_sent, 'Envoyer la facture de commission à l’artiste');
    if (com?.sent_at && !com.paid_at) rule('artbo', addDays(com.sent_at, 10), 'Vérifier le paiement de la facture de commission');
    return out;
  }
  const upcoming = !s.date || s.date >= now;
  if (upcoming && s.conf_kit_sent && !s.precontract_done && !s.contract_sent) rule('precontract_done', addDays(s.conf_kit_sent, 10), 'Pré-contrat à compléter');
  if (upcoming && s.precontract_done && !s.contract_sent) rule('contract_sent', addDays(s.precontract_done, 10), 'Contrat à envoyer');
  if (upcoming && s.contract_sent && !s.contract_signed) rule('contract_signed', addDays(s.contract_sent, 10), 'Contrat signé à récupérer');
  if (upcoming && s.contract_signed && !s.contract_cosigned_sent) rule('contract_cosigned_sent', addDays(s.contract_signed, 10), 'Contrat co-signé à renvoyer');
  const ac = first('acompte'), so = first('solde');
  if (s.contract_sent && ac && !ac.sent_at) rule('acompte', s.contract_sent, 'Facture d’acompte à envoyer');
  if (ac?.sent_at && !ac.paid_at) rule('acompte', addDays(ac.sent_at, 10), 'Paiement de l’acompte à vérifier');
  if (so?.sent_at && !so.paid_at) rule('solde', addDays(so.sent_at, 10), 'Paiement du solde à vérifier');
  if (s.date && so && !so.sent_at && s.date >= addDays(now, -30)) rule('solde', soldeReminderDay(s.date), 'Envoyer la facture de solde');
  if (upcoming && s.date && !s.boucle_tech) rule('boucle_tech', addDays(s.date, -122), 'Boucle accueil & technique à envoyer (J-4 mois)');
  if (upcoming && s.contract_cosigned_sent && !s.boucle_com) rule('boucle_com', s.contract_cosigned_sent, 'Boucle communication à envoyer');
  if (ac?.paid_at) for (const k of ['artbo','partner']){ const p = first(k); if (p && (!p.sent_at || !p.paid_at)) rule(k, addDays(ac.paid_at, 10), `Facture ${p.label} à ${p.sent_at?'faire payer':'envoyer'}`); }
  return out;
}

export const lateSteps = s => new Set(remindersOf(s).filter(r => r.late).map(r => r.step));
