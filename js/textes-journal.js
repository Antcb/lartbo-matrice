/**
 * Texte intégral des mails dans le journal d'un suivi (v1.66, demande d'Anthony du 20/11/2026) : chaque entrée « mail » affiche le
 * texte complet du message, sans clic ni limite de longueur, sans l'historique cité (js/texte-mail.js ownText).
 * Sources, dans cet ordre, en gardant les droits d'accès existants :
 *  1. .eml joint au suivi (même clé « msgid:<Message-ID> ») : lisible par l'équipe comme le fichier → prospect_logs.mail_text ;
 *  2. message de la boîte anthony@ (synchronisé) : lisible SEULEMENT par le titulaire, comme les messages eux-mêmes →
 *     private.mail_textes, par les fonctions mail_texte_lire / mail_texte_ecrire (titulaire vérifié dans la base : is_mailbox_owner) ;
 *     jamais recopié dans le journal, jamais sauvegardé ni exporté (décision d'Anthony du 20/11/2026).
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

const BODY = new Map();    // id de l'entrée → texte complet lu dans la boîte anthony@ (compte titulaire seulement, en mémoire ; vidé par le
                           // rechargement de la page à la déconnexion ou au changement de compte : js/app.js)
const STATE = new Map();   // id de l'entrée → 'lecture' | 'reserve' | 'inaccessible' | 'introuvable'
const BUSY = new Set();    // suivis en cours de lecture

/** Entrée qui est la copie d'un mail (synchronisé ou importé) ; un mail envoyé depuis MATRICE garde son HTML complet (body_html) */
export const isMailCopy = l => !!l && l.kind === 'Mail' && !l.body_html && (l.author === 'Messagerie' || !!l.gmail_message_id || /^msgid:</.test(l.import_key || ''));
export const fullTextOf = l => (l && (l.mail_text || BODY.get(l.id))) || null;
export const textState = id => STATE.get(id) || '';

/**
 * Note manuelle d'une entrée mail (v1.66, décision d'Anthony du 20/11/2026 : affichée À PART du texte intégral, jamais écrasée).
 * Le texte de l'entrée (body) n'est jamais modifié ; on retire seulement de l'affichage l'extrait écrit automatiquement (début du
 * texte intégral, lignes consécutives). En cas de doute, la ligne est montrée dans la note : rien de ce qu'a écrit l'équipe n'est caché.
 *  - mail synchronisé (auteur « Messagerie ») : 1re ligne = en-tête, 2e = extrait Gmail (peut déborder sur l'historique cité : il suffit
 *    que son début soit dans le texte intégral) ;
 *  - mail importé : 1er paragraphe = en-tête (objet, De, À), puis l'ancien résumé du message.
 */
