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
 *    d'envoi (décision d'Anthony du 27/10, v1.46a : la date d'envoi se saisit toujours à la main) ; facture de SOLDE d'une date
 *    qui a un jour de concert : jamais avant le jour du rappel du solde (soldeReminderDay, J-7) — demande d'Anthony du 09/11, v1.60.6
 *  - Facture envoyée impayée : 10 j après l'envoi ou la dernière relance, sans limite de durée, jusqu'au paiement ;
 *    suspension possible à la main, ligne par ligne (reminders_paused)
 *  - 10 j après le premier encaissement (acompte ou solde) : commission L'ArtBo pas encore versée (pas de facture en production) ; facture partenaire pas envoyée / payée
 * Booking seul : après le contrat co-signé, faire la facture de commission ; puis mêmes règles d'envoi et de paiement.
 * Date archivée : aucune relance. Date restaurée (décision d'Anthony du 07/11) : relances suspendues jusqu'à « Réactiver les relances » ;
 * chaque relance part alors à la prochaine échéance choisie (reminders_next, clé = règle de generate_reminders), jamais avant son
 * échéance d'origine (v1.60.3).
 *   Jamais de relance d'acompte ni de solde (factures de l'artiste à l'organisateur).
 */
import { commissionState, isInvoiced, paymentsOf } from './calc.js';
import { CONFIRMED_PROD } from './constants.js';
import { addDays, eur2, today, workDay, addMonths, workDayBefore } from './utils.js';
import { setting } from './selectors.js';

export { addDays };   // fonction officielle de js/utils.js (§1.6), gardée ici pour les modules qui l'importent d'ici

/**
 * Délais et automatismes (Réglages, lot v1.64) : les délais EXISTANTS des rappels, rendus configurables ; aucun nouvel automatisme.
 * Valeurs par défaut = règles en place (solde à J-7 depuis la v1.60.6). Même liste, mêmes valeurs par défaut et même résolution
 * côté serveur : supabase/migrations/2026-11-09_v1.64_delais.sql (delais_dossier, reminder_candidates) — tests/static/delais.mjs.
 * Réglage « delais » (table settings) : {règle: [{on, n, from, at, by}]} — versions dans l'ordre d'enregistrement ; from = null :
 * toutes les dates ; from = instant d'enregistrement (ISO, UTC, « …Z ») : seulement les dates créées à partir de cet instant
 * (décision d'Anthony du 09/11 : une date créée avant l'instant exact est « existante »). La dernière version LISIBLE applicable
 * l'emporte ; une version illisible est ignorée (la précédente reste appliquée, sinon la valeur par défaut).
 * Week-ends (décision du 09/11) : délai après une étape → lundi suivant (0 jour compris) ; rappel avant le concert → vendredi
 * précédent ; réglables (weekend_apres, weekend_avant). Solde : règle v1.60.6 fixe (J-n calendaire, samedi / dimanche → vendredi).
 */
export const DELAY_RULES = [
  {key: 'precontrat', label: 'Pré-contrat à compléter', moment: 'Suivi administratif', n: 10, unit: 'j', dir: 'après', ref: '« Conf + FT + kit »', wk: 'apres', scope: 'Production'},
  {key: 'contrat_envoi', label: 'Contrat à envoyer', moment: 'Suivi administratif', n: 10, unit: 'j', dir: 'après', ref: '« Pré-contrat complété »', wk: 'apres', scope: 'Production'},
  {key: 'contrat_signe', label: 'Contrat signé à récupérer', moment: 'Suivi administratif', n: 10, unit: 'j', dir: 'après', ref: '« Contrat envoyé »', wk: 'apres', scope: 'Production'},
  {key: 'contrat_cosigne', label: 'Contrat co-signé à renvoyer', moment: 'Suivi administratif', n: 10, unit: 'j', dir: 'après', ref: '« Contrat signé »', wk: 'apres', scope: 'Production'},
  {key: 'facture_acompte', label: 'Facture d’acompte à faire', moment: 'Préparer / émettre la facture', n: 0, unit: 'j', dir: 'après', ref: '« Contrat envoyé »', wk: 'apres', scope: 'Production', old: 120},
  {key: 'solde_envoi', label: 'Facture de solde à faire', moment: 'Préparer / émettre la facture', n: 7, unit: 'j', dir: 'avant', ref: 'le concert (jours calendaires)', wk: 'solde', scope: 'Production', old: 30},
  {key: 'booking_commission', label: 'Facture de commission à faire', moment: 'Préparer / émettre la facture', n: 0, unit: 'j', dir: 'après', ref: '« Contrat co-signé »', wk: 'apres', scope: 'Booking', old: 120},
  {key: 'facture_envoi', label: 'Facture à envoyer', moment: 'Envoyer la facture', n: 3, unit: 'j', dir: 'après', ref: 'la facture faite (numéro ou lien Pennylane)', wk: 'apres', scope: 'Production (acomptes, soldes, autres lignes) et booking (commission)', note: 'Facture de solde : jamais avant le jour du rappel « Facture de solde à faire ».'},
  {key: 'paiement', label: 'Paiement à vérifier', moment: 'Relance après impayé', n: 10, unit: 'j', dir: 'après', ref: 'l’envoi de la facture ou la dernière relance', wk: 'apres', scope: 'Production et booking (factures suivies)', note: 'Pas de lien avec l’échéance de paiement de la facture. Suspension possible facture par facture (« Relances suspendues »).'},
  {key: 'commission', label: 'Commission L’ArtBo à te verser', moment: 'Suivi financier', n: 10, unit: 'j', dir: 'après', ref: 'le premier encaissement (acompte ou solde)', wk: 'apres', scope: 'Production'},
  {key: 'commission_partenaire', label: 'Facture partenaire à envoyer / faire payer', moment: 'Suivi financier', n: 10, unit: 'j', dir: 'après', ref: 'le premier encaissement (acompte ou solde)', wk: 'apres', scope: 'Production', old: 120},
  {key: 'boucle_accueil', label: 'Boucle accueil & technique à envoyer', moment: 'Boucles', n: 4, unit: 'mois', dir: 'avant', ref: 'le concert', wk: 'avant', scope: 'Production'},
  {key: 'boucle_com', label: 'Boucle communication à envoyer', moment: 'Boucles', n: 0, unit: 'j', dir: 'après', ref: '« Contrat co-signé »', wk: 'apres', scope: 'Production'},
];
/** Politique des week-ends (versions dans le même réglage « delais », n toujours 0) : activée = échéance déplacée */
export const WEEKEND_RULES = [
  {key: 'weekend_apres', label: 'Échéance d’un délai après une étape (0 jour compris) tombant un samedi ou un dimanche', effect: 'reportée au lundi suivant', unit: 'aucun'},
  {key: 'weekend_avant', label: 'Rappel avant le concert tombant un samedi ou un dimanche (boucle accueil & technique)', effect: 'avancé au vendredi précédent', unit: 'aucun'},
];
const ALL_RULES = [...DELAY_RULES, ...WEEKEND_RULES.map(r => ({...r, n: 0}))];
/** Bornes d'un délai saisi (jours ou mois ; politique des week-ends : 0) */
export const DELAY_MAX = {j: 365, mois: 24, aucun: 0};
/** Limite des rappels quotidiens (règle serveur existante, Q13) : au-delà, l'élément reste visible « ancien élément à traiter » */
export const OLD_DAYS = {120: 'concert passé depuis plus de 120 jours', 30: 'concert passé depuis plus de 30 jours'};
const RULE = Object.fromEntries(DELAY_RULES.map(r => [r.key, r]));
/** Marqueur envoyé pour une version AJOUTÉE : l'instant d'enregistrement est posé par le serveur (déclencheur settings_delais_instant,
 *  relecture de 00698b2), jamais par l'horloge du navigateur ; l'application relit ensuite la valeur enregistrée */
export const SAVE_INSTANT = '@enregistrement';
/** Création fictive « après tout enregistrement » : délais qui s'appliqueront aux nouvelles dates (affichage des Réglages) */
export const NEW_DATE = '9999-12-31T23:59:59.999Z';
/** Instant d'enregistrement « AAAA-MM-JJTHH:MM:SS(.mmm)Z » réel (30 février, 9999-99-99, an 0 refusés) — même contrôle que
 *  delais_instant côté serveur */
export const okFrom = v => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v) || v.startsWith('0000')) return false;
  const d = new Date(v); return !isNaN(d) && d.toISOString().slice(0, 19) === v.slice(0, 19); };
