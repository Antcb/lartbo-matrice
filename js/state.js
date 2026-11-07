/**
 * État de l'application en mémoire (données chargées, onglet, filtres) et préférences du navigateur.
 */
import { localDel, localGet, localSet } from './storage.js';
export const TABLES = ['structures','contacts','contact_structures','projects','partners','shows','show_payments',
  'prospects','prospect_logs','prospect_files','tasks','settings',
  'structure_events','project_logs','project_members','attachments','notifications','mail_templates','employees','budget_lines',
  'commission_transfers',   // versements des commissions de production (lot D1, migration v1.43)
  'pennylane_a_rattacher', 'pennylane_rattachements',   // factures du devis à rattacher à la main et historique des choix (v1.56.9)
  'spectacles',   // spectacles d'un artiste, chacun son budget type (v1.57)
  'show_deletions'];   // journal des suppressions de dates (v1.60.3, lecture seule ; absent tant que la migration n'est pas appliquée)

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

/**
 * Dates archivées (v1.60.3, réponse d'Anthony du 07/11) : la date et ses lignes de facturation et de budget sont gardées ici,
 * HORS de S.db — elles sortent ainsi de toutes les listes, de tous les totaux, comptes, commissions, rappels, cartes, calendriers
 * et exports (tout le code lit S.db), sans condition à ajouter écran par écran. Consultables et restaurables dans Booking
 * (« Dates archivées »). Une ligne arrivée dans S.db (chargement, temps réel, relecture) remplace sa copie gardée ici.
 */
export const ARCHIVED = {shows: [], show_payments: [], budget_lines: []};
function splitArchived(){
  const merge = t => { const seen = new Set(S.db[t].map(r => r.id)); return S.db[t].concat(ARCHIVED[t].filter(r => !seen.has(r.id))); };
  const shows = merge('shows'), off = new Set(shows.filter(x => x.archived_at).map(x => x.id));
  if (!off.size && !ARCHIVED.shows.length && !ARCHIVED.show_payments.length && !ARCHIVED.budget_lines.length) return;
  for (const t of ['shows', 'show_payments', 'budget_lines']){
    const rows = t === 'shows' ? shows : merge(t), isOut = r => off.has(t === 'shows' ? r.id : r.show_id);
    const keep = rows.filter(r => !isOut(r)), out = rows.filter(isOut);
    if (keep.length !== S.db[t].length || out.length !== ARCHIVED[t].length || keep.some((r, i) => S.db[t][i] !== r)){
      S.db[t] = keep; ARCHIVED[t] = out; S.rev[t] = (S.rev[t]||0) + 1; }
  }
}

/** Signale qu'une table a changé (les index en cache seront recalculés). */
export function touch(table){ S.rev[table] = (S.rev[table]||0) + 1; if (table in ARCHIVED) splitArchived(); }
