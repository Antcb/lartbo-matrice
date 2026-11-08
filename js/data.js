/**
 * Accès à la base Supabase : chargement, enregistrement, création, suppression, envoi de fichiers.
 * Toute modification passe par save / insert / remove, qui tiennent les index à jour (touch).
 */
import { render } from './app.js';
import { CFG, ENV } from './config.js';
import { TEAM_NAMES } from './constants.js';
import { LINGER_MS } from './constants.js';
import { byId, linksOfStructure, prospectTitle } from './selectors.js';
import { S, TABLES, localGet, localSet, touch } from './state.js';
import { runAct, toast, today } from './utils.js';

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
    if (error) { if (!/does not exist|schema cache/.test(error.message)) toast(`Chargement ${table} : ${error.message}`, true); return out; }
    out = out.concat(data); if (data.length < size) return out; from += size;
  }
}

let saveGuard = null, saveComplement = null, saveConfirm = null;
/** Confirmation demandée avant certains enregistrements (installée par actions.js : changement de cachet / % / mode d'une date qui
 *  a déjà des factures émises ou des commissions versées, lot D1) ; renvoie false = rien n'est écrit */
export const setSaveConfirm = f => { saveConfirm = f; };
/** Garde-fou appelé avant chaque enregistrement (installé par actions.js : calc.changeBlocked) ; message = refus */
export const setSaveGuard = f => { saveGuard = f; };
/** Compléments écrits avec un enregistrement (installé par actions.js : calc.freezeOnEmit — montant du solde figé à l'émission) */
export const setSaveComplement = f => { saveComplement = f; };

export async function save(table, id, patch, {rerender=true}={}){
  const why = saveGuard ? saveGuard(table, id, patch) : '';
  if (why){ toast(why, true); render(); return null; }   // refus : rien n'est écrit, l'affichage revient à la valeur enregistrée
  if (saveConfirm && !(await saveConfirm(table, id, patch))){ render(); return null; }   // avertissement refusé : rien n'est écrit
  if (saveComplement) patch = {...patch, ...saveComplement(table, id, patch)};
  const row = byId(table, id); const before = row ? {...row} : null;
  if (row) Object.assign(row, patch);
  touch(table);
  const {data, error} = await sb.from(table).update(patch).eq('id', id).select().single();
  if (error){ if (row) Object.assign(row, before); touch(table); toast('Enregistrement impossible : '+error.message, true); render(); return null; }
  if (row) Object.assign(row, data); else if (data) S.db[table].push(data);
  touch(table);
  summaryAfter(table, row || data);
  if (table==='shows' && (patch.status || patch.project_id)) await refreshShowSide(id);
  if (table==='shows' && ('ticketing_type' in patch || 'department' in patch || 'structure_id' in patch || 'cnm_bearer' in patch || 'contract_type' in patch)) await (await import('./budget-actions.js')).syncCnmLine(id);
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
  if (!before) { S.linger.delete(id); return false; }   // refusé ou en échec : l'appelant le sait
  // suite liée (ex. relances retirées) : seulement si l'enregistrement a réussi, et défaite avec « Annuler »
  const extra = after ? await after() : null;
  const undo = {}; Object.keys(patch).forEach(k => undo[k] = before[k] ?? null);
  toast(message, false, {label:'Annuler', fn: async () => { S.linger.delete(id); await save(table, id, undo); if (onUndo) await onUndo(extra); render(); }});
  setTimeout(() => { if (S.linger.has(id) && S.linger.get(id) <= Date.now() + 50){ S.linger.delete(id); render(); } }, LINGER_MS + 100);
  return true;
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
  const {data, error} = await insertRow(table, values);
  if (error){ toast('Création impossible : '+error.message, true); return null; }
  return data;
}
/** Création sans message (v1.60.4) : {data, error} ; l'appelant explique l'échec (ex. doublon d'import_key, code 23505) */
export async function insertRow(table, values){
  const {data, error} = await sb.from(table).insert(values).select().single();
  if (error) return {data: null, error};
  // la ligne a pu arriver avant par la mise à jour automatique : on la remplace au lieu de l'ajouter deux fois
  const i = data?.id != null ? S.db[table].findIndex(r => r.id === data.id) : -1;
  if (i >= 0) S.db[table][i] = data; else S.db[table].push(data);
  touch(table);
  summaryAfter(table, data);
  if (table==='shows') await refreshShowSide(data.id);
  return {data, error: null};
}