const okN = (v, unit) => Number.isInteger(v) && v >= 0 && v <= DELAY_MAX[unit];
/** Version lisible : objet, on booléen ou absent, n entier dans les bornes, from null / absent ou instant réel */
export const okVersion = (v, unit) => !!v && typeof v === 'object' && !Array.isArray(v) && (v.on === undefined || typeof v.on === 'boolean')
  && okN(v.n, unit) && (v.from === undefined || v.from === null || okFrom(v.from));
const listOf = (value, k) => value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value[k]) ? value[k] : [];
/** Délais d'une date : {règle: {on, n}} (politique des week-ends comprise) — dernière version lisible applicable selon l'instant de
 *  création de la date. value : réglage « delais » (autre valeur pour mesurer l'effet d'une modification). */
export function delaysOf(s, value = setting('delais')){
  const created = s?.created_at ? Date.parse(s.created_at) : NaN, out = {};
  for (const r of ALL_RULES){
    let d = {on: true, n: r.n};
    for (const v of listOf(value, r.key)){
      if (!okVersion(v, r.unit)) continue;
      if (v.from != null && !(Number.isFinite(created) && created >= Date.parse(v.from))) continue;
      d = {on: v.on !== false, n: v.n};
    }
    out[r.key] = d;
  }
  return out;
}
/** Anomalies du réglage « delais » (écrit hors de l'application) : ce qui est ignoré, et la valeur RÉELLEMENT appliquée à une date
 *  créée maintenant (version précédente lisible, sinon valeur par défaut) */
