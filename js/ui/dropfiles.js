/**
 * 📎 Glisser-déposer partout : un fichier lâché à côté d'un bouton « Ajouter un fichier »
 * (dans le même bloc, champ, fenêtre…) est envoyé à ce bouton, comme si on l'avait choisi.
 * Les zones qui ont déjà leur propre glisser-déposer (pièces jointes des suivis, photo, import) ne sont pas touchées.
 */
import { mailLinkIds, msgIdDomain } from '../eml.js';

const OWN = '[data-budget-drop],[data-budget-line],[data-drop],[data-drop-form],[data-members-drop],[data-photo-drop]';
// on remonte jusqu'au premier de ces blocs au plus : le fichier va au bouton le plus proche
const STOP = 'dialog, .panel, section, form, .suivi-block';

// Une pièce jointe glissée depuis Mail (Mac) n'annonce pas toujours « Files » pendant le glisser :
// dans la fenêtre de préparation d'un mail et dans les zones de pièces jointes (suivi, journal, échanges, fenêtres),
// on accepte tout ce qui est lâché et on regarde au moment du dépôt (v1.60.2 : même règle pour toutes ces zones)
const MAILBOX = '.mail-wrap';
const ATTACH = '[data-drop],[data-drop-form]';
/** Glisser qui peut contenir un fichier : « Files » annoncé, ou, dans une zone de pièces jointes, autre chose que du simple texte */
export const fileDrag = e => e.dataTransfer?.types?.includes('Files') || !!e.target?.closest?.(`${MAILBOX},${ATTACH}`) && [...(e.dataTransfer?.types || [])].some(t => !/^text\/(plain|html)$/.test(t));
const hasFiles = fileDrag;
/** Fichiers lâchés : la liste « files », sinon les éléments de type fichier (certains glisser depuis Mail ne remplissent que ceux-ci) */
export const droppedFiles = e => { const f = [...(e.dataTransfer?.files || [])]; if (f.length) return f;
  return [...(e.dataTransfer?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean); };
/** Rien d'exploitable dans le dépôt : on le dit au lieu de ne rien faire (v1.60.3 : sans renvoyer vers le Bureau) */
export const NOTHING_DROPPED = 'Rien à joindre : le navigateur n’a transmis aucun fichier pour l’élément glissé. Rien n’a été envoyé.';
/** Seul un lien « message: » vers un mail d'Apple Mail a été transmis : ce lien n'est lisible que par Mail, jamais récupéré */
export const ONLY_MAIL_LINK = 'Rien à joindre : le navigateur n’a reçu de Mail qu’un lien vers le message (« message: »), pas le message lui-même. Rien n’a été envoyé.';

const ext = n => (String(n || '').match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase() || '';
/**
 * Relevé d'un dépôt, lu PENDANT l'événement (les données du glisser ne sont plus lisibles après) et sans donnée personnelle :
 * types annoncés, nombre de fichiers, extension, taille et type de chacun, et seulement le SCHÉMA des liens (message:, file:, https:…).
 */
export function dropInfo(e, files = droppedFiles(e), ids = dropMailIds(e)){
  const dt = e.dataTransfer; let uri = '';
  try { uri = dt?.getData?.('text/uri-list') || ''; } catch {}
  return {types: [...(dt?.types || [])], files: dt?.files?.length || 0, items: [...(dt?.items || [])].map(i => `${i.kind}:${i.type || '?'}`),
    liens: [...new Set(uri.split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => (l.match(/^([a-z][\w+.-]*):/i) || [])[1]?.toLowerCase() || '?'))],
    // (v1.60.4) lien « message: » d'Apple Mail : seulement « Message-ID présent : oui/non » et le DOMAINE de l'identifiant, jamais l'identifiant
    'Message-ID présent': ids.length ? 'oui' : 'non', domaines: [...new Set(ids.map(msgIdDomain))],
    lus: files.map(f => ({ext: ext(f.name), taille: f.size, type: f.type || ''}))};
}
/** Identifiants de message (Message-ID valides) des liens « message: » du glisser : liste d'adresses et texte, lus pendant l'événement */
export function dropMailIds(e){
  const dt = e.dataTransfer; let uri = '', txt = '';
  try { uri = dt?.getData?.('text/uri-list') || ''; } catch {}
  try { txt = dt?.getData?.('text/plain') || ''; } catch {}
  return mailLinkIds(uri, txt);
}
const why = err => err?.name === 'NotFoundError' ? 'le fichier fourni par l’application d’origine n’existe plus (fichier temporaire effacé avant la lecture)'
  : err?.name === 'NotReadableError' ? 'le fichier fourni par l’application d’origine a été modifié ou n’est pas lisible par le navigateur'
  : `lecture impossible (${err?.name || 'erreur inconnue'})`;
/**
 * Copie en mémoire des fichiers lâchés, LANCÉE DANS l'événement « drop » (v1.60.3).
 * Un message glissé depuis Apple Mail arrive comme un fichier .eml temporaire : quand Mail l'efface ou le réécrit après le dépôt,
 * l'envoi au stockage relisait un fichier disparu et le navigateur répondait « Failed to fetch ». Copié tout de suite,
 * le contenu ne dépend plus de ce fichier temporaire. Résultat : {files: copies en mémoire, unreadable: [[nom, motif, erreur]]}.
 */
export function keepDropped(files){
  return Promise.all(files.map(f => f.arrayBuffer().then(buf => new File([buf], f.name || 'fichier', {type: f.type, lastModified: f.lastModified}), err => ({f, err}))))
    .then(rs => ({files: rs.filter(r => r instanceof File), unreadable: rs.filter(r => !(r instanceof File)).map(({f, err}) => [f.name || 'fichier', why(err), err?.name || ''])}));
}
/** Journal de diagnostic : console du navigateur, et table client_errors (via diag.js) quand le dépôt n'aboutit pas */
export function noteDrop(info, problem = ''){
  console.info('[Matrice] dépôt de fichier', problem || 'ok', JSON.stringify(info));
  if (problem) window.dispatchEvent(new CustomEvent('matrice-diag', {detail: {key: `dépôt : ${problem}`, data: info}}));
}
/**
 * Dépôt complet : fichiers lus et copiés en mémoire, relevé de diagnostic, message clair si rien n'est joignable
 * ou si un fichier n'a pas pu être lu. mailLinks (v1.60.4, pièces jointes d'un suivi) : un lien « message: » seul rend ses
 * Message-ID (msgIds) au lieu du message « Rien à joindre », et chaque dépôt est noté pour diagnostic. Doit être appelé de façon synchrone dans le gestionnaire « drop ».
 * Aucune adresse transmise par le glisser (message:, file:…) n'est jamais récupérée par le réseau.
 */
export function takeDropped(e, {mailLinks = false} = {}){
  const raw = droppedFiles(e), ids = dropMailIds(e), info = dropInfo(e, raw, ids);
  if (!raw.length){
    noteDrop(info, 'aucun fichier');
    // (v1.60.4) zone qui sait retrouver le message dans les boîtes Google (pièces jointes d'un suivi) : identifiants rendus, sans message ici
    if (mailLinks && ids.length) return Promise.resolve({files: [], unreadable: [], msgIds: ids});
    import('../utils.js').then(u => u.toast(info.liens.includes('message') ? ONLY_MAIL_LINK : NOTHING_DROPPED, true));
    return Promise.resolve({files: [], unreadable: [], msgIds: []});
  }
  return keepDropped(raw).then(async r => {
    info.copies = r.files.length; info.illisibles = r.unreadable.map(u => u[2]);
    // (v1.60.4) pièces jointes d'un suivi : chaque dépôt est noté (types reçus, nombre de fichiers, Message-ID oui/non + domaine), sans contenu
    noteDrop(info, r.unreadable.length ? 'fichier illisible' : mailLinks ? 'reçu' : '');
    if (r.unreadable.length){
      const {inform} = await import('./dialog.js');
      await inform({title: r.files.length ? `${r.unreadable.length} fichier${r.unreadable.length > 1 ? 's' : ''} non lu${r.unreadable.length > 1 ? 's' : ''}` : 'Rien n’a été joint',
        text: r.unreadable.map(([n, m]) => `✗ ${n} — ${m}`).join('\n') + '\n\nLe détail du dépôt est noté dans la console du navigateur et transmis pour diagnostic.'});
    }
    return {...r, msgIds: []};
  });
}

function inputFor(target){
  if (!target?.closest || target.closest(OWN)) return null;
  for (let el = target; el && el !== document.body; el = el.parentElement){
    const inp = el.matches?.('input[type=file]') ? el : el.querySelector?.('input[type=file]:not([disabled])');
    if (inp) return {inp, zone: el};
    if (el.matches?.(STOP)) break;
  }
  return null;
}

let lit = null;
const light = z => { if (lit === z) return; lit?.classList.remove('drop-over'); lit = z; z?.classList.add('drop-over'); };

document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  const f = inputFor(e.target);
  light(f?.zone || null);
  if (f){ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
});
document.addEventListener('dragleave', e => { if (lit && !lit.contains(e.relatedTarget)) light(null); });
document.addEventListener('drop', e => {
  light(null);
  if (!hasFiles(e)) return;
  const f = inputFor(e.target); if (!f) return;
  e.preventDefault();
  // (v1.60.3) fichiers copiés en mémoire dès le dépôt : ils sont souvent envoyés plus tard (à l'enregistrement, à l'envoi du mail)
  takeDropped(e).then(({files}) => {
    if (!files.length) return;
    const dt = new DataTransfer();
    (f.inp.multiple ? files : files.slice(0, 1)).forEach(x => dt.items.add(x));
    f.inp.files = dt.files;
    f.inp.dispatchEvent(new Event('change', {bubbles: true}));
  });
});
// Un fichier lâché ailleurs ne doit pas ouvrir le fichier dans l'onglet
document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', e => { if (hasFiles(e) && !e.defaultPrevented) e.preventDefault(); });