export async function remove(table, id){
  const why = saveGuard ? saveGuard(table, id, null) : '';   // suppression : même garde-fou (facture émise, date facturée)
  if (why){ toast(why, true); return false; }
  const before = byId(table, id);
  const {error} = await sb.from(table).delete().eq('id', id);
  if (error){ toast('Suppression impossible : '+dbErrorText(error), true); return false; }
  S.db[table] = S.db[table].filter(r => r.id !== id); touch(table);
  summaryAfter(table, before);
  return true;
}

/** Message d'erreur de la base pour l'utilisateur (v1.60.3) : jamais le texte technique d'une clé étrangère (code 23503) */
export const dbErrorText = error => error?.code === '23503'
  ? 'cet élément est encore relié à d’autres données de la Matrice (historique, tâches ou documents). Rien n’a été supprimé.'
  : error?.message || 'erreur inconnue';
/** Fonction serveur absente (migration pas encore appliquée) */
const missingFunction = error => error?.code === 'PGRST202' || /Could not find the function|schema cache/i.test(error?.message || '');

/** Ce que la suppression d'une date ferait, vu par le serveur (v1.60.3, fonction show_deletion_state) :
 *  {blocked: [motifs], payments, budget_lines, tasks, closures} ; null si le serveur n'a pas encore la fonction ou ne répond pas. */
export async function showDeletionState(id){
  const {data, error} = await sb.rpc('show_deletion_state', {p_show: id});
  if (error) return missingFunction(error) ? null : {blocked: [error.code === 'P0001' ? error.message : 'Suppression impossible : ' + dbErrorText(error)]};
  return data;
}

/**
 * Suppression contrôlée d'une date (v1.60.3, demande d'Anthony du 07/11) : fonction serveur delete_show — refus motivés (résultat
 * clôturé, factures émises, documents Pennylane, pièces à rattacher…), copie complète dans le journal des suppressions (historique de
 * clôture / réouverture compris), tâches gardées sans lien, puis la date avec ses lignes de facturation (aucune émise) et de budget.
 * Même garde-fou que remove (calc.changeBlocked) avant tout appel. Serveur sans la fonction (migration pas encore appliquée) :
 * suppression directe comme avant, erreur de clé étrangère traduite.
 */
export async function deleteShow(id){
  const why = saveGuard ? saveGuard('shows', id, null) : '';
  if (why){ toast(why, true); return false; }
  const {data, error} = await sb.rpc('delete_show', {p_show: id});
  if (error && missingFunction(error)) return remove('shows', id);
  if (error){ toast(error.code === 'P0001' ? error.message : 'Suppression impossible : ' + dbErrorText(error), true); return false; }
  for (const t of ['show_payments', 'budget_lines', 'pennylane_a_rattacher']) if (S.db[t]){ S.db[t] = S.db[t].filter(r => r.show_id !== id); touch(t); }
  S.db.shows = S.db.shows.filter(r => r.id !== id); touch('shows');
  // tâches gardées, détachées, avec la mention « Date supprimée le … » en tête de leur note (écrite par le serveur) : relues
  const tids = data?.task_ids || S.db.tasks.filter(t => t.show_id === id).map(t => t.id);
  S.db.tasks.forEach(t => { if (t.show_id === id) t.show_id = null; }); touch('tasks');
  if (tids.length) await refreshFor('tasks', 'id', tids);
  return data || true;
}