export function delaysAnomalies(value = setting('delais')){
  if (value == null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) return [{key: null, text: 'Réglage des délais illisible : toutes les valeurs par défaut sont appliquées.'}];
  const now = delaysOf({created_at: NEW_DATE}, value), out = [];
  for (const k of Object.keys(value)){
    const r = ALL_RULES.find(x => x.key === k);
    if (!r){ out.push({key: k, text: `Règle inconnue « ${k} » : ignorée.`}); continue; }
    if (!Array.isArray(value[k])){ out.push({key: k, text: `${r.label} : réglage illisible, ignoré ; valeur appliquée : ${r.unit === 'aucun' ? (now[k].on ? 'activée' : 'désactivée') : (now[k].on ? now[k].n : 'désactivée')}${r.unit === 'aucun' || !now[k].on ? '' : r.unit === 'mois' ? ' mois' : ' j'} (valeur par défaut).`}); continue; }
    const bad = value[k].filter(v => !okVersion(v, r.unit)).length;
    if (bad){ const kept = value[k].some(v => okVersion(v, r.unit)) ? 'dernière version lisible' : 'valeur par défaut';
      out.push({key: k, text: `${r.label} : ${bad} version${bad > 1 ? 's' : ''} illisible${bad > 1 ? 's' : ''} ignorée${bad > 1 ? 's' : ''} ; valeur appliquée aux nouvelles dates : ${r.unit === 'aucun' ? (now[k].on ? 'activée' : 'désactivée') : (now[k].on ? `${now[k].n}${r.unit === 'mois' ? ' mois' : ' j'}` : 'désactivée')} (${kept}).`}); }
  }
  return out;
}

/** Réglages simples, lus au moment de créer la tâche ou le document : une tâche ou un document existant garde son échéance (rien
 *  n'est recalculé). Clés de la table settings. action = ce que fait réellement la règle (jamais un envoi). */
