/**
 * État de l'application en mémoire (données chargées, onglet, filtres) et préférences du navigateur.
 */
import { localDel, localGet, localSet } from './storage.js';
export const TABLES = ['structures','contacts','contact_structures','projects','partners','shows','show_payments',
  'prospects','prospect_logs','prospect_files','tasks','settings',
  'structure_events','project_logs','project_members','attachments','notifications','mail_templates','employees','budget_lines',
  'commission_transfers',   // versements des commissions de production (lot D1, migration v1.43)
  'pennylane_a_rattacher', 'pennylane_rattachements',   // factures du devis à rattacher à la main et historique des choix (v1.56.9)
  'facture_corrections',   // corrections de factures émises, déverrouillage explicite (v1.68, lecture seule)
  'pennylane_avoirs',   // avoirs importés de Pennylane (v1.69, L1 du point 02 ; lecture seule, absent tant que la migration n'est pas appliquée)
  'reglements',   // encaissements et remboursements réels, un par mouvement, TTC (v1.70, L2a ; lecture seule, absent tant que la migration n'est pas appliquée)
  'factures_remplacees', 'virements_groupes', 'rattachements_journal',   // rattachements manuels (v1.71, L2b ; lecture seule, absents tant que la migration n'est pas appliquée)
  'annulations', 'annulations_journal',   // fiches d'annulation des dates engagées (v1.72, L3 ; lecture seule, écritures par les fonctions serveur)
  'pennylane_virements',   // virements Pennylane déjà comptés comme encaissement, jamais deux fois (v1.69, lecture seule)
  'spectacles',   // spectacles d'un artiste, chacun son budget type (v1.57)
  'show_deletions',   // journal des suppressions de dates (v1.60.3, lecture seule ; absent tant que la migration n'est pas appliquée)
  'artist_calendars', 'artist_calendar_events',   // agendas Google des artistes, lecture seule (v1.62)
  'mail_threads', 'mail_sync_state'];   // messagerie intégrée, boîte anthony@ (v1.61) ; les messages restent lus dans Gmail

export const S = {
  rtBuffers: new Set(), rtApply: null,   // changements en direct gardés pendant un rechargement partiel (data.js refreshFor)
  user:null, view: localGet('view') || 'todo', todoWho: localGet('todoWho') || '',
  year: Number(localGet('year')) || new Date().getFullYear(),
  projects: (() => { try { const v = JSON.parse(localGet('projects') || 'null'); if (Array.isArray(v)) return v; } catch(e){} const one = localGet('project'); return one ? [one] : []; })(),
  showInactive: localGet('showInactive') === '1',   // dates, tâches… des artistes inactifs (masqués par défaut)
  db: Object.fromEntries(TABLES.map(t => [t, []])),
  rev: Object.fromEntries(TABLES.map(t => [t, 0])),   // compteur de modifications par table (index en cache)
  openProd: new Set(), mapHidden: new Set(JSON.parse(localGet('mapHidden') || '[]')), routePick: {a:null,b:null}, routeCache: {}, search:{},
  showCancelled:false, projectPage:null, structurePage:null, suiviPage:null, focusProspect:null,
  tab: {},                 // onglet ouvert dans chaque page (structure, projet, suivi)
  linger: new Map(),       // id → heure limite : éléments gardés visibles 5 s après clôture
};

/** Filtre artistes (un ou plusieurs). S.project = l'artiste quand un seul est choisi (valeur par défaut des nouvelles fiches) */
Object.defineProperty(S, 'project', {
  get(){ return S.projects.length === 1 ? S.projects[0] : ''; },
  set(v){ S.projects = v ? [v] : []; },
});
export function setProjects(ids){ S.projects = [...new Set((ids || []).filter(Boolean))]; localSet('projects', JSON.stringify(S.projects)); }

// Préférences et brouillons du navigateur : séparés entre production et test (js/storage.js)
export { localDel, localGet, localSet };

/** Signale qu'une table a changé (les index en cache seront recalculés). */
export function touch(table){ S.rev[table] = (S.rev[table]||0) + 1; }
