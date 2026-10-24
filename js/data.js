/**
 * Accès à la base Supabase : chargement, enregistrement, création, suppression, envoi de fichiers.
 * Toute modification passe par save / insert / remove, qui tiennent les index à jour (touch).
 */
import { render } from './app.js';
import { CFG, ENV } from './config.js';
import { TEAM_NAMES } from './constants.js';
import { LINGER_MS } from './constants.js';
import { byId, linksOfStructure } from './selectors.js';
import { S, TABLES, localGet, localSet, touch } from './state.js';
import { toast } from './utils.js';

export const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

export async function loadAll(){
  const res = await Promise.all(TABLES.map(t => fetchAll(t)));
  TABLES.forEach((t,i) => { S.db[t] = res[i]; touch(t); });
  // espace de test : l'équipe = les comptes de la table app_users du projet de test
  if (!CFG.TEAM){ const {data} = await sb.from('app_users').select('*'); CFG.TEAM = (data || []).map(u => u.email); (data || []).forEach(u => { if (u.display_name) TEAM_NAMES[u.email] = u.display_name; }); }
  // résumés IA restés en attente (IA saturée) : réessayés une fois les suivis chargés
  S.dataLoaded = true; planRetries();
}

export async function fetchAll(table){
  let out = [], from = 0, size = 1000;
  for(;;){
    const {data, error} = await sb.from(table).select('*').range(from, from+size-1);
    if (error) { if (!/does not exist/.test(error.message)) toast(`Chargement ${table} : ${error.message}`, true); return out; }
    out = out.concat(data); if (data.length < size) return out; from += size;
  }
}

let saveGuard = null;
/** Garde-fou appelé avant chaque enregistrement (installé par actions.js : calc.changeBlocked) ; message = refus */
export const setSaveGuard = f => { saveGuard = f; };

export async function save(table, id, patch, {rerender=true}={}){
  const why = saveGuard ? saveGuard(table, id, patch) : '';
  if (why){ toast(why, true); render(); return null; }   // refus : rien n'est écrit, l'affichage revient à la valeur enregistrée
  const row = byId(table, id); const before = row ? {...row} : null;
  if (row) Object.assign(row, patch);
  touch(table);
  const {data, error} = await sb.from(table).update(patch).eq('id', id).select().single();
  if (error){ if (row) Object.assign(row, before); touch(table); toast('Enregistrement impossible : '+error.message, true); render(); return null; }
  if (row) Object.assign(row, data); else if (data) S.db[table].push(data);
  touch(table);
  summaryAfter(table, row || data);
  if (table==='shows' && (patch.status || patch.project_id)) await refreshShowSide(id);
  if (table==='shows' && ('ticketing_type' in patch || 'department' in patch || 'structure_id' in patch)) await (await import('./budget-actions.js')).syncCnmLine(id);
  if (rerender) render();
  return before || {};   // réussi (même si la ligne n'était pas encore en mémoire)
}

/**
 * Enregistre un changement qui fait disparaître l'élément (tâche faite, suivi clos, date annulée) :
 * il reste visible 5 s avec un bouton « Annuler ».
 */
export async function saveLinger(table, id, patch, message, {after, onUndo} = {}){
  S.linger.set(id, Date.now() + LINGER_MS);
  const before = await save(table, id, patch);
  if (!before) { S.linger.delete(id); return; }
  // suite liée (ex. relances retirées) : seulement si l'enregistrement a réussi, et défaite avec « Annuler »
  const extra = after ? await after() : null;
  const undo = {}; Object.keys(patch).forEach(k => undo[k] = before[k] ?? null);
  toast(message, false, {label:'Annuler', fn: async () => { S.linger.delete(id); await save(table, id, undo); if (onUndo) await onUndo(extra); render(); }});
  setTimeout(() => { if (S.linger.has(id) && S.linger.get(id) <= Date.now() + 50){ S.linger.delete(id); render(); } }, LINGER_MS + 100);
}

export const lingering = id => S.linger.has(id);