export function manualNote(l, full){
  // (v1.66.1) l'ancien résumé vient de la partie TEXTE du mail, le texte intégral de la partie HTML : ce qui ne diffère que par la
  // forme est ramené au même texte des deux côtés avant comparaison (sinon l'extrait réapparaît en « Note », relecture v1.66.1) :
  // liens « <https://…> », « <mailto:…> », « <tel:…> », téléphones Gmail « <+33…> », images « [image: …] » et « [cid:…] »,
  // guillemets et apostrophes typographiques ou droits, tirets, espaces autour de la ponctuation, puces, points de suspension
  const norm = s => String(s || '')
    .replace(/\s*<(?:https?:|mailto:|tel:)[^>\s]*>/gi, '').replace(/\s*<\+?\d[\d .()-]*>/g, '').replace(/\[(?:image|cid):[^\]]*\]/gi, '')
    .replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/[«»“”„"]/g, '"').replace(/[’‘`´]/g, "'").replace(/[–—‐]/g, '-')
    .replace(/(?:…|\.\.\.)\s*$/, '').replace(/(^|\n)\s*(?:[-•·*]|\d{1,2}[.)])\s+/g, '$1').replace(/[*_>•·]/g, ' ')
    .replace(/\s*(["':;!?,.()\[\]])\s*/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase();
  const F = norm(full);
  const body = String(l.body || '').replace(/\r/g, '');
  const synced = l.author === 'Messagerie';
  const rest = synced ? body.split('\n').slice(1) : body.split('\n\n').slice(1).join('\n\n').split('\n');
  // (relecture v1.66, B6) l'extrait automatique est le DÉBUT du mail, dans l'ordre : on avance dans le texte intégral ligne après ligne ;
  // une ligne courte n'est automatique que si elle suit EXACTEMENT la précédente (jamais « OK », « lundi », « 12 » trouvés au hasard) ;
  // à la première ligne qui ne suit pas, tout le reste est la note (rien de ce qu'a écrit l'équipe n'est caché)
  // (relecture v1.66.1, B7) une ligne qui n'est vide qu'APRÈS normalisation (« <https://…> » seul, « [image: …] ») n'est automatique
  // que si une ligne reconnue la suit ; sinon elle appartient à la note (un lien noté à la main n'est jamais caché)
  // ancien résumé coupé à 6 000 caractères (js/eml.js) : sa dernière ligne peut finir au milieu d'un mot (relecture v1.66.1)
  const coupe = rest.join('\n').length >= 5900, last = rest.map(x => x.trim()).lastIndexOf(rest.filter(x => x.trim()).pop()?.trim());
  let off = 0, i = 0, pending = -1;
  for (; i < rest.length; i++){
    const n = norm(rest[i]);
    if (!n){ if (rest[i].trim() && pending < 0) pending = i; continue; }
    if (n === '(mail sans texte)'){ continue; }
    // extrait Gmail d'un mail synchronisé (une ligne, peut déborder sur l'historique cité) : son début est le début du mail
    if (synced && off === 0 && n.length >= 30){ const k = F.indexOf(n.slice(0, 30)); if (k >= 0 && k < 40){ off = F.length; pending = -1; continue; } }
    const k = F.indexOf(n, off);
    const sep = c => c === undefined || /[ "'.,;:!?()\[\]-]/.test(c);
    if (k >= 0 && !F.slice(off, k).trim() && (k === 0 || sep(F[k - 1]) || sep(n[0])) && (n.length >= 30 || sep(F[k + n.length]) || sep(n[n.length - 1]) || (coupe && i === last))){ off = k + n.length; pending = -1; continue; }
    break;
  }
  if (pending >= 0){
    // ligne « <https://…> » seule, collée à l'extrait (pas de ligne vide avant) et dont l'adresse figure déjà dans l'extrait : c'est
    // le lien d'une signature (partie texte du mail, cas du suivi pilote du 21/11/2026) ; tout autre lien seul reste dans la note
    const auto = rest.slice(0, pending).join('\n');
    let j = pending;
    while (j < i && rest[j].trim() && !norm(rest[j]) && rest[j - 1]?.trim()){
      const u = (rest[j].match(/<([^>\s]+)>/) || [])[1];
      if (!u || !auto.includes(u)) break;
      j++;
    }
    i = Math.min(i, j < i ? j : i);
  }
  return rest.slice(i).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

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
  const pick = 'id,prospect_log_id,gmail_message_id,thread_id';
  const ids = logs.map(l => l.id), gids = logs.map(l => l.gmail_message_id).filter(Boolean);
  const q1 = await sb.from('mail_messages').select(pick).in('prospect_log_id', ids);
  for (const m of q1.data || []) if (m.prospect_log_id) byLog.set(m.prospect_log_id, m);
  const lost = logs.filter(l => !byLog.has(l.id) && l.gmail_message_id);
  if (lost.length){
    const q2 = await sb.from('mail_messages').select(pick).in('gmail_message_id', gids);
    for (const l of lost){ const m = (q2.data || []).find(x => x.gmail_message_id === l.gmail_message_id); if (m) byLog.set(l.id, m); }
  }
  // textes déjà enregistrés (fonction de la base : seulement les messages dont ce compte est titulaire)
  const mids = [...new Set([...byLog.values()].map(m => m.id))];
  const saved = new Map();
  if (mids.length){
    const {data, error} = await sb.rpc('mail_texte_lire', {p_ids: mids});
    if (error) console.info('[Matrice] textes enregistrés illisibles (migration v1.66 pas encore appliquée ?)', error.code || '');
    for (const r of data || []) saved.set(r.message_id, r.body_text);
  }
  const need = new Map();   // conversation → entrées à lire
  for (const l of logs){
    const m = byLog.get(l.id);
    if (!m){ STATE.set(l.id, 'introuvable'); continue; }
    if (saved.get(m.id)){ BODY.set(l.id, saved.get(m.id)); STATE.delete(l.id); continue; }
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
      const t = g ? ownText({html: g.html, subject: g.subject || ''}) : '';
      if (!t){ STATE.set(l.id, 'introuvable'); continue; }
      BODY.set(l.id, t); STATE.delete(l.id);
      const {error} = await sb.rpc('mail_texte_ecrire', {p_id: m.id, p_text: t});   // jamais d'écrasement (vérifié dans la base)
      if (error) console.info('[Matrice] texte du message non enregistré', error.code || '');
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
      if (M.owner){ try { await fromMailbox(synced); } catch (e) { console.info('[Matrice] lecture des textes dans la boîte impossible', e?.name || ''); } }
      // boîte nommée seulement si elle est établie (entrée écrite par la synchronisation de anthony@)
      else synced.forEach(l => STATE.set(l.id, l.author === 'Messagerie' && !logSource(l).file ? 'reserve' : 'inaccessible'));
    }
    rest.filter(l => !fullTextOf(l) && STATE.get(l.id) === 'lecture').forEach(l => STATE.set(l.id, 'introuvable'));
  } finally { BUSY.delete(pid); }
  if (rerender) render();
}

/** Reprise d'un coup (compte titulaire) : tous les suivis dont une entrée mail n'a pas encore son texte complet */
let RUNNING = false;   // une seule reprise à la fois (double clic)
export async function completeAll(){
  if (RUNNING) return toast('Reprise des textes déjà en cours…');
  RUNNING = true;
  try { await completeAllRun(); } finally { RUNNING = false; }
}
async function completeAllRun(){
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
