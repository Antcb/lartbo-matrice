/**
 * Texte intégral des mails dans le journal d'un suivi (v1.66, demande d'Anthony du 20/11/2026) : chaque entrée « mail » affiche le
 * texte complet du message, sans clic ni limite de longueur, sans l'historique cité (js/texte-mail.js ownText).
 * Sources, dans cet ordre, en gardant les droits d'accès existants :
 *  1. .eml joint au suivi (même clé « msgid:<Message-ID> ») : lisible par l'équipe comme le fichier → prospect_logs.mail_text ;
 *  2. message de la boîte anthony@ (synchronisé) : lisible SEULEMENT par le titulaire, comme les messages eux-mêmes →
 *     mail_messages.body_text (même règle d'accès que mail_messages : is_mailbox_owner) ; jamais recopié dans le journal.
 * Rien n'est remplacé : body (texte actuel) reste tel quel ; seules les colonnes nouvelles, vides, sont complétées (migration v1.66).
 * Source introuvable ou réservée : le texte actuel est affiché, signalé « Extrait » avec la raison.
 * Reprise des entrées existantes : à l'affichage d'un suivi, ou d'un coup (« Compléter les textes du journal », compte titulaire).
 */
import { render } from './app.js';
import { sb } from './data.js';
import { M, checkOwner, logSource } from './mailbox.js';
import { callProspect } from './prospection.js';
import { byId, logsOf } from './selectors.js';
import { S } from './state.js';
import { toast } from './utils.js';

const BODY = new Map();    // id de l'entrée → texte complet lu dans la boîte anthony@ (compte titulaire seulement, en mémoire)
const STATE = new Map();   // id de l'entrée → 'lecture' | 'reserve' | 'inaccessible' | 'introuvable'
const BUSY = new Set();    // suivis en cours de lecture

/** Entrée qui est la copie d'un mail (synchronisé ou importé) ; un mail envoyé depuis MATRICE garde son HTML complet (body_html) */
export const isMailCopy = l => !!l && l.kind === 'Mail' && !l.body_html && (l.author === 'Messagerie' || !!l.gmail_message_id || /^msgid:</.test(l.import_key || ''));
export const fullTextOf = l => (l && (l.mail_text || BODY.get(l.id))) || null;
export const textState = id => STATE.get(id) || '';

/** Texte propre d'un .eml stocké, ou '' (fichier absent ou illisible) */
async function emlText(f){
  try {
    const {data, error} = await sb.storage.from('suivi').download(f.path);
    if (error || !data) return '';
    const {parseEml, rawOf} = await import('./eml.js');
    return parseEml(await rawOf(data)).full || '';
  } catch { return ''; }
}

/** Texte d'un .eml → prospect_logs.mail_text (seulement s'il est vide : rien n'est jamais écrasé) ; gardé en mémoire dans tous les cas */
async function saveMailText(l, t){
  l.mail_text = t;
  const {error} = await sb.from('prospect_logs').update({mail_text: t}).eq('id', l.id).is('mail_text', null);
  if (error) console.info('[Matrice] texte du mail non enregistré (migration v1.66 pas encore appliquée ?)', error.code || '');
}

