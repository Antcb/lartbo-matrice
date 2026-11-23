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
import { esc, toast } from './utils.js';
import { LINK_MARK, unlinked } from './texte-mail.js';

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
  const norm = s => unlinked(s)
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

/**
 * Texte intégral d'un mail affiché dans le journal (v1.66.5, demande d'Anthony du 23/11/2026) : texte échappé, avec liens cliquables —
 * mots qui étaient un lien dans le mail (« [mots](adresse) », js/texte-mail.js), adresses en clair (« https://… », « www.… »,
 * « <https://…> » des versions texte de Gmail) et adresses mail. Web, mail et téléphone seulement ; ouverts dans un autre onglet.
 */
const BARE = /(<)?((?:https?:\/\/|www\.)[^\s<>"]+|mailto:[^\s<>"]+|[\w.+-]{1,64}@[\w-]+(?:\.[\w-]+)+)(>)?/gi;
const A = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
function bareLinks(t){
  let out = '', i = 0;
  for (const m of t.matchAll(BARE)){
    let [all, lt, addr, gt] = m, end = m.index + all.length;
    if (gt && !lt){ gt = undefined; end -= 1; }   // « > » sans « < » : laissé dans le texte
    // ponctuation finale (« voir https://x.fr. ») et parenthèse fermante non ouverte : hors du lien
    if (!gt){ const tail = addr.match(/[.,;:!?'"»)\]]+$/); if (tail && !(tail[0].startsWith(')') && addr.includes('('))){ addr = addr.slice(0, -tail[0].length); end -= tail[0].length; } }
    const href = /^www\./i.test(addr) ? 'https://' + addr : /^(?:https?:|mailto:)/i.test(addr) ? addr : 'mailto:' + addr;
    out += esc(t.slice(i, m.index)) + (lt && gt ? esc('<') + A(href, addr) + esc('>') : (lt ? esc('<') : '') + A(href, addr));
    i = end;
  }
  return out + esc(t.slice(i));
}
export function mailTextHtml(t){
  const s = String(t || ''); let out = '', i = 0;
  for (const m of s.matchAll(LINK_MARK)){ out += bareLinks(s.slice(i, m.index)) + A(m[2], m[1]); i = m.index + m[0].length; }
  return out + bareLinks(s.slice(i));
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

/**
 * Liens des textes déjà enregistrés (v1.66.5, demande d'Anthony du 23/11/2026) — compte titulaire seulement.
 * Chaque texte est relu dans SA source (.eml joint au suivi ; message de la boîte anthony@ relu dans Gmail) et classé :
 *  - « récupérable » : le texte relu, sans ses adresses de liens, est EXACTEMENT le texte enregistré → remplacé (contrôle refait par la
 *    base : mail_texte_liens / mail_texte_liens_prive), sauf essai à blanc ;
 *  - « sans lien » : rien à ajouter ; « source indisponible » ; « contenu différent » : laissé tel quel (le contenu ne serait pas préservé).
 * Rien d'autre n'est touché (texte et notes de l'entrée, pièces jointes, visibilité). Bilan chiffré, sans contenu, noté pour diagnostic.
 */
export async function relinkTexts({dry = true} = {}){
  await checkOwner();
  if (!M.owner) return toast('Réservé au compte d’Anthony (boîte anthony@).', true);
  const {ownText, unlinked} = await import('./texte-mail.js');
  const n = {récupérables: 0, misÀJour: 0, sansLien: 0, indisponibles: 0, différents: 0, refusés: 0};
  const sort = (old, t) => !t ? 'indisponibles' : t === old ? 'sansLien' : unlinked(t) === old ? 'récupérables' : 'différents';
  // 1. mails importés : prospect_logs.mail_text, source = .eml joint au suivi
  const imported = S.db.prospect_logs.filter(l => isMailCopy(l) && l.mail_text);
  toast(`Liens des textes : ${imported.length} mail${imported.length > 1 ? 's' : ''} importé${imported.length > 1 ? 's' : ''} à relire…`);
  for (const l of imported){
    const {file} = logSource(l), old = l.mail_text, t = file ? await emlText(file) : '';
    const k = sort(old, t); n[k]++;
    if (k !== 'récupérables' || dry) continue;
    const {data, error} = await sb.rpc('mail_texte_liens', {p_log: l.id, p_old: old, p_new: t});
    if (error || !data){ n.refusés++; continue; }
    l.mail_text = t; n.misÀJour++;
  }
  // 2. boîte anthony@ : private.mail_textes, source = message relu dans Gmail (une lecture par conversation)
  const synced = S.db.prospect_logs.filter(l => isMailCopy(l) && !l.mail_text && logSource(l).synced);
  const pick = 'id,prospect_log_id,gmail_message_id,thread_id', msgs = [];
  for (let i = 0; i < synced.length; i += 200){
    const {data} = await sb.from('mail_messages').select(pick).in('prospect_log_id', synced.slice(i, i + 200).map(l => l.id));
    msgs.push(...(data || []));
  }
  const saved = new Map();
  for (let i = 0; i < msgs.length; i += 200){
    const {data} = await sb.rpc('mail_texte_lire', {p_ids: msgs.slice(i, i + 200).map(m => m.id)});
    for (const r of data || []) saved.set(r.message_id, r.body_text);
  }
  const threads = new Map();
  for (const m of msgs) if (saved.get(m.id)){ if (!threads.has(m.thread_id)) threads.set(m.thread_id, []); threads.get(m.thread_id).push(m); }
  let c = 0;
  for (const [tid, list] of threads){
    if (++c % 10 === 0) toast(`Liens des textes : conversation ${c}/${threads.size}…`);
    const row = byId('mail_threads', tid);
    let g = null;
    try { if (row) g = (await callProspect('thread', {thread_id: row.gmail_thread_id})).thread?.messages || []; } catch { g = null; }
    for (const m of list){
      const old = saved.get(m.id), x = (g || []).find(y => y.id === m.gmail_message_id);
      const t = x ? ownText({html: x.html, subject: x.subject || ''}) : '';
      const k = sort(old, t); n[k]++;
      if (k !== 'récupérables' || dry) continue;
      const {data, error} = await sb.rpc('mail_texte_liens_prive', {p_id: m.id, p_old: old, p_new: t});
      if (error || !data){ n.refusés++; continue; }
      if (m.prospect_log_id) BODY.set(m.prospect_log_id, t); n.misÀJour++;
    }
  }
  window.dispatchEvent(new CustomEvent('matrice-diag', {detail: {key: `liens des textes : ${dry ? 'essai à blanc' : 'mise à jour'}`, data: n}}));
  render();
  const txt = `${n.récupérables} récupérable${n.récupérables > 1 ? 's' : ''}${dry ? '' : ` (${n.misÀJour} mis à jour${n.refusés ? `, ${n.refusés} refusé${n.refusés > 1 ? 's' : ''}` : ''})`} · `
    + `${n.sansLien} sans lien · ${n.indisponibles} source indisponible · ${n.différents} contenu différent (laissés tels quels)`;
  const {inform} = await import('./ui/dialog.js');
  await inform({title: dry ? 'Liens des textes : essai à blanc (rien modifié)' : 'Liens des textes : mise à jour faite', text: txt});
  return n;
}

export const TEXT_ACTIONS = { mailTexts: () => completeAll(),
  mailLinks: async () => {
    const {ask} = await import('./ui/dialog.js');
    const v = await ask({title: 'Liens des textes du journal', text: 'Relit chaque texte de mail déjà enregistré dans sa source (.eml joint, ou Gmail) pour rendre ses liens cliquables.\nL’essai à blanc compte seulement, sans rien modifier. La mise à jour remplace uniquement les textes identiques, liens en plus ; les autres restent tels quels. Rien d’autre n’est modifié (texte et notes de l’entrée, pièces jointes, visibilité).',
      actions: [{value: 'dry', label: 'Essai à blanc', plain: true}, {value: 'run', label: 'Mettre à jour'}]});
    if (v) relinkTexts({dry: v === 'dry'});
  } };
