/**
 * Listes métier (statuts, contrats, affiches…), onglets et couleurs des statuts.
 */
export const STATUSES = ['Booking','Intérêt Salle','Intérêt Festival','Option Salle','Option Festival','Option Artiste',
  'Confirmée Salle','Confirmée Festival','Confirmée Artiste','Annulée','Sans Suite'];

export const CONFIRMED_PROD = ['Confirmée Salle','Confirmée Festival'];

export const CONTRACTS = ['Cession','Co-Réalisation','Production','Co-Production','N.C'];

export const TICKETING = ['Payant/Prix Libre','Gratuit'];

export const POSTER = ['Quantité à demander','En attente des quantités souhaitées','En attente de commande',"En attente d'expédition",'Expédiée','Livrée','Non concerné'];

export const PROSPECT = ['Mailed','Interest','Option','Confirmed','Closed'];

export const TASK_STATUS = ['To Do','In Progress','Done','Cancelled'];

export const PRIORITIES = ['D-Day','Critical','High','Medium','Low'];

export const DEPARTMENTS = ['Booking','Production','Communication','Admin','Accounting','Projects'];

export const PAY_KINDS = {acompte:'Acompte', solde:'Solde', artbo:"Commission L'ArtBo", partner:'Commission partenaire', cnm:'Taxe CNM', autre:'Autre'};

export const PROD_STEPS = [
  ['conf_kit_sent','Conf + FT + kit promo'],
  ['contract_sent','Contrat envoyé'],
  ['contract_signed','Contrat signé'],
  ['contract_cosigned_sent','Contrat co-signé renvoyé'],
  ['boucle_tech','Boucle technique'],
];

export const stClass = s => !s ? 'book' : s.startsWith('Intérêt') ? 'int' : s.startsWith('Option') ? 'opt' : s.startsWith('Confirmée') ? 'conf' : (s==='Annulée'||s==='Sans Suite') ? 'off' : 'book';

export const stColor = s => getComputedStyle(document.documentElement).getPropertyValue('--st-' + {int:'int',opt:'opt',conf:'conf',off:'off',book:'book'}[stClass(s)]).trim();

export const VIEWS = [
  ['booking','Booking'], ['production','Production'], ['ticketing','Ticketing'], ['communication','Communication'],
  ['projects','Projets'], ['todo','To Do'], ['prospects','Suivi'], ['contacts','Contacts'], ['structures','Structures'], ['settings','Réglages']
];

export const LOG_KINDS = ['Appel','Mail','RDV','Note'];

export const LOG_ICON = {Appel:'📞', Mail:'✉️', RDV:'🤝', Note:'📝'};
