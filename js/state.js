/**
 * État de l'application en mémoire (données chargées, onglet, filtres) et préférences du navigateur.
 */
export const TABLES = ['structures','contacts','contact_structures','projects','partners','shows','show_payments',
  'prospects','prospect_logs','prospect_files','tasks','settings',
  'structure_events','project_logs','project_members','attachments','notifications','mail_templates','employees'];

export const S = {
  user:null, view: localGet('view') || 'booking',
  year: Number(localGet('year')) || new Date().getFullYear(),
  project: localGet('project') || '',
  db: Object.fromEntries(TABLES.map(t => [t, []])),
  rev: Object.fromEntries(TABLES.map(t => [t, 0])),   // compteur de modifications par table (index en cache)
  openProd: new Set(), routePick: {a:null,b:null}, routeCache: {}, search:{},
  showCancelled:false, projectPage:null, structurePage:null, suiviPage:null, focusProspect:null,
  tab: {},                 // onglet ouvert dans chaque page (structure, projet, suivi)
  linger: new Map(),       // id → heure limite : éléments gardés visibles 5 s après clôture
};

export function localGet(k){ try { return localStorage.getItem('artbo.'+k); } catch(e){ return null; } }

export function localSet(k,v){ try { localStorage.setItem('artbo.'+k, v); } catch(e){} }

/** Signale qu'une table a changé (les index en cache seront recalculés). */
export function touch(table){ S.rev[table] = (S.rev[table]||0) + 1; }
