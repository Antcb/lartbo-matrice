/**
 * ✍️ Éditeur de texte mis en forme des mails (modèles, prospection, relance, confirmation, boucles, signatures) :
 * police, taille, couleur, gras / italique / souligné, liste, lien, effacer la mise en forme.
 * Une seule barre, la même partout : rtToolbar('id-de-la-zone') au-dessus d'un <div contenteditable id="…">.
 * Police par défaut des mails : Réglages › Modèles de mail (Helvetica Neue 14 sans réglage).
 */
import { setting } from '../selectors.js';
import { esc } from '../utils.js';

export const FONTS = [
  ["'Helvetica Neue', Helvetica, Arial, sans-serif", 'Helvetica Neue'],
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ['Verdana, Geneva, sans-serif', 'Verdana'],
  ['Georgia, serif', 'Georgia'],
  ["'Times New Roman', Times, serif", 'Times New Roman'],
  ["'Courier New', Courier, monospace", 'Courier New'],
];
export const SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28];
const COLORS = ['#000000', '#444444', '#888888', '#990000', '#cc0000', '#e69138', '#38761d', '#0b5394', '#004e78', '#283c63', '#674ea7'];

export const mailFont = () => ({
  family: setting('mail_font') || FONTS[0][0],
  size: Number(setting('mail_font_size')) || 14,
});
/** Style à poser sur la zone d'écriture : ce qu'on voit = ce qui part */
export const rtStyle = () => { const f = mailFont(); return `font-family:${f.family.replace(/"/g, "'")};font-size:${f.size}px;color:#000`; };

/** Enveloppe le mail avec la police par défaut (une seule fois) */
export function wrapMail(html){
  const s = String(html || '');
  if (s.includes('data-mail-root')) return s;
  return `<div data-mail-root="1" style="${rtStyle()}">${s}</div>`;
}

