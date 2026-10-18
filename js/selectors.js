/**
 * Lecture des données chargées : noms, filtres, liens contacts/structures, suivis, tâches.
 * Les recherches fréquentes passent par des index en cache (recalculés quand la table change),
 * ce qui garde l'app rapide malgré les milliers de structures et de contacts.
 */
import { DEFAULT_DEPARTMENTS, TEAM_NAMES, isOff } from './constants.js';
import { lingering } from './data.js';
import { S } from './state.js';
import { daysUntil, fmtDate } from './utils.js';

const CACHE = {};
/** Index mis en cache tant que les tables listées n'ont pas changé */
function cached(name, tables, build){
  const key = tables.map(t => S.rev[t]).join('.');
  const c = CACHE[name];
  if (c && c.key === key) return c.val;
  const val = build(); CACHE[name] = {key, val}; return val;
}
const groupBy = (rows, col) => { const m = new Map(); for (const r of rows){ const k = r[col]; if (k==null) continue; let a = m.get(k); if (!a) m.set(k, a = []); a.push(r); } return m; };

export const byId = (t,id) => id ? cached('id.'+t, [t], () => new Map(S.db[t].map(r => [r.id, r]))).get(id) : undefined;

export const projName = id => byId('projects', id)?.name || '';

export const structName = id => byId('structures', id)?.name || '';

export const teamName = email => TEAM_NAMES[email] || (email ? email.split('@')[0] : '');

export function setting(k){ const s = S.db.settings.find(x=>x.key===k); return s ? s.value : null; }

/** Dates du projet et de l'année choisis (filtres de la vue) */
export function showsFiltered({year=true, project=S.project}={}){
  return S.db.shows.filter(s =>
    (!project || s.project_id === project) &&
    (!year || !s.date || Number(s.date.slice(0,4)) === S.year)
  ).sort((a,b) => (a.date||'9999').localeCompare(b.date||'9999'));
}

/** Masque annulées / sans suite, sauf pendant les 5 s qui suivent le changement */
export const visibleShow = s => S.showCancelled || !isOff(s.status) || lingering(s.id);

export function showCoords(s){
  if (s.lat!=null && s.lng!=null) return [s.lat, s.lng];
  const st = byId('structures', s.structure_id);
  if (st && st.lat!=null && st.lng!=null) return [st.lat, st.lng];
  return null;
}

export const showLabel = s => s ? `${s.date ? s.date.split('-').reverse().join('/') : 'sans date'} · ${s.venue||'?'}${s.city && s.city!==s.venue ? ' ('+s.city+')' : ''}` : '';

export function urgency(t){
  if (['Done','Cancelled'].includes(t.status)) return null;
  const d = daysUntil(t.deadline);
  if (d==null) return t.priority ? {cls:{'D-Day':'today',Critical:'crit',High:'high',Medium:'med',Low:'low'}[t.priority]||'med', label:t.priority} : null;
  if (d<0) return {cls:'late', label:`En retard de ${-d} j`};
  if (d===0) return {cls:'today', label:"Aujourd'hui"};
  if (d<=2) return {cls:'crit', label:`J-${d}`};
  if (d<=7) return {cls:'high', label:`J-${d}`};
  if (d<=21) return {cls:'med', label:`J-${d}`};
  return {cls:'low', label:`J-${d}`};
}

export const isDone = t => ['Done','Cancelled'].includes(t.status);

export function taskSort(a,b){
  const done = t => isDone(t) && !lingering(t.id) ? 1 : 0;
  return done(a)-done(b) || (a.deadline||'9999').localeCompare(b.deadline||'9999');
}

// --- Index par structure / suivi / projet -----------------------------------
const byCol = (table, col) => cached(`${table}.${col}`, [table], () => groupBy(S.db[table], col));

export function logsOf(pid){ return (byCol('prospect_logs','prospect_id').get(pid)||[]).filter(l=>!l.hidden).sort((a,b)=>(b.date||'0000').localeCompare(a.date||'0000') || (b.sort||0)-(a.sort||0)); }

export function filesOf(pid){ return (byCol('prospect_files','prospect_id').get(pid)||[]).slice().sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||'')); }

export const attachmentsOf = (col, id) => (byCol('attachments', col).get(id)||[]).slice().sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));

export const prospectsOfStructure = id => byCol('prospects','structure_id').get(id) || [];
export const showsOfStructure = id => byCol('shows','structure_id').get(id) || [];
export const tasksOfStructure = id => byCol('tasks','structure_id').get(id) || [];
export const eventsOfStructure = id => (byCol('structure_events','structure_id').get(id) || []).slice().sort((a,b)=>(a.date_start||'9999').localeCompare(b.date_start||'9999'));
export const showsOfProject = id => byCol('shows','project_id').get(id) || [];
export const logsOfProject = id => (byCol('project_logs','project_id').get(id) || []).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.created_at||'').localeCompare(a.created_at||''));
export const membersOfProject = id => (byCol('project_members','project_id').get(id) || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0) || String(a.last_name).localeCompare(String(b.last_name)));
export const tasksOfShow = id => byCol('tasks','show_id').get(id) || [];

export function lastExchange(p){ const l = logsOf(p.id).find(x=>x.date); const d = [l?.date, p.last_contact].filter(Boolean).sort().pop(); return d || null; }

export function projIds(p){ return (p.project_ids && p.project_ids.length) ? p.project_ids : (p.project_id ? [p.project_id] : []); }

export function projNames(p){ return projIds(p).map(projName).filter(Boolean).join(', '); }

export const prospectsOfProject = id => cached('prospects.proj', ['prospects'], () => {
  const m = new Map(); for (const p of S.db.prospects) for (const pid of projIds(p)){ let a = m.get(pid); if (!a) m.set(pid, a=[]); a.push(p); } return m; }).get(id) || [];

export const tasksOfProject = id => cached('tasks.proj', ['tasks'], () => {
  const m = new Map(); for (const t of S.db.tasks) for (const pid of projIds(t)){ let a = m.get(pid); if (!a) m.set(pid, a=[]); a.push(t); } return m; }).get(id) || [];

export function prospectTitle(p){ return [structName(p.structure_id), projNames(p)].filter(Boolean).join(' — ') || p.name; }

export function linksOfContact(id){ return (byCol('contact_structures','contact_id').get(id)||[]).map(l=>byId('structures',l.structure_id)).filter(Boolean); }

export function linksOfStructure(id){ return (byCol('contact_structures','structure_id').get(id)||[]).map(l=>byId('contacts',l.contact_id)).filter(Boolean); }

export const optsOf = (t, label='name') => S.db[t].slice().sort((a,b)=>String(a[label]).localeCompare(String(b[label]))).map(r=>[r.id, r[label]]);

/** Projets triés : actifs d'abord. onlyActive : seulement les actifs (+ ceux déjà choisis) */
export function projectOptions(onlyActive=false, keep=[]){
  return S.db.projects.slice().filter(p => !onlyActive || p.active || keep.includes(p.id))
    .sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name));
}

/** Nombre de notifications non lues pour l'utilisateur connecté */
export const unreadNotifs = () => S.db.notifications.filter(n => !(n.read_by||[]).includes(S.user?.email));

/** Pôles des tâches (Réglages) : [{name, color}] */
export const departments = () => { const d = setting('departments'); return Array.isArray(d) && d.length ? d : DEFAULT_DEPARTMENTS; };
export const deptNames = () => departments().map(d => d.name);
export const deptColor = n => departments().find(d => d.name === n)?.color || '#8A94A6';