/** Messages de la boîte anthony@ des entrées (compte titulaire) : texte déjà lu, sinon conversation relue dans Gmail */
async function fromMailbox(logs){
  const byLog = new Map();
  const pick = 'id,prospect_log_id,gmail_message_id,thread_id,body_text';
  const ids = logs.map(l => l.id), gids = logs.map(l => l.gmail_message_id).filter(Boolean);
  const q1 = await sb.from('mail_messages').select(pick).in('prospect_log_id', ids);
  for (const m of q1.data || []) if (m.prospect_log_id) byLog.set(m.prospect_log_id, m);
  const lost = logs.filter(l => !byLog.has(l.id) && l.gmail_message_id);
  if (lost.length){
    const q2 = await sb.from('mail_messages').select(pick).in('gmail_message_id', gids);
    for (const l of lost){ const m = (q2.data || []).find(x => x.gmail_message_id === l.gmail_message_id); if (m) byLog.set(l.id, m); }
  }
  const need = new Map();   // conversation → entrées à lire
  for (const l of logs){
    const m = byLog.get(l.id);
    if (!m){ STATE.set(l.id, 'introuvable'); continue; }
    if (m.body_text){ BODY.set(l.id, m.body_text); STATE.delete(l.id); continue; }
    if (!need.has(m.thread_id)) need.set(m.thread_id, []);
    need.get(m.thread_id).push([l, m]);
  }
  const {ownText} = await import('./texte-mail.js');
  for (const [tid, list] of need){
    const row = byId('mail_threads', tid);
    let msgs = null;
    try { if (row) msgs = (await callProspect('thread', {thread_id: row.gmail_thread_id})).thread?.messages || []; } catch { msgs = null; }
    for (const [l, m] of list){
      const g = (msgs || []).find(x => x.id === m.gmail_message_id);
      const t = g ? ownText({html: g.html}) : '';
      if (!t){ STATE.set(l.id, 'introuvable'); continue; }
      BODY.set(l.id, t); STATE.delete(l.id);
      await sb.from('mail_messages').update({body_text: t}).eq('id', m.id).is('body_text', null);
    }
  }
}

/** Complète les textes manquants d'un suivi (à l'affichage) ; retry : nouvel essai des entrées déjà marquées introuvables */
export async function ensureTexts(pid, {rerender = true, retry = false} = {}){
  if (BUSY.has(pid)) return;
  const todo = logsOf(pid).filter(l => isMailCopy(l) && !fullTextOf(l) && (retry ? STATE.get(l.id) !== 'lecture' : !STATE.has(l.id)));
  if (!todo.length) return;
  BUSY.add(pid);
  todo.forEach(l => STATE.set(l.id, 'lecture'));
  try {
    for (const l of todo){
      const {file} = logSource(l); if (!file) continue;
      const t = await emlText(file);
      if (t){ await saveMailText(l, t); STATE.delete(l.id); }
    }
    const rest = todo.filter(l => !fullTextOf(l));
    const synced = rest.filter(l => logSource(l).synced);
    if (synced.length){
      await checkOwner();
      if (M.owner) await fromMailbox(synced);
      // boîte nommée seulement si elle est établie (entrée écrite par la synchronisation de anthony@)
      else synced.forEach(l => STATE.set(l.id, l.author === 'Messagerie' && !logSource(l).file ? 'reserve' : 'inaccessible'));
    }
    rest.filter(l => !fullTextOf(l) && STATE.get(l.id) === 'lecture').forEach(l => STATE.set(l.id, 'introuvable'));
  } finally { BUSY.delete(pid); }
  if (rerender) render();
}

/** Reprise d'un coup (compte titulaire) : tous les suivis dont une entrée mail n'a pas encore son texte complet */
export async function completeAll(){
  await checkOwner();
  if (!M.owner) return toast('Réservé au compte d’Anthony (boîte anthony@).', true);
  const pids = [...new Set(S.db.prospect_logs.filter(l => isMailCopy(l) && !fullTextOf(l)).map(l => l.prospect_id))];
  if (!pids.length) return toast('Tous les mails du journal ont déjà leur texte complet.');
  let n = 0;
  for (const pid of pids){
    n++;
    if (n === 1 || n % 5 === 0) toast(`Textes des mails : suivi ${n}/${pids.length}…`);
    await ensureTexts(pid, {rerender: false, retry: true});
  }
  const left = S.db.prospect_logs.filter(l => isMailCopy(l) && !fullTextOf(l)).length;
  render();
  toast(`Textes des mails complétés${left ? ` ; ${left} entrée${left > 1 ? 's' : ''} sans source complète (extrait conservé)` : ''}.`);
}

export const TEXT_ACTIONS = { mailTexts: () => completeAll() };