export const TASK_DELAYS = [
  {key: 'prospect_relance_on', label: 'Tâches de relance de prospection', moment: 'Prospection et relances', action: 'Tâche (créée après un mail de prospection ou de relance)', type: 'bool', n: true, ref: '', shift: '', scope: 'Booking (suivis de prospection)'},
  {key: 'prospect_relance_days', label: 'Relance de prospection (tâche « Relance — structure »)', moment: 'Prospection et relances', action: 'Tâche (échéance)', n: 10, min: 0, max: 365, unit: 'j', dir: 'après', ref: 'l’envoi du mail de prospection ou de la dernière relance', shift: 'samedi / dimanche → lundi', scope: 'Booking (suivis de prospection)'},
  {key: 'prospect_relance_max', label: 'Relances par mail avant la relance téléphone', moment: 'Prospection et relances', action: 'Tâche « Relance téléphone » à la place', n: 3, min: 1, max: 10, unit: 'relances', dir: '', ref: 'relances par mail sans réponse', shift: '', scope: 'Booking (suivis de prospection)'},
  {key: 'booking_task_days', label: 'Échéance proposée d’une nouvelle tâche Booking', moment: 'Tâches', action: 'Préparation (échéance préremplie, modifiable)', n: 10, min: 0, max: 365, unit: 'j', dir: 'après', ref: 'la création de la tâche', shift: 'samedi / dimanche → lundi', scope: 'Tâches du pôle Booking'},
  {key: 'pennylane_payment_days', label: 'Échéance de paiement d’une facture créée depuis la Matrice', moment: 'Échéance de paiement', action: 'Préparation (brouillon Pennylane, rien n’est envoyé)', n: 14, min: 0, max: 365, unit: 'j', dir: 'après', ref: 'la date de la facture', shift: 'aucun', scope: 'Nouvelles factures (acompte, solde, commission) ; modifiable dans Pennylane avant l’envoi', group: 'pennylane'},
  {key: 'pennylane_quote_days', label: 'Validité d’un devis créé depuis la Matrice', moment: 'Devis', action: 'Préparation (devis Pennylane, rien n’est envoyé)', n: 30, min: 1, max: 365, unit: 'j', dir: 'après', ref: 'la date du devis', shift: 'aucun', scope: 'Nouveaux devis ; modifiable dans Pennylane avant l’envoi', group: 'pennylane'},
];
/** Valeur d'un réglage simple : réglage s'il est lisible, sinon la valeur par défaut (celle d'avant les réglages) — même contrôle
 *  que la fonction pennylane (regles.ts delaiDocument) et la contrainte reglage_simple_ok */
export function taskDelay(key, v = setting(key)){
  const r = TASK_DELAYS.find(x => x.key === key);
  if (r.type === 'bool') return typeof v === 'boolean' ? v : r.n;
  return Number.isInteger(v) && v >= r.min && v <= r.max ? v : r.n;
}
/** Réglage simple illisible (écrit hors de l'application) : signalé, valeur par défaut appliquée */
export const taskDelayAnomaly = key => { const v = setting(key); return v != null && taskDelay(key, v) !== v; };

/** Rappel du solde : J-n calendaire (7 par défaut), samedi / dimanche → vendredi précédent — règle v1.60.6 définitive (décision
 *  d'Anthony du 09/11), indépendante de la politique des week-ends */
export function soldeReminderDay(showDate, n = RULE.solde_envoi.n){
  return workDayBefore(addDays(showDate, -n));
}

const last = p => [p.sent_at, p.reminded_at].filter(Boolean).sort().pop();   // 10 j après l'envoi ou la dernière relance
const filled = v => v != null && String(v).trim() !== '';
/** Délai par défaut entre la facture faite et le rappel « Facture à envoyer » (décision d'Anthony du 27/10, v1.46a ; réglable, v1.64) */
export const SEND_DELAY = RULE.facture_envoi.n;
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

