/**
 * 🎤 Page publique artiste.html?t=<jeton> : l'artiste remplit sa fiche (infos, présentation, liens, équipe…)
 * et envoie ses fichiers (photos, logos, fiche technique…). Les fichiers passent par un stockage temporaire,
 * puis le script Google les range dans les bons sous-dossiers de son dossier Drive.
 * Il peut revenir sur le même lien pour compléter ou corriger : ses réponses sont reprises.
 */
import { CFG } from './config.js';
import './ui/dropfiles.js';
import { ARTIST_DOCS, ARTIST_SECTIONS, PHOTO_CREDITS } from './artist-fields.js';

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {auth: {persistSession: false}});
const root = document.getElementById('fiche');
const token = new URLSearchParams(location.search).get('t') || '';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const DRAFT = 'artiste.' + token;   // brouillon gardé dans le navigateur tant que la fiche n'est pas envoyée
const words = s => (String(s || '').trim().match(/\S+/g) || []).length;

async function load(){
  if (!token) return fail('Ce lien est incomplet. Vérifie le lien reçu.');
  const {data, error} = await sb.rpc('artist_get', {p_token: token});
  if (error) return fail('La fiche ne peut pas être chargée pour le moment. Réessaie dans quelques minutes.');
  if (!data) return fail('Ce lien n’est pas valide. Écris-nous à production@lartboristerie.com.');
  let draft = {}; try { draft = JSON.parse(localStorage.getItem(DRAFT) || '{}'); } catch {}
  draw(data, {...(data.info || {}), ...draft});
}
function fail(msg){ root.innerHTML = `<div class="panel pad fiche-msg">${esc(msg)}</div>`; }

