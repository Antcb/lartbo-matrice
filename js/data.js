/**
 * Accès à la base Supabase : chargement, enregistrement, création, suppression, envoi de fichiers.
 */
import { render } from './app.js';
import { CFG } from './config.js';
import { byId } from './selectors.js';
import { S } from './state.js';
import { toast } from './utils.js';

export const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

export async function loadAll(){
  const tables = Object.keys(S.db);
  const res = await Promise.all(tables.map(t => fetchAll(t)));
  tables.forEach((t,i) => S.db[t] = res[i]);
}

export async function fetchAll(table){
  let out = [], from = 0, size = 1000;
  for(;;){
    const {data, error} = await sb.from(table).select('*').range(from, from+size-1);
    if (error) { toast(`Chargement ${table} : ${error.message}`, true); return out; }
    out = out.concat(data); if (data.length < size) return out; from += size;
  }
}

export async function save(table, id, patch, {rerender=true}={}){
  const row = byId(table, id); const before = row ? {...row} : null;
  if (row) Object.assign(row, patch);
  const {data, error} = await sb.from(table).update(patch).eq('id', id).select().single();
  if (error){ if (row) Object.assign(row, before); toast('Enregistrement impossible : '+error.message, true); render(); return; }
  Object.assign(row, data);
  if (table==='shows' && patch.status) await refreshShowSide(id);
  if (rerender) render();
}

export async function insert(table, values){
  const {data, error} = await sb.from(table).insert(values).select().single();
  if (error){ toast('Création impossible : '+error.message, true); return null; }
  S.db[table].push(data);
  if (table==='shows') await refreshShowSide(data.id);
  return data;
}

export async function remove(table, id){
  const {error} = await sb.from(table).delete().eq('id', id);
  if (error){ toast('Suppression impossible : '+error.message, true); return false; }
  S.db[table] = S.db[table].filter(r => r.id !== id);
  return true;
}

export async function refreshShowSide(showId){
  const [{data: show}, {data: pays}] = await Promise.all([
    sb.from('shows').select('*').eq('id', showId).single(),
    sb.from('show_payments').select('*').eq('show_id', showId)
  ]);
  if (show){ const i = S.db.shows.findIndex(s=>s.id===showId); if (i>=0) S.db.shows[i]=show; }
  if (pays){ S.db.show_payments = S.db.show_payments.filter(p=>p.show_id!==showId).concat(pays); }
}

export async function syncLinks(kind, id, ids){
  const col = kind==='contact' ? 'contact_id' : 'structure_id', other = kind==='contact' ? 'structure_id' : 'contact_id';
  const current = S.db.contact_structures.filter(l=>l[col]===id).map(l=>l[other]);
  const add = ids.filter(x=>!current.includes(x)), del = current.filter(x=>!ids.includes(x));
  if (add.length){ const rows = add.map(x=>({[col]:id,[other]:x})); const {error}=await sb.from('contact_structures').insert(rows); if(!error) S.db.contact_structures.push(...rows); else toast(error.message,true); }
  for (const x of del){ await sb.from('contact_structures').delete().eq(col,id).eq(other,x); S.db.contact_structures = S.db.contact_structures.filter(l=>!(l[col]===id && l[other]===x)); }
}

export async function uploadFiles(pid, files){
  toast(`Envoi de ${files.length} fichier(s)…`);
  let ok = 0;
  for (const file of files){
    const safe = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w.\-]+/g,'_') || 'fichier';
    const path = `${pid}/${Date.now()}_${safe}`;
    const {error} = await sb.storage.from('suivi').upload(path, file, {contentType: file.type||'application/octet-stream', upsert:false});
    if (error){ toast(`${file.name} : ${error.message}`, true); continue; }
    if (await insert('prospect_files', {prospect_id:pid, name:file.name, path, size:file.size, mime:file.type||null})) ok++;
  }
  if (ok) toast(`${ok} fichier(s) ajouté(s)`);
}
