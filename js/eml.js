/**
 * Lecture d'un mail enregistré (.eml, glissé depuis Mail ou Gmail) : expéditeur, destinataires, objet, date et texte.
 * Sert à l'ajouter au journal d'un suivi, en plus de la pièce jointe.
 */

const isEml = f => /\.eml$/i.test(f?.name || '') || f?.type === 'message/rfc822';

/** Octets (chaîne « binaire ») → texte dans le bon jeu de caractères */
function decodeBytes(bin, charset = 'utf-8'){
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0) & 255);
  try { return new TextDecoder(charset.trim().toLowerCase() || 'utf-8').decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}
const qp = s => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const b64 = s => { try { return atob(s.replace(/[^A-Za-z0-9+/=]/g, '')); } catch { return ''; } };

/** En-têtes encodés « =?UTF-8?Q?…?= » / « =?UTF-8?B?…?= » */
export function decodeWords(s){
  return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([QB])\?([^?]*)\?=/gi, (_, cs, enc, txt) =>
    decodeBytes(enc.toUpperCase() === 'B' ? b64(txt) : qp(txt.replace(/_/g, ' ')), cs));
}

function splitHead(raw){
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i), body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
  const h = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)){
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    // en-tête en UTF-8 non encodé : remis en texte lisible
    if (m && !(m[1].toLowerCase() in h)) h[m[1].toLowerCase()] = /[\x80-\xff]/.test(m[2]) ? decodeBytes(m[2]) : m[2];
  }
  return {h, body};
}
const param = (v, k) => (String(v || '').match(new RegExp(`${k}\\s*=\\s*"?([^";]+)"?`, 'i')) || [])[1] || '';

/** Texte d'une partie (et de ses sous-parties) : texte brut de préférence, sinon HTML sans balises */
function textOf(raw){
  const {h, body} = splitHead(raw);
  const type = (h['content-type'] || 'text/plain').toLowerCase();
  if (type.startsWith('multipart/')){
    const bnd = param(h['content-type'], 'boundary'); if (!bnd) return {};
    const parts = body.split(new RegExp(`--${bnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*\\r?\\n?`)).slice(1).map(textOf);
    return {plain: parts.find(p => p.plain)?.plain, html: parts.find(p => p.html)?.html};
  }
  if (/attachment/i.test(h['content-disposition'] || '')) return {};
  const enc = (h['content-transfer-encoding'] || '').toLowerCase();
  const bin = enc === 'base64' ? b64(body) : enc === 'quoted-printable' ? qp(body) : body;
  const txt = decodeBytes(bin, param(h['content-type'], 'charset') || 'utf-8');
  if (type.startsWith('text/plain')) return {plain: txt};
  if (type.startsWith('text/html')) return {html: txt};
  return {};
}

const htmlToText = html => {
  const d = new DOMParser().parseFromString(html.replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '$&\n'), 'text/html');
  d.querySelectorAll('style,script,head').forEach(n => n.remove());
  return d.body?.textContent || '';
};

