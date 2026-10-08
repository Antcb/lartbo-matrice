/**
 * Petits outils : formats (€, dates), échappement HTML, messages, recherche sans accents, export CSV.
 */
export const $ = (sel, root=document) => root.querySelector(sel);

export const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const eur = n => n==null || n==='' || isNaN(n) ? '—' : Number(n).toLocaleString('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0});

export const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}) : '';

export const fmtShort = d => d ? new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'}) : '';

export const fmtNum = d => { if (!d) return ''; const [y,m,j] = d.split('-'); return `${j}/${m}/${y}`; };

export const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); };

export const daysUntil = d => d ? Math.round((new Date(d+'T00:00:00') - new Date(new Date().toDateString())) / 86400000) : null;

export const daysBetween = (a, b) => Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000);

/** Texte comparable : minuscules, sans accents */
export const norm = x => String(x||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

/** Tous les mots de la recherche sont présents dans le texte */
export const matches = (hay, q) => { const words = norm(q).split(/\s+/).filter(Boolean); if (!words.length) return true; const h = norm(hay); return words.every(w => h.includes(w)); };

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
