/**
 * Accès à la base Supabase : chargement, enregistrement, création, suppression, envoi de fichiers.
 * Toute modification passe par save / insert / remove, qui tiennent les index à jour (touch).
 */
import { render } from './app.js';
import { CFG } from './config.js';
import { LINGER_MS } from './constants.js';
import { byId } from './selectors.js';
import { S, TABLES, touch } from './state.js';
import { toast } from './utils.js';

export const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

export async function loadAll(){
  const res = await Promise.all(TABLES.map(t => fetchAll(t)));
  TABLES.forEach((t,i) => { S.db[t] = res[i]; touch(t); });
}

export async function fetchAll(table){
  let out = [], from = 0, size = 1000;
  for(;;){
    const {data, error} = await sb.from(table).select('*').range(from, from+size-1);
    if (error) { if (!/does not exist/.test(error.message)) toast(`Chargement ${table} : ${error.message}`, true); return out; }
    out = out.concat(data); if (data.length < size) return out; from += size;
  }
}

export async function save(table, id, patch, {rerender=true}={}){
  const row = byId(table, id); const before = row ? {...row} : null;
  if (row) Object.assign(row, patch);
  touch(table);
  const {data, error} = await sb.from(table).update(patch).eq('id', id).select().single();
  if (error){ if (row) Object.assign(row, before); touch(table); toast('Enregistrement impossible : '+error.message, true); render(); return null; }
  Object.assign(row, data); touch(table);
  if (table==='shows' && (patch.status || patch.project_id)) await refreshShowSide(id);
  if (rerender) render();
  return before;
}

/**
 * Enregistre un changement qui fait disparaître l'élément (tâche faite, suivi clos, date annulée) :
 * il reste visible 5 s avec un bouton « Annuler ».
 */
export async function saveLinger(table, id, patch, message){
  S.linger.set(id, Date.now() + LINGER_MS);
  const before = await save(table, id, patch);
  if (!before) { S.linger.delete(id); return; }
  const undo = {}; Object.keys(patch).forEach(k => undo[k] = before[k] ?? null);
  toast(message, false, {label:'Annuler', fn: async () => { S.linger.delete(id); await save(table, id, undo); }});
  setTimeout(() => { if (S.linger.has(id) && S.linger.get(id) <= Date.now() + 50){ S.linger.delete(id); render(); } }, LINGER_MS + 100);
}

export const lingering = id => S.linger.has(id);

export async function insert(table, values){
  const {data, error} = await sb.from(table).insert(values).select().single();
  if (error){ toast('Création impossible : '+error.message, true); return null; }
  S.db[table].push(data); touch(table);
  if (table==='shows') await refreshShowSide(data.id);
  return data;
}

export async function remove(table, id){
  const {error} = await sb.from(table).delete().eq('id', id);
  if (error){ toast('Suppression impossible : '+error.message, true); return false; }
  S.db[table] = S.db[table].filter(r => r.id !== id); touch(table);
  return true;
}

/** Supprime les lignes liées (tables sans cascade) */
export async function removeWhere(table, col, val){
  const {error} = await sb.from(table).delete().eq(col, val);
  if (!error){ S.db[table] = S.db[table].filter(r => r[col] !== val); touch(table); }
}

export async function refreshShowSide(showId){
  const [{data: show}, {data: pays}] = await Promise.all([
    sb.from('shows').select('*').eq('id', showId).single(),
    sb.from('show_payments').select('*').eq('show_id', showId)
  ]);
  if (show){ const i = S.db.shows.findIndex(s=>s.id===showId); if (i>=0) S.db.shows[i]=show; touch('shows'); }
  if (pays){ S.db.show_payments = S.db.show_payments.filter(p=>p.show_id!==showId).concat(pays); touch('show_payments'); }
}

export async function syncLinks(kind, id, ids){
  const col = kind==='contact' ? 'contact_id' : 'structure_id', other = kind==='contact' ? 'structure_id' : 'contact_id';
  const current = S.db.contact_structures.filter(l=>l[col]===id).map(l=>l[other]);
  const add = ids.filter(x=>!current.includes(x)), del = current.filter(x=>!ids.includes(x));
  if (add.length){ const rows = add.map(x=>({[col]:id,[other]:x})); const {error}=await sb.from('contact_structures').insert(rows); if(!error) S.db.contact_structures.push(...rows); else toast(error.message,true); }
  for (const x of del){ await sb.from('contact_structures').delete().eq(col,id).eq(other,x); S.db.contact_structures = S.db.contact_structures.filter(l=>!(l[col]===id && l[other]===x)); }
  touch('contact_structures');
}

const safeName = n => n.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w.\-]+/g,'_') || 'fichier';

/**
 * Envoi de fichiers dans le stockage privé « suivi ».
 * owner : {prospect_id} pour un suivi, {task_id} ou {project_id[, project_log_id]} pour les autres pièces jointes.
 */
export async function uploadFiles(owner, files){
  if (typeof owner === 'string') owner = {prospect_id: owner};
  const table = owner.prospect_id ? 'prospect_files' : 'attachments';
  const folder = owner.prospect_id || (owner.task_id ? 'task/' + owner.task_id : 'project/' + owner.project_id);
  toast(`Envoi de ${files.length} fichier(s)…`);
  let ok = 0;
  for (const file of files){
    const path = `${folder}/${Date.now()}_${safeName(file.name)}`;
    const {error} = await sb.storage.from('suivi').upload(path, file, {contentType: file.type||'application/octet-stream', upsert:false});
    if (error){ toast(`${file.name} : ${error.message}`, true); continue; }
    if (await insert(table, {...owner, name:file.name, path, size:file.size, mime:file.type||null})) ok++;
  }
  if (ok) toast(`${ok} fichier(s) ajouté(s)`);
  return ok;
}

/** Ouvre un fichier du stockage privé (lien temporaire) */
export async function openStored(path){
  const w = window.open('', '_blank');
  const {data, error} = await sb.storage.from('suivi').createSignedUrl(path, 3600);
  if (error){ if (w) w.close(); return toast('Ouverture impossible : '+error.message, true); }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

/** Lien temporaire (image de projet…) mis en cache */
const SIGNED = {};
export async function signedUrl(path){
  if (!path) return null;
  const c = SIGNED[path]; if (c && c.until > Date.now()) return c.url;
  const {data} = await sb.storage.from('suivi').createSignedUrl(path, 3600*6);
  if (data) SIGNED[path] = {url:data.signedUrl, until: Date.now() + 3600*5*1000};
  return data?.signedUrl || null;
}
export const signedCached = path => SIGNED[path]?.url || null;
