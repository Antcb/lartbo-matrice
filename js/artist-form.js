/**
 * 🎤 Formulaire de la fiche artiste, commun à la page publique (artiste.html) et à l'onglet « Fiche artiste »
 * d'un projet dans la Matrice (mêmes champs, modifiables, avec un bouton « Copier » par champ).
 */
import { ARTIST_SECTIONS, PHOTO_CREDITS } from './artist-fields.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const ALL_FIELDS = [...ARTIST_SECTIONS.flatMap(s => s.fields), PHOTO_CREDITS];

const labTxt = f => `${esc(f.label || '')}${f.req ? ' <span class="req" aria-hidden="true">*</span>' : ''}`;
export function listRow(f, row = {}){
  // wrap : une fiche par personne, champs sur plusieurs lignes avec leur intitulé
  if (f.wrap) return `<div class="al-row al-card">${f.cols.map(c => `<label class="al-cell"><span>${esc(c.label)}</span>
      <input data-col="${c.k}" value="${esc(row[c.k])}" placeholder="${esc(c.placeholder || '')}"${c.k === 'email' ? ' type="email"' : c.k === 'phone' ? ' type="tel"' : ''}></label>`).join('')}
    <button type="button" class="btn icon sm ghost" data-al-del aria-label="Retirer">✕</button></div>`;
  return `<div class="al-row" style="grid-template-columns:${f.cols.map(c => c.w || '1fr').join(' ')} auto">${f.cols.map(c =>
    `<input data-col="${c.k}" value="${esc(row[c.k])}" placeholder="${esc(c.placeholder || c.label)}" aria-label="${esc(c.label)}">`).join('')}
    <button type="button" class="btn icon sm ghost" data-al-del aria-label="Retirer la ligne">✕</button></div>`;
}
export function input(f, v, {copy = false, prefix = 'f-'} = {}){
  const id = prefix + f.k, cls = `field${f.full ? ' full' : ''}`;
  const lab = f => labTxt(f) + (copy ? ` <button type="button" class="af-copy" data-af-copy="${f.k}" title="Copier" aria-label="Copier ${esc(f.label || '')}">Copier</button>` : '');
  if (f.type === 'list'){
    const rows = Array.isArray(v) && v.length ? v : [{}];
    return `<div class="${cls}">${f.label || copy ? `<label>${lab(f)}</label>` : ''}<div class="al" data-list="${f.k}">
      ${f.wrap ? '' : `<div class="al-head" style="grid-template-columns:${f.cols.map(c => c.w || '1fr').join(' ')} auto">${f.cols.map(c => `<span>${esc(c.label)}</span>`).join('')}<span></span></div>`}
      <div class="al-rows">${rows.slice(0, f.max || 99).map(r => listRow(f, r)).join('')}</div>
      <button type="button" class="btn sm" data-al-add="${f.k}" ${f.max && rows.length >= f.max ? 'hidden' : ''}>+ ${esc(f.add || 'Ajouter')}</button></div></div>`;
  }
  if (f.type === 'roles'){
    const val = v && typeof v === 'object' ? v : {}, grid = `grid-template-columns:minmax(150px,1fr) ${f.cols.map(c => c.w || '1fr').join(' ')}`;
    return `<div class="${cls}">${copy ? `<label>${lab(f)}</label>` : ''}<div class="al" data-roles="${f.k}">
      <div class="al-head" style="${grid}"><span>Rôle</span>${f.cols.map(c => `<span>${esc(c.label)}</span>`).join('')}</div>
      ${f.roles.map(r => `<div class="al-row al-role" data-role="${esc(r)}" style="${grid}"><b>${esc(r)}</b>${f.cols.map(c =>
        `<input data-col="${c.k}" value="${esc(val[r]?.[c.k])}" placeholder="${esc(c.label)}" aria-label="${esc(r + ' : ' + c.label)}"${c.k === 'email' ? ' type="email"' : c.k === 'phone' ? ' type="tel"' : ''}>`).join('')}</div>`).join('')}
    </div></div>`;
  }
  if (f.type === 'choice') return `<div class="${cls}"><fieldset class="choice"${f.req ? ' data-req="1"' : ''}><legend>${lab(f)}</legend>${f.options.map(o =>
    `<label><input type="radio" name="${f.k}" value="${esc(o)}" ${o === v ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</fieldset></div>`;
  if (f.type === 'select') return `<div class="${cls}"><label for="${id}">${lab(f)}</label><select id="${id}" name="${f.k}"${f.req ? ' required' : ''}>
    <option value=""></option>${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}${v && !f.options.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select></div>`;
  if (f.type === 'textarea') return `<div class="${cls}"><label for="${id}">${lab(f)}${f.words ? ` <span class="muted">(${f.words} mots maximum)</span>` : ''}</label>
    <textarea id="${id}" name="${f.k}" rows="${f.rows || 5}"${f.req ? ' required' : ''}${f.words ? ` data-words="${f.words}"` : ''}>${esc(v)}</textarea>
    ${f.words ? `<span class="word-count" data-count-for="${f.k}"></span>` : ''}</div>`;
  return `<div class="${cls}"><label for="${id}">${lab(f)}</label><input id="${id}" name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : f.type === 'url' ? ' placeholder="https://…"' : ''}${f.req ? ' required' : ''}${f.type === 'number' ? ' min="0" inputmode="numeric"' : ''}></div>`;
}

export function read(form){
  const v = {};
  ARTIST_SECTIONS.forEach(sec => sec.fields.forEach(f => {
    if (f.type === 'roles'){
      v[f.k] = Object.fromEntries([...form.querySelectorAll(`[data-roles="${f.k}"] [data-role]`)].map(r => [r.dataset.role, Object.fromEntries([...r.querySelectorAll('[data-col]')].map(i => [i.dataset.col, i.value.trim()]))])
        .filter(([, o]) => Object.values(o).some(Boolean)));
    } else if (f.type === 'list'){
      v[f.k] = [...form.querySelectorAll(`[data-list="${f.k}"] .al-row`)].map(r => Object.fromEntries([...r.querySelectorAll('[data-col]')].map(i => [i.dataset.col, i.value.trim()])))
        .filter(r => Object.values(r).some(Boolean));
    } else if (f.type === 'choice') v[f.k] = form.querySelector(`[name="${f.k}"]:checked`)?.value || '';
    else v[f.k] = (form.elements[f.k]?.value || '').trim();
  }));
  v[PHOTO_CREDITS.k] = (form.elements[PHOTO_CREDITS.k]?.value || '').trim();
  return v;
}


/** Lignes répétables : ajouter / retirer (onChange après chaque retrait) */
export function wireLists(form, onChange = () => {}){ form.addEventListener('click', e => listClick(e, form, onChange)); }
/** Clic dans un formulaire de fiche : « + Ajouter » / « ✕ » d'une liste. Renvoie true si le clic a été traité. */
export function listClick(e, form, onChange = () => {}){
  const add = e.target.closest('[data-al-add]');
  if (add){ const f = ALL_FIELDS.find(x => x.k === add.dataset.alAdd);
    const rowsBox = form.querySelector(`[data-list="${f.k}"] .al-rows`);
    if (f.max && rowsBox.children.length >= f.max) return true;
    rowsBox.insertAdjacentHTML('beforeend', listRow(f)); rowsBox.querySelector('.al-row:last-child input')?.focus();
    if (f.max && rowsBox.children.length >= f.max) add.hidden = true;   // pas plus que le maximum (3 formules)
    return true; }
  const del = e.target.closest('[data-al-del]');
  if (del){ const rows = del.closest('.al-rows'); const addBtn = del.closest('.al')?.querySelector('[data-al-add]'); if (addBtn) addBtn.hidden = false;
    if (rows.children.length > 1) del.closest('.al-row').remove(); else del.closest('.al-row').querySelectorAll('input').forEach(i => i.value = '');
    onChange(); return true; }
  return false;
}

/** Texte d'une réponse, prêt à coller (listes : une ligne par élément) */
export function fieldText(f, v){
  if (f.type === 'roles') return Object.entries(v || {}).map(([r, o]) => `${r} : ${f.cols.map(c => o?.[c.k]).filter(Boolean).join(' · ')}`).join('\n');
  if (f.type === 'list') return (v || []).map(r => f.cols.map(c => r?.[c.k]).filter(Boolean).join(' · ')).join('\n');
  return String(v ?? '');
}
/** Toute la fiche en texte (sections, intitulés, réponses) */
export function ficheText(values, name = ''){
  const out = name ? [name.toUpperCase(), ''] : [];
  [...ARTIST_SECTIONS, {title: 'Photos', fields: [PHOTO_CREDITS]}].forEach(sec => {
    const lines = sec.fields.map(f => [f, fieldText(f, values[f.k])]).filter(([, t]) => t.trim());
    if (!lines.length) return;
    out.push(sec.title.toUpperCase());
    lines.forEach(([f, t]) => out.push(t.includes('\n') ? `${f.label || ''}${f.label ? ' :' : ''}\n${t}` : `${f.label ? f.label + ' : ' : ''}${t}`));
    out.push('');
  });
  return out.join('\n').trim();
}
