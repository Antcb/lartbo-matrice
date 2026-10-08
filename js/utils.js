/**
 * Petits outils : formats (€, dates), échappement HTML, messages, mise en forme du texte importé.
 */
export const $ = (sel, root=document) => root.querySelector(sel);

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const eur = n => n==null || n==='' || isNaN(n) ? '—' : Number(n).toLocaleString('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0});

export const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}) : '';

export const daysUntil = d => d ? Math.round((new Date(d+'T00:00:00') - new Date(new Date().toDateString())) / 86400000) : null;

export function toast(msg, err){ const t=document.createElement('div'); t.className='toast'+(err?' err':''); t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(), err?5000:1800); }

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
