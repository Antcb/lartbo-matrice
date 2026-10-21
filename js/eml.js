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

/** Lit un fichier .eml : {from, fromName, to, toName, subject, date (AAAA-MM-JJ), text} */
export async function readEml(file){
  const raw = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsBinaryString(file); });
  const {h} = splitHead(raw);
  const t = textOf(raw);
  return {from: addr(h.from), fromName: nameOf(h.from || ''), to: addr(h.to), toName: nameOf(h.to || ''),
    subject: decodeWords(h.subject || '').trim(), date: isoDate(h.date), text: cleanBody(t.plain || (t.html ? htmlToText(t.html) : ''))};
}

export { isEml };