/** Garde le nouveau message : sans l'historique cité (« Le … a écrit : », lignes « > ») ni les lignes vides en trop */
function cleanBody(t){
  const lines = String(t || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  const stop = lines.findIndex((l, i) => /^\s*>/.test(l) && i > 0 || /^(Le |On ).{5,200}(a écrit|wrote)\s*:\s*$/.test(l.trim())
    || /^-{2,}\s*(Message d'origine|Original Message|Forwarded message|Message transféré)/i.test(l.trim()) || /^De\s*:\s.+/.test(l.trim()) && i > 2);
  return (stop > 0 ? lines.slice(0, stop) : lines).join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
}

const addr = v => (decodeWords(v).match(/[^\s<>,"]+@[^\s<>,"]+/) || [])[0]?.toLowerCase() || '';
const nameOf = v => { const d = decodeWords(v).trim(); const m = d.match(/^"?([^"<]+?)"?\s*</); return (m ? m[1] : d).trim(); };
const isoDate = v => { const d = new Date(v); return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Message-ID lu dans les en-têtes d'un mail brut (début du fichier suffit), ou '' (v1.60.4 : mails joints avant la v1.60.4) */
export const messageIdOf = raw => { const v = String(splitHead(String(raw || '')).h['message-id'] || '').trim(); return msgIdOk(v) ? v : ''; };

/** Participants d'un en-tête (De, À, Cc) en texte lisible, borné */
const people = v => decodeWords(v || '').replace(/\s+/g, ' ').trim().slice(0, 300);

/** Paramètre de nom de fichier : filename*=UTF-8''…, suites filename*0*=…, filename="=?UTF-8?…?=", ou name=… */
function fileParam(v, k){
  v = String(v || '');
  const parts = [...v.matchAll(new RegExp(`${k}\\*(\\d+)?(\\*)?\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'gi'))]
    .map(m => ({n: Number(m[1] || 0), enc: !!m[2] || !m[1], val: m[4] ?? m[3]})).sort((a, b) => a.n - b.n);
  if (parts.length){
    let cs = 'utf-8';
    const bin = parts.map((p, i) => { let x = p.val;
      if (i === 0 && p.enc){ const m = x.match(/^([^']*)'[^']*'(.*)$/); if (m){ cs = m[1] || cs; x = m[2]; } }
      return p.enc ? x.replace(/%([0-9A-F]{2})/gi, (_, hx) => String.fromCharCode(parseInt(hx, 16))) : x; }).join('');
    return decodeBytes(bin, cs);
  }
  return decodeWords(param(v, k));
}
const cleanName = n => String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
/** Nombre maximal de pièces jointes extraites d'un mail */
export const MAIL_ATT_MAX = 20;

/**
 * Pièces jointes d'un mail brut (v1.60.4) : parties « attachment », parties nommées autres que le texte du mail, mails joints
 * (message/rfc822) ; les images intégrées au texte (inline + Content-ID, ex. logos de signature) ne sont pas reprises.
 * st.out : [{name, type, bytes (Uint8Array)}], MAIL_ATT_MAX au plus ; st.skipped : pièces NON extraites (au-delà de MAIL_ATT_MAX,
 * ou parties imbriquées trop profondément) — annoncées à l'utilisateur, l'original .eml les contient toujours.
 */
const MAIL_DEPTH_MAX = 6;
function attachmentsOf(raw, st = {out: [], skipped: 0}, depth = 0){
  if (depth > MAIL_DEPTH_MAX){ if (String(raw).trim()) st.skipped++; return st; }   // partie vide (fin de liste) : rien à annoncer
  const {h, body} = splitHead(raw);
  const ct = h['content-type'] || 'text/plain', type = ct.split(';')[0].trim().toLowerCase();
  if (type.startsWith('multipart/')){
    const bnd = param(ct, 'boundary'); if (!bnd) return st;
    body.split(new RegExp(`--${bnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*\\r?\\n?`)).slice(1).forEach(p => attachmentsOf(p, st, depth + 1));
    return st;
  }
  const disp = h['content-disposition'] || '', name = cleanName(fileParam(disp, 'filename') || fileParam(ct, 'name'));
  const inlineImage = /^\s*inline/i.test(disp) && h['content-id'] && type.startsWith('image/');
  const isAtt = !inlineImage && (/^\s*attachment/i.test(disp) || (name && !/^text\/(plain|html)$/.test(type)) || type === 'message/rfc822');
  if (!isAtt) return st;
  if (st.out.length >= MAIL_ATT_MAX){ st.skipped++; return st; }
  const enc = (h['content-transfer-encoding'] || '').toLowerCase();
  const bin = enc === 'base64' ? b64(body) : enc === 'quoted-printable' ? qp(body) : body;
  st.out.push({name: name || (type === 'message/rfc822' ? 'mail joint.eml' : 'piece-jointe'), type: type || 'application/octet-stream',
    bytes: Uint8Array.from(bin, c => c.charCodeAt(0) & 255)});
  return st;
}

/**
 * Lit un fichier .eml : {from, fromName, to, toName, subject, date (AAAA-MM-JJ), text, messageId (« <…@…> » ou ''),
 * fromLine, toLine, ccLine (participants lisibles), attachments ([{name, type, bytes}]), attachmentsSkipped (pièces non extraites)}
 */
export async function readEml(file){
  const raw = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsBinaryString(file); });
  return parseEml(raw);
}
/** Même lecture à partir du contenu brut (chaîne « binaire » : un caractère par octet) */
export function parseEml(raw){
  const {h} = splitHead(raw);
  const t = textOf(raw);
  let att = {out: [], skipped: 0}; try { att = attachmentsOf(raw); } catch { att = {out: [], skipped: 1}; }   // lecture impossible : annoncée
  return {from: addr(h.from), fromName: nameOf(h.from || ''), to: addr(h.to), toName: nameOf(h.to || ''),
    subject: decodeWords(h.subject || '').trim(), date: isoDate(h.date), text: cleanBody(t.plain || (t.html ? htmlToText(t.html) : '')),
    messageId: String(h['message-id'] || '').trim(), fromLine: people(h.from), toLine: people(h.to), ccLine: people(h.cc), attachments: att.out, attachmentsSkipped: att.skipped};
}

/**
 * Message-ID d'un mail (RFC 5322), v1.60.4 — forme stricte « <partie-locale@domaine> », sans espace ni caractère de contrôle,
 * ni guillemet, parenthèse, accolade, barre verticale ou virgule (rien qui puisse changer le sens d'une recherche Gmail),
 * 250 caractères au plus (chevrons compris). MÊME expression dans apps-script/Code.gs et apps-script/Prospection.gs (MSGID_RE_),
 * contrôlé par tests/static/message-id.mjs.
 */
export const MSGID_RE = /^<[\w!#$%&'*+\/=?^`~.-]{1,200}@[\w.-]{1,200}>$/;
export const MSGID_MAX = 250;
/** Taille maximale du contenu brut (.eml) renvoyé par un script Google : 20 Mo (même valeur que MSG_RAW_MAX_ des scripts) */
export const MSG_RAW_MAX = 20 * 1024 * 1024;
export const msgIdOk = id => typeof id === 'string' && id.length <= MSGID_MAX && MSGID_RE.test(id);
/** Domaine d'un Message-ID (seule partie notée dans le diagnostic, jamais l'identifiant complet) */
export const msgIdDomain = id => (String(id).match(/@([^@>]*)>$/) || [])[1]?.toLowerCase() || '';

/**
 * Identifiants de message lus dans les liens « message: » qu'Apple Mail transmet quand on glisse un mail (v1.60.4) :
 * « message:%3C<Message-ID>%3E », « message://%3C…%3E », chevrons en clair, plusieurs liens (liste d'adresses ou texte).
 * Seuls les identifiants VALIDES (msgIdOk) sont rendus, sans doublon ; rien n'est jamais ouvert ni récupéré par le réseau.
 */
const LINK_TEXT_MAX = 65536;   // texte du glisser lu au plus (une liste de liens tient en quelques centaines d'octets)
export function mailLinkIds(...texts){
  const out = [];
  for (const t of texts){
    // motif borné (identifiant encodé : 3 × 250 caractères au plus, sans espace ni chevron) et texte tronqué :
    // temps de lecture linéaire, même sur un texte piégé (relecture v1.60.4)
    for (const m of String(t || '').slice(0, LINK_TEXT_MAX).matchAll(/message:(?:\/\/)?(%3C|<)([^\s<>]{1,760}?)(%3E|>)/gi)){
      let inner;
      try { inner = decodeURIComponent(m[2]); } catch { continue; }   // encodage incomplet : lien refusé
      const id = `<${inner}>`;
      if (msgIdOk(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export { isEml };