const lab = f => `${esc(f.label || '')}${f.req ? ' <span class="req" aria-hidden="true">*</span>' : ''}`;
function listRow(f, row = {}){
  // wrap : une fiche par personne, champs sur plusieurs lignes avec leur intitulé
  if (f.wrap) return `<div class="al-row al-card">${f.cols.map(c => `<label class="al-cell"><span>${esc(c.label)}</span>
      <input data-col="${c.k}" value="${esc(row[c.k])}" placeholder="${esc(c.placeholder || '')}"${c.k === 'email' ? ' type="email"' : ''}></label>`).join('')}
    <button type="button" class="btn icon sm ghost" data-al-del aria-label="Retirer">✕</button></div>`;
  return `<div class="al-row" style="grid-template-columns:${f.cols.map(c => c.w || '1fr').join(' ')} auto">${f.cols.map(c =>
    `<input data-col="${c.k}" value="${esc(row[c.k])}" placeholder="${esc(c.placeholder || c.label)}" aria-label="${esc(c.label)}">`).join('')}
    <button type="button" class="btn icon sm ghost" data-al-del aria-label="Retirer la ligne">✕</button></div>`;
}
function input(f, v){
  const id = 'f-' + f.k, cls = `field${f.full ? ' full' : ''}`;
  if (f.type === 'list'){
    const rows = Array.isArray(v) && v.length ? v : [{}];
    return `<div class="${cls}">${f.label ? `<label>${lab(f)}</label>` : ''}<div class="al" data-list="${f.k}">
      ${f.wrap ? '' : `<div class="al-head" style="grid-template-columns:${f.cols.map(c => c.w || '1fr').join(' ')} auto">${f.cols.map(c => `<span>${esc(c.label)}</span>`).join('')}<span></span></div>`}
      <div class="al-rows">${rows.slice(0, f.max || 99).map(r => listRow(f, r)).join('')}</div>
      <button type="button" class="btn sm" data-al-add="${f.k}" ${f.max && rows.length >= f.max ? 'hidden' : ''}>+ ${esc(f.add || 'Ajouter')}</button></div></div>`;
  }
  if (f.type === 'roles'){
    const val = v && typeof v === 'object' ? v : {}, grid = `grid-template-columns:minmax(150px,1fr) ${f.cols.map(c => c.w || '1fr').join(' ')}`;
    return `<div class="${cls}"><div class="al" data-roles="${f.k}">
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

function read(form){
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

function draw(d, values){
  const have = d.docs || [];
  root.innerHTML = `
    <section class="panel pad"><p class="fiche-kicker">Fiche artiste · L’ArtBoristerie Productions</p><h1>${esc(d.name || 'Bienvenue')}</h1>
      <p class="help">Ces informations nous servent à présenter le projet aux programmateurs, festivals et dispositifs (candidatures, dossiers, communication).
        Remplis ce que tu peux : tu peux revenir sur ce même lien pour compléter ou corriger.</p>
      ${d.submitted_at ? `<p class="fiche-engage">Fiche déjà envoyée le ${new Date(d.submitted_at).toLocaleDateString('fr-FR')}. Tes réponses sont reprises ci-dessous.</p>` : ''}</section>
    <form id="artist-form" class="fiche-form" novalidate>
      ${ARTIST_SECTIONS.map(sec => `<section class="panel pad"><h2>${esc(sec.title)}</h2>${sec.help ? `<p class="help">${esc(sec.help)}</p>` : ''}
        <div class="fiche-grid${sec.cols ? ` cols${sec.cols} even` : ''}">${sec.fields.map(f => input(f, values[f.k] ?? '')).join('')}</div></section>`).join('')}
      <section class="panel pad"><h2>${ARTIST_SECTIONS.length + 1}. Photos et fichiers</h2><p class="help">Photos récentes de préférence. Glisse tes fichiers sur la bonne ligne ou clique pour les choisir : ils sont rangés directement dans ton dossier chez nous.</p>
        <div class="fiche-grid">${ARTIST_DOCS.map(([k, l, help, , accept, min]) => { const n = have.filter(x => x.kind === k).length;
          return `<div class="field"><label for="d-${k}">${esc(l)}${min && n < min ? ' <span class="req">*</span>' : ''}${n ? ` <span class="doc-ok">✓ ${n} déjà reçu${n > 1 ? 's' : ''}</span>` : ''}</label>
            <input id="d-${k}" type="file" data-doc="${k}" data-label="${esc(l)}" accept="${esc(accept)}" multiple><span class="muted" style="font-size:12px">${esc(help)}</span></div>`; }).join('')}
          ${input(PHOTO_CREDITS, values[PHOTO_CREDITS.k] ?? '')}</div></section>
      <div class="fiche-actions"><p class="help"><span class="req">*</span> obligatoire</p><button class="btn primary" type="submit">Envoyer la fiche</button></div>
    </form>`;
  const form = document.getElementById('artist-form');
  const count = () => form.querySelectorAll('[data-words]').forEach(t => { const n = words(t.value), max = Number(t.dataset.words);
    const c = form.querySelector(`[data-count-for="${t.name}"]`); if (c){ c.textContent = `${n} / ${max} mots`; c.classList.toggle('over', n > max); } });
  count();
  const keep = () => { try { localStorage.setItem(DRAFT, JSON.stringify(read(form))); } catch {} };
  form.addEventListener('input', () => { count(); keep(); });
  form.addEventListener('change', keep);
  form.addEventListener('click', e => {
    const add = e.target.closest('[data-al-add]');
    if (add){ const f = ARTIST_SECTIONS.flatMap(s => s.fields).find(x => x.k === add.dataset.alAdd);
      const rowsBox = form.querySelector(`[data-list="${f.k}"] .al-rows`);
      if (f.max && rowsBox.children.length >= f.max) return;
      rowsBox.insertAdjacentHTML('beforeend', listRow(f)); rowsBox.querySelector('.al-row:last-child input')?.focus();
      if (f.max && rowsBox.children.length >= f.max) add.hidden = true;   // pas plus que le maximum (3 formules)
      return; }
    const del = e.target.closest('[data-al-del]');
    if (del){ const rows = del.closest('.al-rows'); const addBtn = del.closest('.al')?.querySelector('[data-al-add]'); if (addBtn) addBtn.hidden = false; if (rows.children.length > 1) del.closest('.al-row').remove(); else del.closest('.al-row').querySelectorAll('input').forEach(i => i.value = ''); keep(); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.invalid').forEach(x => x.classList.remove('invalid'));
    // un lien collé sans « https:// » (instagram.com/…) est complété
    form.querySelectorAll('input[type=url]').forEach(x => { const v = x.value.trim(); if (v && !/^https?:\/\//i.test(v)) x.value = 'https://' + v; });
    form.querySelectorAll('.al-row input[data-col=url]').forEach(x => { const v = x.value.trim(); if (v && !/^https?:\/\//i.test(v) && /\.\w{2,}/.test(v)) x.value = 'https://' + v; });
    const missing = [...form.querySelectorAll('[required]')].filter(x => !x.value.trim())
      .concat([...form.querySelectorAll('fieldset[data-req]')].filter(fs => !fs.querySelector('input:checked')));
    // nombre minimum de fichiers (ex. 3 titres MP3), en comptant ceux déjà reçus
    const short = ARTIST_DOCS.filter(([k, , , , , min]) => min && have.filter(x => x.kind === k).length + (form.querySelector(`#d-${k}`)?.files.length || 0) < min);
    if (short.length && !missing.length){ const [k, l, , , , min] = short[0]; form.querySelector(`#d-${k}`).classList.add('invalid'); form.querySelector(`#d-${k}`).focus();
      return note(`${l} : il en faut au moins ${min}.`, true); }
    const tooLong = [...form.querySelectorAll('[data-words]')].filter(t => words(t.value) > Number(t.dataset.words));
    // mail, liens, nombres : au bon format
    const bad = [...form.querySelectorAll('input[type=email], input[type=url], input[type=number]')].filter(x => x.value.trim() && !x.checkValidity());
    if (bad.length && !missing.length){ bad.forEach(x => x.classList.add('invalid')); bad[0].focus();
      return note(bad[0].type === 'email' ? 'L’adresse mail n’est pas valide.' : bad[0].type === 'url' ? 'Un lien n’est pas valide : il doit commencer par https://' : 'Un nombre n’est pas valide.', true); }
    if (missing.length){ missing.forEach(x => x.classList.add('invalid')); (missing[0].querySelector?.('input') || missing[0]).focus(); return note(`Il manque ${missing.length} élément${missing.length > 1 ? 's' : ''} obligatoire${missing.length > 1 ? 's' : ''}.`, true); }
    if (tooLong.length){ tooLong.forEach(x => x.classList.add('invalid')); tooLong[0].focus(); return note(`La présentation dépasse ${tooLong[0].dataset.words} mots.`, true); }
    const info = read(form);
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    const docs = [], inputs = [...form.querySelectorAll('[data-doc]')].filter(x => x.files.length);
    let n = 0; const total = inputs.reduce((t, x) => t + x.files.length, 0);
    for (const inp of inputs){
      for (const file of inp.files){
        btn.textContent = `Envoi des fichiers… ${++n}/${total}`;
        const ext = (file.name.match(/\.(\w{1,5})$/) || ['', 'bin'])[1].toLowerCase();
        const path = `${token}/${inp.dataset.doc}_${Date.now()}_${n}.${ext}`;
        const {error} = await sb.storage.from('artiste').upload(path, file, {contentType: file.type || 'application/octet-stream'});
        if (error){ btn.disabled = false; btn.textContent = 'Envoyer la fiche'; return note(`Envoi de « ${file.name} » impossible : ${error.message}`, true); }
        docs.push({kind: inp.dataset.doc, label: inp.dataset.label, path, name: file.name});
      }
    }
    btn.textContent = 'Enregistrement…';
    const {error} = await sb.rpc('artist_submit', {p_token: token, p_info: info, p_docs: docs});
    btn.disabled = false; btn.textContent = 'Envoyer la fiche';
    if (error) return note(error.message || 'Envoi impossible, réessaie.', true);
    try { localStorage.removeItem(DRAFT); } catch {}
    root.innerHTML = `<div class="panel pad fiche-ok"><h2>Merci !</h2><p>${docs.length ? `Ta fiche et ${docs.length > 1 ? `tes ${docs.length} fichiers sont bien enregistrés` : 'ton fichier sont bien enregistrés'}` : 'Ta fiche est bien enregistrée'}. Les fichiers arrivent dans ton dossier chez nous dans quelques minutes.</p><p><a href="${esc(location.href)}">Revenir à la fiche</a></p></div>`;
    window.scrollTo(0, 0);
  });
}

function note(msg, err){
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
}

load();