/** Ajoute des lignes en mémoire sans doublon (une ligne déjà arrivée par la mise à jour automatique est remplacée) */
/** Recharge les lignes d'une table liées à une ou plusieurs dates (après un ajout fait par la base) */
export async function refreshFor(table, col, ids){
  ids = [].concat(ids).filter(Boolean); if (!ids.length) return;
  // les changements reçus en direct pendant la lecture sont gardés, puis rejoués par-dessus (sinon l'ancienne lecture les effacerait)
  const buf = []; S.rtBuffers.add(buf);
  try {
    const data = [];
    for (let i = 0; i < ids.length; i += 200){            // par paquets de dates, et toutes les pages de chaque paquet
      // pages lues par identifiant croissant, en repartant du dernier lu : aucune ligne sautée même si d'autres changent entre deux pages
      for (let last = null; ;){
        let q = sb.from(table).select('*').in(col, ids.slice(i, i + 200)).order('id', {ascending: true}).limit(1000);
        if (last) q = q.gt('id', last);
        const r = await q;
        if (r.error) return;
        data.push(...r.data); if (r.data.length < 1000) break;
        last = r.data[r.data.length - 1].id;
      }
    }
    const keep = new Set(data.map(r => r.id));
    S.db[table] = S.db[table].filter(r => !ids.includes(r[col]) || keep.has(r.id));
    mergeRows(table, data);
    // seuls les événements de la table rechargée sont rejoués (les autres sont déjà appliqués)
    for (const [t, ev] of buf) if (t === table && S.rtApply?.(t, ev)) touch(t);
  } finally { S.rtBuffers.delete(buf); }
}

export function mergeRows(table, rows){
  for (const r of rows || []){ const i = S.db[table].findIndex(x => x.id === r.id); if (i >= 0) S.db[table][i] = r; else S.db[table].push(r); }
  touch(table);
}

export async function insert(table, values){
  const {data, error} = await sb.from(table).insert(values).select().single();
  if (error){ toast('Création impossible : '+error.message, true); return null; }
  // la ligne a pu arriver avant par la mise à jour automatique : on la remplace au lieu de l'ajouter deux fois
  const i = data?.id != null ? S.db[table].findIndex(r => r.id === data.id) : -1;
  if (i >= 0) S.db[table][i] = data; else S.db[table].push(data);
  touch(table);
  summaryAfter(table, data);
  if (table==='shows') await refreshShowSide(data.id);
  return data;
}

export async function remove(table, id){
  const before = byId(table, id);
  const {error} = await sb.from(table).delete().eq('id', id);
  if (error){ toast('Suppression impossible : '+error.message, true); return false; }
  S.db[table] = S.db[table].filter(r => r.id !== id); touch(table);
  summaryAfter(table, before);
  return true;
}

/**
 * Résumé IA d'un suivi : refait automatiquement après chaque échange ou pièce jointe ajouté, modifié ou supprimé
 * (une seule demande quelques secondes après la dernière modification). Sans clé IA : rien.
 */
const SUMMARY_WAIT = new Map();
function summaryAfter(table, row){
  if (!row || !['prospect_logs', 'prospect_files'].includes(table) || !row.prospect_id) return;
  const pid = row.prospect_id;
  clearTimeout(SUMMARY_WAIT.get(pid));
  SUMMARY_WAIT.set(pid, setTimeout(() => { SUMMARY_WAIT.delete(pid); refreshSummary(pid); }, 2500));
}
export async function refreshSummary(pid, {silent = true} = {}){
  const {data, error} = await sb.functions.invoke('resume-suivi', {body: {prospect_id: pid}, headers: {'x-region': 'eu-west-3'}});   // toujours à Paris
  let msg = error ? (await error.context?.json?.().catch(() => null))?.error || error.message : (!data?.summary ? data?.error || 'réponse vide' : null);
  if (msg){
    // Gemini saturé (ou réseau coupé) : nouvel essai automatique un peu plus tard (même après avoir rechargé la page)
    if (BUSY.test(msg)) { const at = queueSummary(pid); if (!silent) toast(`L’IA est saturée : nouvel essai automatique à ${hhmm(at)}`, true); render(); return null; }
    dropSummary(pid);   // erreur durable (clé absente, suivi introuvable…) : pas de nouvel essai automatique
    if (/Aucune clé/.test(msg)) msg = 'Pas encore de clé IA : colle la clé Google AI Studio dans Réglages › IA.';
    if (!silent) toast('Résumé impossible : ' + msg, true);
    return null;
  }
  dropSummary(pid);
  const p = byId('prospects', pid); if (!p) return null;
  p.summary = data.summary; touch('prospects'); render(); toast(silent ? 'Résumé mis à jour par l’IA' : 'Résumé mis à jour');
  return data.summary;
}

/**
 * Résumés en attente (IA saturée) : gardés dans le navigateur avec l'heure du prochain essai,
 * réessayés de plus en plus tard (1, 2, 5, 10, 20, puis toutes les 30 min, 12 essais au plus).
 */