/** Archivage d'une date (v1.60.3, fonction serveur archive_show) : motif obligatoire ; refus du serveur affiché tel quel */
export async function archiveShow(id, reason){
  const {error} = await sb.rpc('archive_show', {p_show: id, p_reason: reason});
  if (error){ toast(missingFunction(error) ? 'L’archivage des dates n’est pas encore installé sur le serveur.' : error.code === 'P0001' ? error.message : 'Archivage impossible : ' + dbErrorText(error), true); return false; }
  // la date reste dans les données (vues financières) ; ses notifications sont retirées de la liste active par le serveur
  await refreshFor('shows', 'id', [id]); await refreshFor('notifications', 'show_id', [id]);
  return true;
}
/** Réactivation explicite des relances d'une date restaurée (fonction serveur reactivate_reminders) : next = {relance: 'AAAA-MM-JJ'} */
export async function reactivateReminders(id, next){
  const {error} = await sb.rpc('reactivate_reminders', {p_show: id, p_next: next});
  if (error){ toast(error.code === 'P0001' ? error.message : 'Réactivation impossible : ' + dbErrorText(error), true); return false; }
  await refreshFor('shows', 'id', [id]);
  return true;
}
/** Restauration d'une date archivée (fonction serveur restore_show) : elle revient partout, avec ses lignes */
export async function restoreShow(id){
  const {error} = await sb.rpc('restore_show', {p_show: id});
  if (error){ toast(error.code === 'P0001' ? error.message : 'Restauration impossible : ' + dbErrorText(error), true); return false; }
  await refreshFor('shows', 'id', [id]); await refreshFor('notifications', 'show_id', [id]);
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
/** Fichiers stockés (espace « suivi ») d'un élément supprimé : effacés APRÈS la suppression réussie de ses lignes (§4.4, v1.46b).
 *  Un échec est signalé, jamais silencieux. Les fichiers Google Drive ne sont jamais touchés. */
export async function purgeStored(paths){
  paths = [...new Set((paths || []).filter(Boolean))];
  if (!paths.length) return true;
  const {error} = await sb.storage.from('suivi').remove(paths);
  if (error){ toast(`Supprimé, mais ${paths.length > 1 ? paths.length + ' fichiers n’ont' : '1 fichier n’a'} pas pu être effacé${paths.length > 1 ? 's' : ''} du stockage : ${error.message}`, true); return false; }
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
  if (add.length){ const rows = add.map(x=>({[col]:id,[other]:x})); const {error}=await sb.from('contact_structures').insert(rows); if(!error){ S.db.contact_structures.push(...rows.filter(r => !S.db.contact_structures.some(l => l.contact_id === r.contact_id && l.structure_id === r.structure_id))); touch('contact_structures'); } else toast(error.message,true); }
  for (const x of del){ await sb.from('contact_structures').delete().eq(col,id).eq(other,x); S.db.contact_structures = S.db.contact_structures.filter(l=>!(l[col]===id && l[other]===x)); }
  touch('contact_structures');
}

/**
 * Type d'un fichier envoyé au stockage : celui donné par le navigateur, sinon déduit de l'extension pour les photos et PDF
 * (v1.60.2 : une photo arrivée sans type était enregistrée en « application/octet-stream » et se téléchargeait au lieu de s'afficher).
 * Même correspondance que la fonction serveur lire-piece.
 */
const EXT_TYPES = {jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf', eml: 'message/rfc822'};
export const contentTypeOf = f => f?.type || EXT_TYPES[(String(f?.name || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()] || 'application/octet-stream';
/**
 * Fichier tel qu'envoyé au stockage, avec son type DANS le fichier (v1.60.3) : la bibliothèque Supabase envoie un fichier
 * en formulaire et ignore alors l'option contentType ; sans cela, un .eml ou une photo arrivés sans type restaient « octet-stream ».
 */
export const typedFile = f => { const type = contentTypeOf(f); return f.type === type ? f : new File([f], f.name, {type, lastModified: f.lastModified}); };
/**
 * Motif lisible d'un envoi au stockage qui n'a pas abouti à cause du réseau (« Failed to fetch ») : fichier devenu illisible
 * (fichier temporaire d'une autre application effacé ou modifié) ou connexion au serveur impossible.
 */
export async function uploadFailure(file, err){
  let readable = true; try { await file.slice(0, 1).arrayBuffer(); } catch { readable = false; }
  const why = readable ? `connexion au stockage impossible (${err?.message || 'réseau'})` : 'le fichier n’est plus lisible par le navigateur : l’application d’où il vient l’a effacé ou modifié';
  const data = {lisible: readable, erreur: `${err?.name || ''}: ${err?.message || ''}`,
    ext: (String(file.name || '').match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase() || '', taille: file.size, type: file.type || ''};
  console.info('[Matrice] envoi au stockage : échec réseau', JSON.stringify(data));
  window.dispatchEvent(new CustomEvent('matrice-diag', {detail: {key: 'envoi au stockage : échec réseau', data}}));
  return why;
}

const safeName = n => n.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w.\-]+/g,'_') || 'fichier';

/** Suivi qui porte déjà cette clé import_key dans la table (S.db puis la base : reconnu après rechargement ou depuis un autre poste), ou null */
async function keyOwner(table, key){
  const local = S.db[table].find(r => r.import_key === key);
  if (local) return local.prospect_id;
  const {data} = await sb.from(table).select('prospect_id').eq('import_key', key);
  return data?.[0]?.prospect_id || null;
}
/** Suivi auquel un mail est déjà joint (clé « msgid:<Message-ID> » sur l'original ou le journal), ou null (v1.60.4) */
export async function mailAttachedTo(key){
  return await keyOwner('prospect_files', key) || await keyOwner('prospect_logs', key);
}

/**
 * Mails joints AVANT la v1.60.4 (fichier .eml dans un suivi, sans clé import_key) : reconnus par le Message-ID lu dans le fichier
 * déjà stocké — LECTURE SEULE (téléchargement du début du fichier ; rien n'est modifié en base ni dans le stockage, aucune clé
 * ajoutée aux lignes historiques). Seule une lecture RÉUSSIE est gardée pour la session ; un échec est relu à la vérification
 * suivante (relecture de 3ca7f59, B2). {owner : suivi qui le porte | null, incomplete : '' ou motif (fichiers illisibles, plus de
 * LEGACY_SCAN_MAX fichiers) — vérification incomplète, à annoncer avant tout rattachement}.
 */
const LEGACY_IDS = new Map();
export const LEGACY_SCAN_MAX = 300;
const legacyEml = f => !f.import_key && (f.mime === 'message/rfc822' || /\.eml$/i.test(f.name || ''));
export async function legacyMailOwner(msgId){
  const {messageIdOf} = await import('./eml.js');
  const all = S.db.prospect_files.filter(legacyEml).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  let unread = 0;
  for (const f of all.slice(0, LEGACY_SCAN_MAX)){
    if (!LEGACY_IDS.has(f.path)){
      let ok = false, id = '';
      try { const {data, error} = await sb.storage.from('suivi').download(f.path); if (data && !error){ id = messageIdOf(await data.slice(0, 65536).text()); ok = true; } } catch { ok = false; }
      if (!ok){ unread++; continue; }       // échec : rien n'est mémorisé, relu la prochaine fois
      LEGACY_IDS.set(f.path, id);
    }
    if (LEGACY_IDS.get(f.path) === msgId) return {owner: f.prospect_id, incomplete: ''};
  }
  const why = [unread && `${unread} fichier${unread > 1 ? 's' : ''} .eml joint${unread > 1 ? 's' : ''} avant la v1.60.4 illisible${unread > 1 ? 's' : ''} pour le moment`,
    all.length > LEGACY_SCAN_MAX && `${all.length - LEGACY_SCAN_MAX} fichier${all.length - LEGACY_SCAN_MAX > 1 ? 's' : ''} .eml ancien${all.length - LEGACY_SCAN_MAX > 1 ? 's' : ''} non vérifié${all.length - LEGACY_SCAN_MAX > 1 ? 's' : ''} (plus de ${LEGACY_SCAN_MAX})`].filter(Boolean).join(', ');
  return {owner: null, incomplete: why};
}
/** Avertissement d'une vérification incomplète des anciens .eml : vrai seulement si l'utilisateur choisit de joindre quand même */
export async function legacyUnverifiedOk(why, name){
  const {confirmAsk} = await import('./ui/dialog.js');
  return confirmAsk('Vérification incomplète', `Impossible de vérifier entièrement si « ${name} » est déjà joint à un suivi : ${why}.\nSi tu joins quand même, ce mail pourrait se retrouver en double. Tu peux aussi annuler et réessayer plus tard.`, 'Joindre quand même');
}

/**
 * Ce qui est déjà joint d'un mail dans un suivi (v1.60.4, relecture) — clé par clé : original (msgid:<id>), journal (même clé, ou
 * même entrée d'avant la v1.60.4), pièces extraites (msgid:<id>:pj:<n>). {other: suivi qui en porte déjà une partie | null,
 * original, log : à ajouter (booléens), pj : numéros des pièces à ajouter}. Un import partiel se COMPLÈTE au dépôt suivant.
 */
export async function mailParts(pid, key, m){
  const orig = await keyOwner('prospect_files', key), log = await keyOwner('prospect_logs', key);
  const pjOwners = [];
  for (let i = 1; i <= m.attachments.length; i++) pjOwners.push(await keyOwner('prospect_files', `${key}:pj:${i}`));
  let other = [orig, log, ...pjOwners].find(x => x && x !== pid) || null;
  const inLog = !!emlEntry(pid, m)?.exists;
  // joint avant la v1.60.4 (aucune clé) : reconnu par la même entrée au journal de ce suivi, ou par le Message-ID du .eml déjà
  // stocké (dans ce suivi ou un autre, lecture seule) — refusé comme doublon, rien n'est rajouté ni modifié
  let legacy = false, unverified = '';
  if (!orig && !log && !pjOwners.some(Boolean)){
    const r = inLog ? {owner: pid, incomplete: ''} : await legacyMailOwner(key.replace(/^msgid:/, ''));
    if (r.owner && r.owner !== pid) other = r.owner; else if (r.owner) legacy = true;
    unverified = r.owner ? '' : r.incomplete;
  }
  return {other, legacy, unverified, original: !orig, log: !log && !inLog, pj: pjOwners.map((o, i) => o ? 0 : i + 1).filter(Boolean)};
}
export const mailPartsMissing = st => st.original || st.log || st.pj.length > 0;
const otherText = where => `déjà joint au suivi « ${prospectTitle(byId('prospects', where) || {name: 'autre suivi'})} » (même Message-ID) : rien n’a été ajouté`;
const DUP_NOW = 'déjà joint par ailleurs au même moment (autre poste ou autre onglet) : rien n’a été ajouté';
const skippedText = n => `${n} pièce${n > 1 ? 's' : ''} du mail non extraite${n > 1 ? 's' : ''} (plus de 20, ou trop imbriquée${n > 1 ? 's' : ''}) : l’original .eml les contient`;

/**
 * Envoi d'UN fichier au stockage puis sa ligne (prospect_files / attachments) : [true] ou [false, motif].
 * Ligne refusée (doublon d'import_key enregistré au même moment ailleurs, ou autre refus) : le fichier qui vient d'être envoyé est
 * effacé du stockage (aucun fichier orphelin), motif en français (v1.60.4, relecture).
 */
async function storeOne(table, folder, owner, file, extra = {}){
  const path = `${folder}/${Date.now()}_${safeName(file.name)}`;
  if (!file.size) return [false, 'fichier vide ou illisible (un élément glissé depuis une messagerie n’est pas toujours un vrai fichier)'];
  const type = contentTypeOf(file);
  // (v1.60.3) une erreur réseau (« Failed to fetch ») n'est plus une exception non traitée qui arrête tout l'envoi :
  // elle est expliquée dans le bilan, fichier par fichier
  let error;
  try { ({error} = await sb.storage.from('suivi').upload(path, typedFile(file), {contentType: type, upsert:false})); }
  catch (err){ return [false, await uploadFailure(file, err)]; }
  if (error) return [false, error.message];
  const r = await insertRow(table, {...owner, ...extra, name:file.name, path, size:file.size, mime: type === 'application/octet-stream' ? (file.type || null) : type});
  if (!r.error) return [true];
  const purged = await sb.storage.from('suivi').remove([path]).then(x => !x?.error, () => false);
  const why = r.error.code === '23505' ? DUP_NOW : `enregistrement refusé : ${dbErrorText(r.error)}`;
  return [false, purged ? why : `${why} (et le fichier envoyé n’a pas pu être effacé du stockage)`];
}

/**
 * Envoi de fichiers dans le stockage privé « suivi ».
 * owner : {prospect_id} pour un suivi, {task_id} ou {project_id[, project_log_id]} pour les autres pièces jointes.
 * Mail (.eml) dans un suivi (v1.60.4, même chemin pour un .eml déposé et pour un message retrouvé par son lien « message: ») :
 *  - clé « msgid:<Message-ID> » (en-tête du mail, ou owner.import_key) vérifiée en base, partie par partie (mailParts) :
 *    joint à un autre suivi → refusé ; complet dans ce suivi → refusé ; partiel → seules les parties manquantes sont ajoutées ;
 *  - original .eml conservé en pièce jointe (avec la clé), entrée « Mail » au journal (objet, date, De / À / Cc, texte ; même clé),
 *    pièces jointes du mail extraites en pièces du suivi (clé « msgid:<Message-ID>:pj:<n> ») ; pièces non extraites annoncées.
 */
export async function uploadFiles(owner, files){
  if (typeof owner === 'string') owner = {prospect_id: owner};
  // legacy_ok : avertissement « vérification incomplète » déjà accepté (parcours du lien message:), pas de seconde question
  const {import_key: givenKey = null, legacy_ok: legacyOk = false, ...base} = owner;
  const pid = base.prospect_id;
  const table = pid ? 'prospect_files' : 'attachments';
  const folder = pid || (base.task_id ? 'task/' + base.task_id : 'project/' + base.project_id);
  toast(`Envoi de ${files.length} fichier(s)…`);
  let ok = 0, elsewhere = null; const done = [], failed = [];
  const eml = pid ? await import('./eml.js') : null;
  for (const file of files){
    let mail = null;
    if (eml?.isEml(file)){ try { mail = await eml.readEml(file); } catch { toast(`${file.name} : mail illisible, gardé en pièce jointe`, true); } }
    const key = givenKey || (mail && eml.msgIdOk(mail.messageId) ? 'msgid:' + mail.messageId : null);
    let plan = {original: true, log: true, pj: (mail?.attachments || []).map((_, i) => i + 1)};
    if (key && mail){
      plan = await mailParts(pid, key, mail);
      if (plan.other){ failed.push([file.name, otherText(plan.other)]); elsewhere = elsewhere || plan.other; continue; }
      if (plan.legacy){ failed.push([file.name, 'déjà au journal de ce suivi (joint avant la v1.60.4) : rien n’a été ajouté']); continue; }
      // anciens .eml pas tous vérifiables : jamais de rattachement sans avertissement explicite
      if (plan.unverified && !legacyOk && !(await legacyUnverifiedOk(plan.unverified, file.name))){ failed.push([file.name, `non joint : vérification incomplète (${plan.unverified})`]); continue; }
      if (!mailPartsMissing(plan)){ failed.push([file.name, 'déjà joint à ce suivi en entier (même Message-ID) : rien n’a été ajouté']); continue; }
    } else if (key){ const where = await mailAttachedTo(key); if (where){ failed.push([file.name, where === pid ? 'déjà joint à ce suivi (même Message-ID) : rien n’a été ajouté' : otherText(where)]); if (where !== pid) elsewhere = elsewhere || where; continue; } }
    if (plan.original){
      const [stored, why] = await storeOne(table, folder, base, file, key ? {import_key: key} : {});
      if (!stored){ failed.push([file.name, why]); continue; }
      ok++; done.push(file.name);
    } else done.push(`${file.name} : déjà joint, complété`);
    if (!mail) continue;
    if (plan.log){ const why = await mailToJournal(pid, mail, key); if (why) failed.push([`${file.name} (entrée du journal)`, why]); }
    for (const i of plan.pj){
      const a = mail.attachments[i - 1], f = new File([a.bytes], a.name, {type: a.type});
      const [aok, awhy] = await storeOne(table, folder, base, f, key ? {import_key: `${key}:pj:${i}`} : {});
      if (aok){ ok++; done.push(`${a.name} (pièce du mail)`); } else failed.push([`${a.name} (pièce du mail)`, awhy]);
    }
    if (mail.attachmentsSkipped) failed.push([file.name, skippedText(mail.attachmentsSkipped)]);
  }
  // bilan qui reste affiché tant qu'on ne le ferme pas : fichiers ajoutés et refusés, avec le motif (v1.53, aucune perte silencieuse)
  if (failed.length){
    const {ask, inform} = await import('./ui/dialog.js');
    const title = `${ok} fichier${ok > 1 ? 's' : ''} ajouté${ok > 1 ? 's' : ''}, ${failed.length} refusé${failed.length > 1 ? 's' : ''}`;
    const text = [...done.map(n => `✓ ${n}`), ...failed.map(([n, why]) => `✗ ${n} — ${why}`)].join('\n');
    // (v1.60.4) mail déjà rattaché à un autre suivi : accès direct à ce suivi (action existante « openSuivi »)
    if (elsewhere){ if (await ask({title, text, actions: [{value: true, label: 'Ouvrir le suivi concerné'}], cancel: 'Fermer'})) runAct('openSuivi', elsewhere); }
    else await inform({title, text});
  } else if (ok) toast(`${ok} fichier${ok > 1 ? 's' : ''} ajouté${ok > 1 ? 's' : ''} : ${done.join(', ')}`);
  return ok;
}

/**
 * Entrée « Mail » du journal d'un suivi pour un mail lu (readEml) : date du mail, interlocuteur, objet, participants (De / À / Cc)
 * et texte (sans l'historique cité). exists : la même entrée est déjà au journal du suivi (même date et même texte, y compris
 * sous la forme d'avant la v1.60.4, sans les participants). Sert au dépôt d'un .eml et au message retrouvé par son lien.
 */
export function emlEntry(pid, m){
  const p = byId('prospects', pid); if (!p) return null;
  const dom = e => e.split('@')[1] || '';
  const ours = e => !!e && (CFG.TEAM.includes(e) || dom(e) === dom(S.user?.email || ''));
  const sent = ours(m.from);
  const mail = sent ? m.to : m.from, name = sent ? m.toName : m.fromName;
  const contacts = linksOfStructure(p.structure_id);
  const c = contacts.find(x => [x.email, x.email_2].some(e => e && e.toLowerCase() === mail));
  const head = `${sent ? 'Envoyé' : 'Reçu'}${m.subject ? ` — **${m.subject}**` : ''}`, text = m.text || '(mail sans texte)';
  const who = [['De', m.fromLine], ['À', m.toLine], ['Cc', m.ccLine]].filter(([, v]) => v).map(([k, v]) => `**${k} :** ${v}`).join(' · ');
  const body = `${head}${who ? `\n${who}` : ''}\n\n${text}`, legacy = `${head}\n\n${text}`;
  const date = m.date || today();   // jour de Paris (§1.2)
  return {row: {prospect_id: pid, date, kind: 'Mail', contact_name: c?.display_name || name || mail || null, contact_id: c?.id || null, body},
    exists: S.db.prospect_logs.some(l => l.prospect_id === pid && l.date === date && (l.body === body || l.body === legacy))};
}

/** Entrée « Mail » au journal pour un mail joint au suivi ; importKey : clé anti-doublon « msgid:<Message-ID> » (v1.60.4).
 *  Renvoie '' (ajoutée ou déjà présente) ou le motif d'échec, en français (repris dans le bilan). */
async function mailToJournal(pid, m, importKey = null){
  const p = byId('prospects', pid); if (!p) return 'suivi introuvable';
  const e = emlEntry(pid, m); if (!e || e.exists) return '';
  const {date} = e.row;
  const {data: row, error} = await insertRow('prospect_logs', {...e.row, author: S.user?.email, ...(importKey ? {import_key: importKey} : {})});
  if (error) return error.code === '23505' ? DUP_NOW : `enregistrement refusé : ${dbErrorText(error)}`;
  toast('Mail ajouté au journal');
  if (!p.last_contact || date > p.last_contact) await save('prospects', pid, {last_contact: date}, {rerender: false});
  return '';
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