export function rtToolbar(target, {extra = ''} = {}){
  const f = mailFont();
  return `<div class="rt-bar" role="toolbar" aria-label="Mise en forme" data-rt-for="${esc(target)}">
    <select class="rt-font" data-rt="fontName" aria-label="Police" title="Police">${FONTS.map(([v, l]) => `<option value="${esc(v)}" ${v === f.family ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <select class="rt-size" data-rt="fontSize" aria-label="Taille" title="Taille">${SIZES.map(n => `<option value="${n}" ${n === f.size ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <span class="rt-sep"></span>
    <button type="button" class="rt-btn" data-rt="bold" title="Gras (⌘B)"><b>G</b></button>
    <button type="button" class="rt-btn" data-rt="italic" title="Italique (⌘I)"><i>I</i></button>
    <button type="button" class="rt-btn" data-rt="underline" title="Souligné (⌘U)"><u>S</u></button>
    <span class="rt-color" title="Couleur du texte"><button type="button" class="rt-btn" data-rt="colorMenu" aria-label="Couleur du texte"><span class="rt-a">A</span><span class="rt-swatch"></span></button>
      <span class="rt-pop" hidden>${COLORS.map(c => `<button type="button" class="rt-dot" data-rt="foreColor" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
        <label class="rt-dot rt-more" title="Autre couleur"><input type="color" data-rt="foreColorInput" value="#000000" aria-label="Autre couleur"></label></span></span>
    <button type="button" class="rt-btn" data-rt="insertUnorderedList" title="Liste à puces">• Liste</button>
    <button type="button" class="rt-btn" data-rt="link" title="Lien (⌘K)">Lien</button>
    <button type="button" class="rt-btn" data-rt="removeFormat" title="Effacer la mise en forme">Effacer</button>
    ${extra}
    <span class="rt-link" hidden><input type="text" inputmode="url" placeholder="https://…" aria-label="Adresse du lien"><button type="button" class="btn sm primary" data-rt="linkOk">OK</button><button type="button" class="btn sm ghost" data-rt="linkCancel">Annuler</button></span>
  </div>`;
}

// ─── Sélection : gardée par zone, pour qu'un clic dans la barre (menu, couleur, lien) agisse sur le bon texte ───
const RANGES = new WeakMap();
document.addEventListener('selectionchange', () => {
  const sel = getSelection(); if (!sel.rangeCount) return;
  const node = sel.anchorNode, ed = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('[contenteditable="true"]');
  if (ed) RANGES.set(ed, sel.getRangeAt(0).cloneRange());
});
const editorOf = bar => document.getElementById(bar.dataset.rtFor);
function restore(ed){
  ed.focus({preventScroll: true});
  const r = RANGES.get(ed); if (!r || !ed.contains(r.startContainer)) return;
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
const changed = ed => ed.dispatchEvent(new Event('input', {bubbles: true}));

function exec(ed, cmd, value = null){
  restore(ed);
  document.execCommand('styleWithCSS', false, true);
  if (cmd === 'fontSize'){
    // execCommand ne connaît que 7 tailles : on pose la plus grande puis on la remplace par la taille voulue en pixels
    document.execCommand('fontSize', false, '7');
    ed.querySelectorAll('font[size="7"], span[style*="xxx-large"]').forEach(n => {
      const span = document.createElement('span'); span.style.fontSize = value + 'px';
      if (n.tagName === 'SPAN'){ n.style.fontSize = value + 'px'; return; }
      while (n.firstChild) span.appendChild(n.firstChild); n.replaceWith(span);
    });
  } else document.execCommand(cmd, false, value);
  changed(ed);
}

// les boutons ne prennent pas le focus : la sélection reste dans le texte
document.addEventListener('mousedown', e => { if (e.target.closest('.rt-bar .rt-btn, .rt-bar .rt-dot')) e.preventDefault(); });

document.addEventListener('click', e => {
  const b = e.target.closest('.rt-bar [data-rt]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  const bar = b.closest('.rt-bar'), ed = editorOf(bar); if (!ed) return;
  const cmd = b.dataset.rt;
  if (cmd === 'colorMenu'){ const pop = bar.querySelector('.rt-pop'); pop.hidden = !pop.hidden; return; }
  if (cmd === 'foreColor'){ bar.querySelector('.rt-pop').hidden = true; bar.querySelector('.rt-swatch').style.background = b.dataset.v; return exec(ed, 'foreColor', b.dataset.v); }
  if (cmd === 'link'){ const box = bar.querySelector('.rt-link'); box.hidden = false; const inp = box.querySelector('input'); inp.value = ''; inp.focus(); return; }
  if (cmd === 'linkCancel'){ bar.querySelector('.rt-link').hidden = true; restore(ed); return; }
  if (cmd === 'linkOk') return applyLink(bar, ed);
  exec(ed, cmd);
});
function applyLink(bar, ed){
  const box = bar.querySelector('.rt-link'), u = box.querySelector('input').value.trim();
  box.hidden = true;
  if (!u) return restore(ed);
  const url = /^(https?:|mailto:|tel:)/i.test(u) ? u : 'https://' + u;
  restore(ed);
  const sel = getSelection();
  if (sel.isCollapsed){ document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(u)}</a>`); changed(ed); }
  else exec(ed, 'createLink', url);
}
document.addEventListener('keydown', e => {
  const inp = e.target.closest?.('.rt-link input'); if (!inp) return;
  if (e.key === 'Enter'){ e.preventDefault(); const bar = inp.closest('.rt-bar'); applyLink(bar, editorOf(bar)); }
  if (e.key === 'Escape'){ e.preventDefault(); const bar = inp.closest('.rt-bar'); bar.querySelector('.rt-link').hidden = true; restore(editorOf(bar)); }
});
document.addEventListener('change', e => {
  const s = e.target.closest?.('.rt-bar [data-rt]'); if (!s) return;
  e.stopPropagation();
  const bar = s.closest('.rt-bar'), ed = editorOf(bar); if (!ed) return;
  if (s.dataset.rt === 'fontName') exec(ed, 'fontName', s.value);
  if (s.dataset.rt === 'fontSize') exec(ed, 'fontSize', Number(s.value));
  if (s.dataset.rt === 'foreColorInput'){ bar.querySelector('.rt-pop').hidden = true; bar.querySelector('.rt-swatch').style.background = s.value; exec(ed, 'foreColor', s.value); }
}, true);
// la barre indique la police et la taille du texte sous le curseur
document.addEventListener('selectionchange', () => {
  const sel = getSelection(); if (!sel.rangeCount) return;
  const node = sel.anchorNode, el = node?.nodeType === 1 ? node : node?.parentElement;
  const ed = el?.closest?.('[contenteditable="true"]'); if (!ed?.id) return;
  const bar = document.querySelector(`.rt-bar[data-rt-for="${CSS.escape(ed.id)}"]`); if (!bar) return;
  const cs = getComputedStyle(el), size = Math.round(parseFloat(cs.fontSize));
  const sizeSel = bar.querySelector('.rt-size'); if (SIZES.includes(size)) sizeSel.value = String(size);
  const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  const f = FONTS.find(([v]) => v.split(',')[0].replace(/["']/g, '').trim().toLowerCase() === fam); if (f) bar.querySelector('.rt-font').value = f[0];
});
