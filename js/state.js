/**
 * État de l'application en mémoire (données chargées, onglet, filtres) et préférences du navigateur.
 */
export const TABLES = ['structures','contacts','contact_structures','projects','partners','shows','show_payments',
  'prospects','prospect_logs','prospect_files','tasks','settings',
  'structure_events','project_logs','project_members','attachments','notifications','mail_templates','employees','budget_lines'];

export const S = {
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

export function localGet(k){ try { return localStorage.getItem('artbo.'+k); } catch(e){ return null; } }

export function localSet(k,v){ try { localStorage.setItem('artbo.'+k, v); } catch(e){} }

/** Signale qu'une table a changé (les index en cache seront recalculés). */
export function touch(table){ S.rev[table] = (S.rev[table]||0) + 1; }
