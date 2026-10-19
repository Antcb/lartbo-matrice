/**
 * 🎤 Page publique artiste.html?t=<jeton> : l'artiste remplit sa fiche (infos, présentation, liens, équipe…)
 * et envoie ses fichiers (photos, logos, fiche technique…). Les fichiers passent par un stockage temporaire,
 * puis le script Google les range dans les bons sous-dossiers de son dossier Drive.
 * Il peut revenir sur le même lien pour compléter ou corriger : ses réponses sont reprises.
 */
import { CFG } from './config.js';
import './ui/dropfiles.js';
import './ui/filepick.js';
import { ARTIST_DOCS, ARTIST_SECTIONS, PHOTO_CREDITS } from './artist-fields.js';
import { input, migrateInfo, read, wireLists } from './artist-form.js';

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
  // ancienne version de la fiche : la structure administrative était une ligne de « l'équipe pro » → reprise dans ses nouveaux champs
  const values = migrateInfo({...(data.info || {}), ...draft});
  draw(data, values);
}
function fail(msg){ root.innerHTML = `<div class="panel pad fiche-msg">${esc(msg)}</div>`; }

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
        <div class="fiche-grid">${ARTIST_DOCS.map(([k, l, help, , accept, min, one, more]) => { const n = have.filter(x => x.kind === k).length;
          const got = n ? ` <span class="doc-ok">✓ ${n} déjà reçu${n > 1 ? 's' : ''}</span>` : '';
          // plusieurs fichiers demandés (ex. 3 titres) : une case par fichier, puis une case « autres » facultative
          if (min > 1) return `<div class="field full"><label>${esc(l)}${got}</label><div class="doc-slots">${Array.from({length: min}, (_, i) =>
              `<label class="doc-slot"><span>${esc(one || 'Fichier')} ${i + 1}${i >= n ? ' <span class="req">*</span>' : ''}</span>
                <input id="d-${k}-${i}" type="file" data-doc="${k}" data-label="${esc(l)}" accept="${esc(accept)}"></label>`).join('')}
              <button type="button" class="btn sm doc-add" data-doc-add="${k}" data-one="${esc(one || 'Fichier')}" data-accept="${esc(accept)}" data-label="${esc(l)}">+ Ajouter un ${esc((one || 'fichier').toLowerCase())}</button></div>
            <span class="muted" style="font-size:12px">${esc(help)}</span></div>`;
          // logos, photos en plus : une case, et « + Ajouter » pour en mettre d'autres
          if (more) return `<div class="field full"><label>${esc(l)}${got}</label><div class="doc-slots" data-slots="${k}">
              <label class="doc-slot"><span>${esc(one)} 1</span><input id="d-${k}-0" type="file" data-doc="${k}" data-label="${esc(l)}" accept="${esc(accept)}"></label>
              <button type="button" class="btn sm doc-add" data-doc-add="${k}" data-one="${esc(one)}" data-accept="${esc(accept)}" data-label="${esc(l)}">+ Ajouter ${/^[AEIOUÉH]/i.test(one) ? 'un' : one === 'Photo' ? 'une' : 'un'} ${esc(one.toLowerCase())}</button></div>
            <span class="muted" style="font-size:12px">${esc(help)}</span></div>`;
          return `<div class="field"><label for="d-${k}">${esc(l)}${min && n < min ? ' <span class="req">*</span>' : ''}${got}</label>
            <input id="d-${k}" type="file" data-doc="${k}" data-label="${esc(l)}" accept="${esc(accept)}"><span class="muted" style="font-size:12px">${esc(help)}</span></div>`; }).join('')}
          ${input(PHOTO_CREDITS, values[PHOTO_CREDITS.k] ?? '')}</div></section>
      <div class="fiche-actions"><p class="help"><span class="req">*</span> obligatoire</p><button class="btn primary" type="submit">Envoyer la fiche</button></div>
    </form>`;
  const form = document.getElementById('artist-form');
  const count = () => form.querySelectorAll('[data-words]').forEach(t => { const n = words(t.value), max = Number(t.dataset.words);
    const c = form.querySelector(`[data-count-for="${t.name}"]`); if (c){ c.textContent = `${n} / ${max} mots`; c.classList.toggle('over', n > max); } });
  count();
  // la zone de texte (présentation, stratégie…) grandit avec le texte
  const fit = ta => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
  form.querySelectorAll('textarea').forEach(fit);
  form.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') fit(e.target); });
  const keep = () => { try { localStorage.setItem(DRAFT, JSON.stringify(read(form))); } catch {} };
  form.addEventListener('input', () => { count(); keep(); });
  form.addEventListener('change', keep);
  wireLists(form, keep);
  // « + Ajouter un logo / une photo » : une case de plus
  form.addEventListener('click', e => {
    const b = e.target.closest('[data-doc-add]'); if (!b) return;
    const k = b.dataset.docAdd, i = form.querySelectorAll(`input[data-doc="${k}"]`).length;
    b.insertAdjacentHTML('beforebegin', `<label class="doc-slot"><span>${esc(b.dataset.one)} ${i + 1}</span><input id="d-${k}-${i}" type="file" data-doc="${k}" data-label="${esc(b.dataset.label)}" accept="${esc(b.dataset.accept)}"></label>`);
    form.querySelector(`#d-${k}-${i}`)?.click();
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
    // « 3 titres minimum » : seuls les fichiers MP3 ou WAV comptent (déjà reçus + choisis maintenant)
    const isAudio = n => /\.(mp3|wav)$/i.test(String(n || ''));
    const chosen = k => [...form.querySelectorAll(`input[data-doc="${k}"]`)].flatMap(i => [...i.files]);
    const counted = k => k === 'audio' ? (have.filter(x => x.kind === k && isAudio(x.name)).length + chosen(k).filter(f => isAudio(f.name)).length)
      : have.filter(x => x.kind === k).length + chosen(k).length;
    const short = ARTIST_DOCS.filter(([k, , , , , min]) => min && counted(k) < min);
    if (short.length && !missing.length){ const [k, l, , , , min] = short[0]; const empty = [...form.querySelectorAll(`input[data-doc="${k}"]`)].find(i => !i.files.length) || form.querySelector(`input[data-doc="${k}"]`);
      empty.classList.add('invalid'); empty.focus();
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
