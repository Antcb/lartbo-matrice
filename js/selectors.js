/**
 * Lecture des données chargées : noms, filtres, liens contacts/structures, suivis, tâches.
 * Les recherches fréquentes passent par des index en cache (recalculés quand la table change),
 * ce qui garde l'app rapide malgré les milliers de structures et de contacts.
 */
import { DEFAULT_DEPARTMENTS, PRIORITY_LABEL, TEAM_NAMES, isOff } from './constants.js';
import { lingering } from './data.js';
import { ENV } from './config.js';
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

/** Lien d'une page publique (fiche, artiste, salarié). En test, « &test » est ajouté : le lien ouvre la base de test (jamais
 *  la vraie fiche) et se reconnaît. Même règle pour le lien {{lien_fiche}} des mails (fonction SQL mail_vars, complété
 *  dans js/mail.js mailVars). */
export function publicLink(page, token, extra = ''){
  const base = setting('site_url') || location.origin + location.pathname.replace(/[^/]*$/, '');
  return base + page + '.html?t=' + token + extra + (ENV === 'test' ? '&test' : '');
}
/** Texte d'un message « lien copié » : précise « de test » dans l'espace de test */
export const linkLabel = what => ENV === 'test' ? `${what} (lien de TEST)` : what;

/** Dates du projet et de l'année choisis (filtres de la vue) */
/**
 * Filtre artistes commun à toutes les pages : les artistes choisis en haut (un ou plusieurs),
 * sinon tous les artistes actifs (les inactifs seulement avec « Afficher les inactifs »).
 * Une ligne sans artiste reste toujours visible.
 */
export function projFilterOk(ids){
  ids = (ids || []).filter(Boolean);
  if (S.projects.length) return ids.some(id => S.projects.includes(id));
  if (S.showInactive || !ids.length) return true;
  return ids.some(id => byId('projects', id)?.active);
}
export function showsFiltered({year=true}={}){
  return S.db.shows.filter(s =>
    projFilterOk([s.project_id]) &&
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
  if (d==null) return t.priority ? {cls:{'D-Day':'today',Critical:'crit',High:'high',Medium:'med',Low:'low'}[t.priority]||'med', label:PRIORITY_LABEL[t.priority]||t.priority} : null;
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

/** Commission L'ArtBo par défaut selon le type de suivi (Réglages › Pourcentages par défaut) : booking 15 %, production 20 % */
export const defaultCommission = mode => { const v = Number(setting(mode === 'booking' ? 'default_artbo_pct_booking' : 'default_artbo_pct_production'));
  return Number.isFinite(v) && v > 0 ? v : (mode === 'booking' ? 15 : 20); };
/** Commission d'un projet : la sienne, sinon celle par défaut de son type de suivi */
export const projectCommission = p => p?.default_artbo_pct != null && p.default_artbo_pct !== '' ? Number(p.default_artbo_pct) : defaultCommission(p?.mode);
const filled = v => v != null && String(v).trim() !== '';
/** Commission d'une date sans % sur sa ligne (§6.3, v1.46a) : % de la date > % de l'artiste > Réglages selon le mode de la DATE.
 *  Même règle côté base (default_commission_pct) et côté Pennylane (regles.ts pctCommission). */
export function showCommissionPct(s){
  if (!s) return 0;
  if (filled(s.artbo_pct)) return Number(s.artbo_pct);
  const p = byId('projects', s.project_id);
  if (filled(p?.default_artbo_pct)) return Number(p.default_artbo_pct);
  return defaultCommission(s.prod_mode || p?.mode || 'production');
}
/** Acompte par défaut (§6.4, v1.46a) : le réglage tel quel, 0 % compris (= date sans acompte) ; 50 seulement si le réglage est absent ou vide */
export const defaultAcompte = () => { const v = setting('default_acompte_pct'); return filled(v) && Number.isFinite(Number(v)) ? Number(v) : 50; };

/** Suivi terminé : clos (Closed) ou confirmé (Confirmed) — rangé dans « suivis clos », plus de relance */
export const suiviClosed = p => p?.status === 'Closed' || p?.status === 'Confirmed';

export function projIds(p){ return (p.project_ids && p.project_ids.length) ? p.project_ids : (p.project_id ? [p.project_id] : []); }

export function projNames(p){ return projIds(p).map(projName).filter(Boolean).join(', '); }

export const prospectsOfProject = id => cached('prospects.proj', ['prospects'], () => {
  const m = new Map(); for (const p of S.db.prospects) for (const pid of projIds(p)){ let a = m.get(pid); if (!a) m.set(pid, a=[]); a.push(p); } return m; }).get(id) || [];

export const tasksOfProject = id => cached('tasks.proj', ['tasks'], () => {
  const m = new Map(); for (const t of S.db.tasks) for (const pid of projIds(t)){ let a = m.get(pid); if (!a) m.set(pid, a=[]); a.push(t); } return m; }).get(id) || [];

export function prospectTitle(p){ return [structName(p.structure_id), projNames(p)].filter(Boolean).join(' — ') || p.name; }

/** Les mails d'un contact (mail 1, mail 2), séparés par une virgule : prêts pour « À » d'un mail */
export const contactMails = c => [c?.email, c?.email_2].map(e => String(e || '').trim()).filter(Boolean).filter((e, i, a) => a.findIndex(x => x.toLowerCase() === e.toLowerCase()) === i).join(', ');

export function linksOfContact(id){ return (byCol('contact_structures','contact_id').get(id)||[]).map(l=>byId('structures',l.structure_id)).filter(Boolean); }

export function linksOfStructure(id){ return (byCol('contact_structures','structure_id').get(id)||[]).map(l=>byId('contacts',l.contact_id)).filter(Boolean); }

export const optsOf = (t, label='name') => S.db[t].slice().sort((a,b)=>String(a[label]).localeCompare(String(b[label]))).map(r=>[r.id, r[label]]);

/** Utilisation de chaque artiste (dates + tâches + suivis) : les plus utilisés apparaissent en premier dans les choix */
export const projUsage = () => cached('proj.usage', ['shows', 'tasks', 'prospects'], () => {
  const m = new Map();
  for (const t of ['shows', 'tasks', 'prospects']) for (const r of S.db[t] || []) for (const id of projIds(r)) m.set(id, (m.get(id) || 0) + 1);
  return m;
});
/** Tri des artistes : les plus utilisés d'abord, puis par nom */
export const byUsage = (a, b) => { const u = projUsage(); return ((u.get(b.id) || 0) - (u.get(a.id) || 0)) || a.name.localeCompare(b.name); };

/** Projets triés : actifs d'abord, puis les plus utilisés. onlyActive : seulement les actifs (+ ceux déjà choisis) */
export function projectOptions(onlyActive=false, keep=[]){
  return S.db.projects.slice().filter(p => !onlyActive || p.active || keep.includes(p.id))
    .sort((a,b)=>(b.active-a.active)||byUsage(a, b));
}

/** Nombre de notifications non lues pour l'utilisateur connecté */
export const unreadNotifs = () => S.db.notifications.filter(n => !(n.read_by||[]).includes(S.user?.email));

/** Pôles des tâches (Réglages) : [{name, color}] */
export const departments = () => { const d = setting('departments'); return Array.isArray(d) && d.length ? d : DEFAULT_DEPARTMENTS; };
export const deptNames = () => departments().map(d => d.name);
export const deptColor = n => departments().find(d => d.name === n)?.color || '#8A94A6';
