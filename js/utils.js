/**
 * Petits outils : formats (€, dates), échappement HTML, messages, recherche sans accents, export CSV.
 */
import createDOMPurify from '../assets/vendor/dompurify-3.4.16/purify.es.js';
export const $ = (sel, root=document) => root.querySelector(sel);

export const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Montant au centime (budgets) */
export const eur2 = n => n==null || n==='' || isNaN(n) ? '—' : Number(n).toLocaleString('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2});
/** Montant courant : sans centimes quand il est rond (1 200 €), avec sinon (8 967,50 €) */
export const eur = n => n==null || n==='' || isNaN(n) ? '—' : Number(n).toLocaleString('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2});

/** Mail valide (CONVENTIONS §3.4, Q23) : même expression que la base (contacts_clean) ; un champ vide est accepté (obligatoire vérifié à part) */
// caractères invisibles (largeur nulle, inversion d'affichage…) refusés n'importe où dans l'adresse (relecture v1.50a)
export const MAIL_RE = /^[^@\s\u200B-\u200F\u202A-\u202E\u2060\uFEFF]+@[^@\s\u200B-\u200F\u202A-\u202E\u2060\uFEFF]+\.[a-z]{2,}$/i;
// une adresse contenant un caractère invisible est refusée (elle serait enregistrée telle quelle hors de la table des contacts)
const mailText = v => String(v ?? '').trim();
export const mailOk = v => !mailText(v) || MAIL_RE.test(mailText(v));
/** Liste d'adresses (destinataires, copie) : séparées par des virgules ou des points-virgules (hors noms entre guillemets),
 *  « Nom <adresse> » et « "Dupont, Jean" <adresse> » acceptés ; au moins une adresse si le champ n'est pas vide */
export const mailsOk = v => {
  const t = mailText(v); if (!t) return true;
  const parts = t.split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x => x.trim());
  return parts.some(Boolean) && parts.every((x, i) => (x || (i === parts.length - 1 && i > 0)) && (!x || mailOk((x.match(/<([^<>]*)>\s*$/) || [, x])[1])));
};
export const MAIL_MSG = 'Adresse mail invalide : vérifie le @ et le domaine';
/** Erreur sous un champ (§9.1, Q23) : message en --danger sous le champ, bordure du champ en --danger ; msg vide = retire l'erreur */
export function fieldError(input, msg){
  if (!input) return;
  // le message est toujours posé juste après le champ : on retire celui-là (et l'ancien emplacement, sous .field)
  if (input.nextElementSibling?.matches?.('[data-field-err]')) input.nextElementSibling.remove();
  (input.closest('.field') || input.parentElement)?.querySelector(':scope > .help.err[data-field-err]')?.remove();
  input.classList.toggle('bad', !!msg); input.classList.toggle('invalid', !!msg);
  if (msg){ const p = document.createElement('p'); p.className = 'help err'; p.dataset.fieldErr = '1'; p.textContent = msg; input.insertAdjacentElement('afterend', p); }
}
/** Champs mail visibles d'un formulaire : type email, ou liste d'adresses (attribut multiple ou data-mails) */
export const mailInputs = form => [...form.querySelectorAll('input[type=email], input[data-mails]')].filter(i => !i.closest('[hidden]') && !i.disabled);
const inputOk = i => (i.multiple || i.dataset.mails !== undefined) ? mailsOk(i.value) : mailOk(i.value);
/** Mails d'un formulaire au mauvais format : erreurs posées sous chaque champ, renvoie les champs fautifs (les champs masqués sont ignorés) */
export function checkMails(form){
  const all = mailInputs(form);
  all.forEach(i => fieldError(i, ''));
  const bad = all.filter(i => !inputOk(i));
  bad.forEach(i => fieldError(i, MAIL_MSG));
  return bad;
}
/** Champs fautifs sans rien afficher (enregistrement automatique pendant la saisie) */
export const badMails = form => mailInputs(form).filter(i => !inputOk(i));

/** Fuseau de référence de toute règle métier (CONVENTIONS §1.2) */
export const TZ = 'Europe/Paris';
/** Jour (AAAA-MM-JJ) d'un horodatage, à Paris — jamais .slice(0,10) d'un horodatage (jour UTC : la veille entre 0 h et 2 h) */
export const dayOf = ts => { if (!ts) return null; const s = String(ts); if (/^\d{4}-\d\d-\d\d$/.test(s)) return s; const d = new Date(s); return isNaN(d) ? null : d.toLocaleDateString('sv-SE', {timeZone: TZ}); };
/** Date affichée partout en JJ/MM/AAAA (stockage : AAAA-MM-JJ) ; accepte aussi un horodatage complet (jour à Paris) */
export const fmtDate = d => { if (!d) return ''; const s = String(d); return /^\d{4}-\d\d-\d\d$/.test(s) ? fmtNum(s) : /^\d{4}-\d\d-\d\d[ T]/.test(s) && dayOf(s) ? fmtNum(dayOf(s)) : s; };

/** Date courte avec le jour : « sam. 10/01 » (listes compactes) */
export const fmtShort = d => d ? `${new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short'})} ${fmtNum(d).slice(0,5)}` : '';
/** Jour de la semaine en toutes lettres : « mercredi » */
export const fmtWeekday = d => d ? new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long'}) : '';

export function fmtNum(d){ if (!d) return ''; const [y,m,j] = String(d).slice(0,10).split('-'); return `${j}/${m}/${y}`; }

/** Aujourd'hui à Paris (AAAA-MM-JJ) */
export const today = () => new Date().toLocaleDateString('sv-SE', {timeZone: TZ});

/** J+n (ou J-n) d'une date simple — la seule fonction d'ajout de jours (CONVENTIONS §1.6) */
export const addDays = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** M+n (ou M-n) d'une date simple ; un jour qui n'existe pas dans le mois d'arrivée devient le dernier jour du mois (29/02 + 1 an → 28/02) */
export const addMonths = (d, n) => { const [y, m, j] = String(d).slice(0, 10).split('-').map(Number), t = (m - 1) + n, Y = y + Math.floor(t / 12), M = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate(); return `${Y}-${String(M + 1).padStart(2, '0')}-${String(Math.min(j, last)).padStart(2, '0')}`; };
/** Arrondi au centime (CONVENTIONS §2.3) — la seule fonction d'arrondi */
export const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
/** Pourcentage affiché « 15 % », « 33,33 % », « 5,5 % » : espace insécable, 2 décimales au plus, sans zéro inutile (§2.4) */
export const pct = v => v == null || v === '' || isNaN(v) ? '—' : String(Math.round(Number(v) * 100) / 100).replace('.', ',') + '\u00a0%';

export const daysUntil = d => d ? daysBetween(today(), dayOf(d)) : null;   // jour de Paris

export const daysBetween = (a, b) => Math.round((Date.parse(dayOf(b)+'T00:00:00Z') - Date.parse(dayOf(a)+'T00:00:00Z')) / 86400000);   // en jours de calendrier, sans effet heure d'été

/** Texte comparable : minuscules, sans accents ; apostrophes (' ’ ‘ ` ´) et tirets comptent comme un espace */
const APOS = /['‘’ʼ`´]/g;
const plain = x => String(x||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
export const norm = x => plain(x).replace(APOS, ' ').replace(/-/g, ' ');
/** Texte où chercher : « Lev’Roots » se trouve en tapant lev’roots, lev'roots, lev roots ou levroots */
export const hayOf = x => { const p = plain(x); return p.replace(APOS, ' ').replace(/-/g, ' ') + ' ' + p.replace(APOS, '').replace(/-/g, ''); };

/** Tous les mots de la recherche sont présents dans le texte */
export const matches = (hay, q) => { const words = norm(q).split(/\s+/).filter(Boolean); if (!words.length) return true; const h = hayOf(hay); return words.every(w => h.includes(w)); };

/** Message en bas de l'écran ; action facultative {label, fn} (ex. Annuler) */
export function toast(msg, err, action){
  const t = document.createElement('div'); t.className = 'toast' + (err?' err':''); t.setAttribute('role','status');
  t.textContent = msg;
  if (action){ const b = document.createElement('button'); b.className = 'toast-btn'; b.textContent = action.label;
    b.onclick = () => { t.remove(); action.fn(); }; t.appendChild(b); }
  document.querySelectorAll('.toast').forEach(x => x.remove());
  document.body.appendChild(t); setTimeout(()=>t.remove(), action ? 5200 : err ? 5000 : 1800);
}

/** Téléchargement d'un fichier CSV (séparateur ; pour Excel en français) */
export function downloadCSV(name, rows){
  const cell = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
  const txt = '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], {type:'text/csv;charset=utf-8'}));
  a.download = name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/** Lecture d'un CSV (séparateur , ou ; détecté) → tableau de lignes */
export function parseCSV(text){
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g)||[]).length > (first.match(/,/g)||[]).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = []; let row = [], cur = '', q = false;
  for (let i=0;i<text.length;i++){
    const c = text[i];
    if (q){ if (c==='"'){ if (text[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=c; continue; }
    if (c==='"') q = true;
    else if (c===sep){ row.push(cur); cur=''; }
    else if (c==='\n' || c==='\r'){ if (c==='\r' && text[i+1]==='\n') i++; row.push(cur); rows.push(row); row=[]; cur=''; }
    else cur += c;
  }
  if (cur || row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

export function md(text){
  if (!text) return '';
  return esc(text).split('\n').map(line => {
    let l = line
      .replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/(^|\s)_(.+?)_(?=\s|$)/g,'$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g,'$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    const m = l.match(/^(\s*)(?:-|\d+\.)\s+(.*)$/);
    if (m) return `<div class="md-li" style="padding-left:${m[1].length*8+14}px">${m[2]}</div>`;
    if (/^#{1,3}\s/.test(l)) return `<div class="md-h">${l.replace(/^#{1,3}\s/,'')}</div>`;
    if (/^\s*&gt;\s?/.test(l)) return `<div class="md-q">${l.replace(/^\s*&gt;\s?/,'')}</div>`;
    return l.trim() ? `<div>${l}</div>` : '<div class="md-sp"></div>';
  }).join('');
}

export const url = u => !u ? '' : /^https?:\/\//i.test(u) ? u : 'https://' + u;

/** Date ou période d'une date : « ven. 12/07 » ou « 12/07 → 14/07 » */
export const period = s => {
  if (!s?.date) return 'Sans date';
  if (!s.date_end || s.date_end === s.date) return fmtShort(s.date);
  return `${fmtNum(s.date).slice(0,5)} → ${fmtNum(s.date_end).slice(0,5)}`;
};

/**
 * Prénom pour les balises {{contact}} : « Louise Bourbonnais » → Louise, « Flore / Nicolas » → Flore et Nicolas,
 * pas d'adresse mail ni de nom de structure. Les prénoms composés saisis avec un nom (Jean Michel + Proust) restent entiers.
 */
const ORG_WORDS = /^(association|asso|service|p[oô]le|ch[aâ]teau|le|la|les|l['’]|festival|mairie|ville|comit[ée]|ing[ée]nieur|r[ée]gie|r[ée]gisseur|bureau|office|communaut[ée]|salle|th[ée][aâ]tre|centre|direction|[ée]quipe|team|booking|info|infos|contact|programmation|accueil|production|admin|administration|mjc|smac|scène|scene|club|bar|cie|compagnie|soci[ée]t[ée]|sarl|sas)$/i;
export function firstName(c){
  if (!c) return '';
  const one = (s, keepWhole) => { const w = String(s || '').replace(/["“”].*?["“”]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length || w[0].includes('@') || ORG_WORDS.test(w[0])) return ''; return keepWhole ? w.join(' ') : w[0]; };
  const src = (c.first_name || '').replace(/\(.*?\)/g, ' ').trim(), hasLast = !!(c.last_name || '').trim();
  const parts = (src || (c.display_name || '').replace(/\(.*?\)/g, ' ')).split(/\s*(?:\/|;|&|\+|\bet\b|\bou\b)\s*/i).filter(Boolean);
  const names = parts.map(p => one(p, !!src && hasLast && parts.length === 1)).filter(Boolean);
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' et ' + names.at(-1) : names[0] || '';
}

/** Nettoyeur de HTML dédié (DOMPurify, instance propre à la Matrice : ses réglages ne touchent rien d'autre) */
const purifier = createDOMPurify(window);
// Liens et images : adresse relative, ou protocole sûr (les caractères invisibles sont ignorés pour la vérification)
const SAFE_SCHEME = /^(?:https?|mailto|tel|cid):/i;
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'cite', 'longdesc', 'srcset']);
purifier.addHook('uponSanitizeAttribute', (node, data) => {
  if (!URL_ATTRS.has(data.attrName)) return;
  const v = String(data.attrValue || '').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, '');
  const scheme = /^[a-z][a-z0-9+.-]*:/i.test(v);
  const imageData = data.attrName === 'src' && node.tagName === 'IMG' && /^data:image\//i.test(v);
  if (scheme && !SAFE_SCHEME.test(v) && !imageData) data.keepAttr = false;
});
purifier.addHook('afterSanitizeAttributes', node => {
  // liens : ouverts dans un autre onglet, sans accès à la Matrice
  if ((node.tagName === 'A' || node.tagName === 'AREA') && node.hasAttribute('href')){ node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
  // mise en forme : un mail ne peut pas se superposer à l'application (le bloc .log-mail le contient aussi : contain:paint)
  if (node.style && /^(fixed|absolute|sticky)$/i.test(node.style.position)) node.style.removeProperty('position');
});
// Réglages : seulement des interdictions ajoutées aux règles par défaut de DOMPurify, pour garder la mise en page des mails
// (largeur, alignement, couleurs, fusion de cellules…)
const PURIFY = {
  USE_PROFILES: {html: true},                 // HTML seulement : ni SVG ni MathML
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'template'],
  FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'ping'],
  ALLOW_DATA_ATTR: false,
};

/** HTML d'un mail affiché dans la page : nettoyé par DOMPurify (aucun script, aucun lien dangereux), liens ouverts à part */
export function safeHtml(html){
  return purifier.sanitize(String(html || ''), PURIFY);
}

/** Jour ouvré : une échéance qui tombe un samedi ou un dimanche passe au lundi suivant (AAAA-MM-JJ) */
/** Jour ouvré en reculant : samedi ou dimanche → vendredi précédent (boucle accueil & technique, Q12) */
export const workDayBefore = iso => { if (!iso) return iso; const w = new Date(iso + 'T12:00:00Z').getUTCDay(); return w === 6 ? addDays(iso, -1) : w === 0 ? addDays(iso, -2) : iso; };

export function workDay(iso){
  if (!iso) return iso;
  const d = new Date(iso + 'T12:00:00'), w = d.getDay();
  if (w === 6) d.setDate(d.getDate() + 2); else if (w === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