const BUSY = /satur|surcharg|high demand|overload|unavailable|503|429|réessaie dans quelques minutes|failed to (send|fetch)|networkerror|load failed/i;
const WAITS = [1, 2, 5, 10, 20, 30];
const hhmm = t => new Date(t).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'});
// File séparée par environnement (js/storage.js) ; en plus, chaque entrée porte son environnement : une entrée d'un autre
// environnement, ou ancienne sans marque, est jetée sans être exécutée (un résumé du test ne part jamais en production).
const readQueue = () => {
  let q = {}; try { q = JSON.parse(localGet('summaryRetry') || '{}') || {}; } catch { return {}; }
  const ok = Object.fromEntries(Object.entries(q).filter(([, x]) => x && x.env === ENV));
  if (Object.keys(ok).length !== Object.keys(q).length){
    writeQueue(ok);
    toast('Un résumé IA en attente (ancienne version ou espace de test) a été annulé : clique « Mettre à jour avec l’IA » sur le suivi pour le relancer', true);
  }
  return ok;
};
const writeQueue = q => localSet('summaryRetry', JSON.stringify(q));
let RETRY_TIMER = null, RETRYING = false;   // un seul passage d'essais à la fois
function queueSummary(pid){
  const q = readQueue(), n = (q[pid]?.n || 0) + 1;
  if (n > 12){ delete q[pid]; writeQueue(q); toast('Résumé IA abandonné après plusieurs essais : clique « Mettre à jour avec l’IA » plus tard', true); return Date.now(); }
  const at = Date.now() + WAITS[Math.min(n - 1, WAITS.length - 1)] * 60000;
  q[pid] = {n, at, env: ENV}; writeQueue(q); planRetries();
  return at;
}
function dropSummary(pid){ const q = readQueue(); if (q[pid]){ delete q[pid]; writeQueue(q); } }
/** Prochain essai prévu pour ce suivi (heure), ou null */
export const summaryRetryAt = pid => readQueue()[pid]?.at || null;
export function planRetries(){
  if (RETRYING) return;   // le passage en cours reprogramme lui-même la suite
  clearTimeout(RETRY_TIMER);
  const q = readQueue(), next = Math.min(...Object.values(q).map(x => x.at));
  if (!Number.isFinite(next)) return;
  RETRY_TIMER = setTimeout(async () => {
    if (!S.user || !S.dataLoaded){ RETRY_TIMER = setTimeout(planRetries, 30000); return; }
    const now = Date.now();
    RETRYING = true;
    try {
      for (const [pid, x] of Object.entries(readQueue())){
        if (x.at > now) continue;
        if (!byId('prospects', pid)){ dropSummary(pid); continue; }
        await refreshSummary(pid);
      }
    } finally { RETRYING = false; }
    planRetries();
  }, Math.max(1000, next - Date.now()));
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
  if (add.length){ const rows = add.map(x=>({[col]:id,[other]:x})); const {error}=await sb.from('contact_structures').insert(rows); if(!error){ S.db.contact_structures.push(...rows.filter(r => !S.db.contact_structures.some(l => l.contact_id === r.contact_id && l.structure_id === r.structure_id))); touch('contact_structures'); } else toast(error.message,true); }
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
    if (owner.prospect_id) await emlToJournal(owner.prospect_id, file);
  }
  if (ok) toast(`${ok} fichier(s) ajouté(s)`);
  return ok;
}

/**
 * Mail glissé dans un suivi (.eml) : en plus de la pièce jointe, une entrée « Mail » au journal
 * (date du mail, interlocuteur, objet et texte, sans l'historique cité). Un mail déjà au journal n'est pas ajouté deux fois.
 */
async function emlToJournal(pid, file){
  const {isEml, readEml} = await import('./eml.js');
  if (!isEml(file)) return;
  let m; try { m = await readEml(file); } catch { return toast(`${file.name} : mail illisible, gardé en pièce jointe`, true); }
  const p = byId('prospects', pid); if (!p) return;
  const dom = e => e.split('@')[1] || '';
  const ours = e => !!e && (CFG.TEAM.includes(e) || dom(e) === dom(S.user?.email || ''));
  const sent = ours(m.from);
  const mail = sent ? m.to : m.from, name = sent ? m.toName : m.fromName;
  const contacts = linksOfStructure(p.structure_id);
  const c = contacts.find(x => [x.email, x.email_2].some(e => e && e.toLowerCase() === mail));
  const body = `${sent ? 'Envoyé' : 'Reçu'}${m.subject ? ` — **${m.subject}**` : ''}\n\n${m.text || '(mail sans texte)'}`;
  const date = m.date || new Date().toISOString().slice(0, 10);
  if (S.db.prospect_logs.some(l => l.prospect_id === pid && l.date === date && l.body === body)) return;
  const row = await insert('prospect_logs', {prospect_id: pid, date, kind: 'Mail', contact_name: c?.display_name || name || mail || null,
    contact_id: c?.id || null, body, author: S.user?.email});
  if (row){
    toast('Mail ajouté au journal');
    if (!p.last_contact || date > p.last_contact) await save('prospects', pid, {last_contact: date}, {rerender: false});
  }
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
