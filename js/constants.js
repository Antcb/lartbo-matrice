/**
 * Listes métier (statuts, contrats, affiches, pôles…), couleurs des statuts, onglets.
 * ➜ Pour ajouter un statut, une option de liste ou un onglet, c'est ici.
 */
export const STATUSES = ['Intérêt Festival','Option Festival','Confirmée Festival',
  'Intérêt Salle','Option Salle','Confirmée Salle','Option Artiste','Confirmée Artiste','Annulée','Sans Suite'];

// Code couleur des statuts (carte, pastilles, liste)
export const STATUS_COLOR = {
  'Intérêt Festival':'#A9C8EC', 'Option Festival':'#4A86D4', 'Confirmée Festival':'#173E7A',
  'Intérêt Salle':'#BFE3B9', 'Option Salle':'#5DBB6E', 'Confirmée Salle':'#1D6B3A',
  'Option Artiste':'#9EA4AD', 'Confirmée Artiste':'#111111',
  'Annulée':'#C8372D', 'Sans Suite':'#8A5A2E', 'Booking':'#C9CDD4',
};
export const stColor = s => STATUS_COLOR[s] || STATUS_COLOR.Booking;

// Famille du statut : int / opt / conf / off
export const stClass = s => !s ? 'book' : s.startsWith('Intérêt') ? 'int' : s.startsWith('Option') ? 'opt' : s.startsWith('Confirmée') ? 'conf' : (s==='Annulée'||s==='Sans Suite') ? 'off' : 'book';

export const isOff = s => s==='Annulée' || s==='Sans Suite';

export const CONFIRMED_PROD = ['Confirmée Salle','Confirmée Festival'];

export const CONTRACTS = ['Cession','Co-Réalisation','Production','Co-Production','N.C'];

export const TICKETING = ['Payant/Prix Libre','Gratuit'];

export const POSTER = ['Quantité à demander','En attente des quantités souhaitées','En attente de commande',"En attente d'expédition",'Expédiée','Livrée','Non concerné'];

export const PROSPECT = ['Mailed','Interest','Option','Confirmed','Closed'];

export const TASK_STATUS = ['To Do','In Progress','Done','Cancelled'];

export const PRIORITIES = ['D-Day','Critical','High','Medium','Low'];

// Pôles des tâches par défaut (modifiables dans Réglages → réglage « departments »)
export const DEFAULT_DEPARTMENTS = [{name:'Booking',color:'#4A86D4'},{name:'Production',color:'#1D6B3A'},{name:'Communication',color:'#B4539A'},{name:'Admin',color:'#7A5AC8'},{name:'Accounting',color:'#C98A12'},{name:'Projects',color:'#283C63'}];

// Équipe : adresse → prénom affiché
export const TEAM_NAMES = {'anthony@lartboristerie.com':'Anthony', 'production@lartboristerie.com':'Chloé'};

export const PAY_KINDS = {acompte:'Acompte', solde:'Solde', artbo:"Commission L'ArtBo", partner:'Commission partenaire', cnm:'Taxe CNM', autre:'Autre'};

// Suivi admin d'une date en production complète
export const PROD_STEPS = [
  ['conf_kit_sent','Conf + FT + kit promo'],
  ['precontract_done','Pré-contrat complété'],
  ['contract_sent','Contrat envoyé'],
  ['contract_signed','Contrat signé'],
  ['contract_cosigned_sent','Contrat co-signé renvoyé'],
  ['boucle_tech','Boucle technique'],
];
// Projets en « booking seul » : L'ArtBo envoie la conf, puis facture sa commission à l'artiste
export const BOOKING_STEPS = [
  ['conf_kit_sent','Conf + FT + kit promo'],
  ['contract_cosigned_sent','Contrat co-signé (artiste ↔ organisateur)'],
];

export const VIEWS = [
  ['booking','Booking'], ['prospects','Suivi'], ['production','Production'], ['ticketing','Ticketing'], ['communication','Communication'],
  ['projects','Projets'], ['todo','To Do'], ['structures','Structures'], ['contacts','Contacts'], ['employees','Salariés'],
];

export const LOG_KINDS = ['Appel','Mail','RDV','Note'];

export const LOG_ICON = {Appel:'📞', Mail:'✉️', RDV:'🤝', Note:'📝', Lien:'🔗', Fichier:'📎'};

// Délai avant qu'un élément clos / terminé / annulé disparaisse (pour pouvoir annuler)
export const LINGER_MS = 5000;