/** Règle de la fonction serveur (generate_reminders) d'une facture « paiement à vérifier », selon sa nature */
const PAID_RULE = {acompte: 'acompte_paye', solde: 'solde_paye', artbo: 'booking_commission_payee'};
/** Échéance de « Facture à envoyer » : n j (3 par défaut, jour ouvré) après la facture faite ; facture de solde d'une date qui a un
 *  jour de concert : pas avant le jour du rappel du solde (J-7 par défaut, soldeReminderDay) — v1.60.6, même règle côté serveur */
export function sendDue(p, showDate, d = {facture_envoi: {n: SEND_DELAY}, solde_envoi: {n: RULE.solde_envoi.n}, weekend_apres: {on: true}}){
  const raw = addDays(madeOn(p), d.facture_envoi.n), due = d.weekend_apres.on ? workDay(raw) : raw;
  if (p.kind !== 'solde' || !showDate) return due;
  const j7 = soldeReminderDay(showDate, d.solde_envoi.n);
  return j7 > due ? j7 : due;
}
/** Factures suivies : « à envoyer » (faite, pas de date d'envoi) puis « paiement à vérifier » (envoyée, impayée, relances non suspendues) */
function invoiceRules(pays, booking, rule, showDate, d, monday){
  for (const p of pays.filter(x => followedInvoice(x, booking))){
    if (d.facture_envoi.on && madeNotSent(p) && madeOn(p)) rule(p.kind, sendDue(p, showDate, d), sendTitle(p), 'facture_envoi');
    if (d.paiement.on && p.sent_at && !p.paid_at && !p.reminders_paused) rule(p.kind, monday(addDays(last(p), d.paiement.n)), paidTitle(p), PAID_RULE[p.kind] || 'autre_payee');
  }
}

/** Relances d'une date. Date archivée, ou restaurée sans réactivation des relances : aucune (même règle que generate_reminders) ;
 *  {all: true} = relances concernées malgré la suspension, à leur échéance d'origine (fenêtre « Réactiver les relances »).
 *  Chaque relance porte sa règle (key) = celle de generate_reminders. */
