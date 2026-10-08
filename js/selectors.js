/**
 * Lecture des données chargées : noms, filtres, liens contacts/structures, suivis, tâches.
 */
import { S } from './state.js';
import { daysUntil } from './utils.js';

export const byId = (t,id) => S.db[t].find(r => r.id === id);

export const projName = id => byId('projects', id)?.name || '';

export const structName = id => byId('structures', id)?.name || '';

export function setting(k){ const s = S.db.settings.find(x=>x.key===k); return s ? s.value : null; }

export function showsFiltered({year=true}={}){
  return S.db.shows.filter(s =>
    (!S.project || s.project_id === S.project) &&
    (!year || !s.date || Number(s.date.slice(0,4)) === S.year)
  ).sort((a,b) => (a.date||'9999').localeCompare(b.date||'9999'));
}

export function showCoords(s){
  if (s.lat!=null && s.lng!=null) return [s.lat, s.lng];
  const st = byId('structures', s.structure_id);
  if (st && st.lat!=null && st.lng!=null) return [st.lat, st.lng];
  return null;
}

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

export function taskSort(a,b){
  const done = t => ['Done','Cancelled'].includes(t.status) ? 1 : 0;
  return done(a)-done(b) || (a.deadline||'9999').localeCompare(b.deadline||'9999');
}

export const isDone = t => ['Done','Cancelled'].includes(t.status);

export function logsOf(pid){ return S.db.prospect_logs.filter(l=>l.prospect_id===pid && !l.hidden).sort((a,b)=>(b.date||'0000').localeCompare(a.date||'0000') || (b.sort||0)-(a.sort||0)); }

export function filesOf(pid){ return S.db.prospect_files.filter(f=>f.prospect_id===pid).sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||'')); }

export function lastExchange(p){ const l = logsOf(p.id).find(x=>x.date); const d = [l?.date, p.last_contact].filter(Boolean).sort().pop(); return d || null; }

export function projIds(p){ return (p.project_ids && p.project_ids.length) ? p.project_ids : (p.project_id ? [p.project_id] : []); }

export function projNames(p){ return projIds(p).map(projName).filter(Boolean).join(', '); }

export function prospectTitle(p){ return [structName(p.structure_id), projNames(p)].filter(Boolean).join(' — ') || p.name; }

export function linksOfContact(id){ return S.db.contact_structures.filter(l=>l.contact_id===id).map(l=>byId('structures',l.structure_id)).filter(Boolean); }

export function linksOfStructure(id){ return S.db.contact_structures.filter(l=>l.structure_id===id).map(l=>byId('contacts',l.contact_id)).filter(Boolean); }

export const optsOf = (t, label='name') => S.db[t].slice().sort((a,b)=>String(a[label]).localeCompare(String(b[label]))).map(r=>[r.id, r[label]]);