export function remindersOf(s, {all = false, delais} = {}){
  if (!CONFIRMED_PROD.includes(s.status) || s.archived_at || (s.reminders_suspended_at && !all)) return [];
  const out = [], pays = paymentsOf(s.id), now = today(), next = (!all && s.reminders_next) || {};
  const d = delais === undefined ? delaysOf(s) : delaysOf(s, delais), on = k => d[k].on;
  // délai après une étape (0 jour compris) : samedi / dimanche → lundi suivant, selon la politique des week-ends (décision du 09/11)
  const monday = day => d.weekend_apres.on ? workDay(day) : day, after = (k, day) => monday(addDays(day, d[k].n));
  const first = k => pays.find(p => p.kind===k);
  // ancien élément : concert passé au-delà de la limite des rappels quotidiens (serveur : recent / 30 j pour le solde) — l'obligation
  // reste ouverte et visible (« Anciens éléments à traiter »), sans notification quotidienne (décision d'Anthony du 09/11)
  const old = k => !!(RULE[k]?.old && s.date && s.date < addDays(now, -RULE[k].old));
  // prochaine échéance choisie à la réactivation : jamais avant l'échéance d'origine
  const rule = (step, due, title, key) => { const origin = due; if (next[key] && next[key] > due) due = next[key];
    out.push({step, key, due, origin, title, late: due <= now, ...(old(key) ? {stale: true, staleWhy: OLD_DAYS[RULE[key].old]} : {})}); };
  if (s.prod_mode === 'booking'){
    const com = first('artbo');
    if (on('booking_commission') && s.contract_cosigned_sent && com && !isInvoiced(com)) rule('artbo', after('booking_commission', s.contract_cosigned_sent), 'Facture de commission à faire (contrat co-signé)', 'booking_commission');
    invoiceRules(pays, true, rule, s.date, d, monday);
    // acomptes / soldes : factures de l'artiste à l'organisateur, jamais relancées par L'ArtBo (décision d'Anthony du 26/10, lot C1)
    return out;
  }
  const upcoming = !s.date || s.date >= now;
  if (on('precontrat') && upcoming && s.conf_kit_sent && !s.precontract_done && !s.contract_sent) rule('precontract_done', after('precontrat', s.conf_kit_sent), 'Pré-contrat à compléter', 'precontrat');
  if (on('contrat_envoi') && upcoming && s.precontract_done && !s.contract_sent) rule('contract_sent', after('contrat_envoi', s.precontract_done), 'Contrat à envoyer', 'contrat_envoi');
  if (on('contrat_signe') && upcoming && s.contract_sent && !s.contract_signed) rule('contract_signed', after('contrat_signe', s.contract_sent), 'Contrat signé à récupérer', 'contrat_signe');
  if (on('contrat_cosigne') && upcoming && s.contract_signed && !s.contract_cosigned_sent) rule('contract_cosigned_sent', after('contrat_cosigne', s.contract_signed), 'Contrat co-signé à renvoyer', 'contrat_cosigne');
  const ac = first('acompte'), so = first('solde');
  // acompte devenu caduc (solde déjà facturé) : plus réclamé (lot C1) — même règle côté serveur (generate_reminders, facture_acompte)
  // une fois la facture faite (numéro / lien Pennylane), c'est la règle « Facture à envoyer » qui prend le relais (v1.46a)
  if (on('facture_acompte') && s.contract_sent && ac && !isInvoiced(ac) && !isInvoiced(so)) rule('acompte', after('facture_acompte', s.contract_sent), 'Facture d’acompte à faire (contrat envoyé)', 'facture_acompte');
  if (on('solde_envoi') && s.date && so && !isInvoiced(so)) rule('solde', soldeReminderDay(s.date, d.solde_envoi.n), 'Facture de solde à faire', 'solde_envoi');
  invoiceRules(pays, false, rule, s.date, d, monday);
  // 4 mois calendaires avant le concert ; samedi / dimanche → vendredi précédent (Q12, v1.49 ; réglable : weekend_avant) — même règle côté serveur
  if (on('boucle_accueil') && upcoming && s.date && !s.boucle_tech) rule('boucle_tech', (x => d.weekend_avant.on ? workDayBefore(x) : x)(addMonths(s.date, -d.boucle_accueil.n)), `Boucle accueil & technique à envoyer (J-${d.boucle_accueil.n} mois)`, 'boucle_accueil');
  if (on('boucle_com') && upcoming && s.contract_cosigned_sent && !s.boucle_com) rule('boucle_com', after('boucle_com', s.contract_cosigned_sent), 'Boucle communication à envoyer', 'boucle_com');
  // en production, la commission L'ArtBo n'est pas facturée : L'ArtBo se la verse depuis le compte de l'artiste
  // dès le premier encaissement (acompte, ou solde quand il n'y a pas d'acompte)
  const com = first('artbo'), part = first('partner');
  const cashed = pays.filter(p => ['acompte','solde'].includes(p.kind) && p.paid_at).map(p => p.paid_at).sort()[0];
  // reste à transférer (versements partiels compris, lot D1) — même règle côté serveur (generate_reminders, migration v1.43)
  const reste = com ? commissionState(com).remaining : 0;
  if (on('commission') && cashed && com && reste >= 0.005) rule('artbo', after('commission', cashed), `${com.label || 'Commission L’ArtBo'} : ${eur2(reste)} à te verser`, 'commission');
  if (on('commission_partenaire') && cashed && part && (!part.sent_at || !part.paid_at)) rule('partner', after('commission_partenaire', cashed), `Facture ${part.label || 'Commission partenaire'} à ${part.sent_at?'faire payer':'envoyer'}`, 'commission_partenaire');
  return out;
}

export const lateSteps = s => new Set(remindersOf(s).filter(r => r.late).map(r => r.step));
/** Anciens éléments à traiter : obligations encore ouvertes sans notification quotidienne (concert passé au-delà de la limite) */
export const staleOf = s => remindersOf(s).filter(r => r.stale);
