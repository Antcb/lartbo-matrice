/**
 * 👤 Page publique rh.html?t=<jeton> : le salarié complète sa fiche et envoie ses pièces (RIB, carte vitale…).
 * Les fichiers vont dans un espace de stockage temporaire ; le script Google les range ensuite,
 * renommés « RIB - NOM Prénom », dans son dossier du Drive « Salariés ».
 * Les numéros sensibles déjà connus ne sont jamais réaffichés (seulement « déjà renseigné »).
 */
import { CFG } from './config.js';
import { RH_DOCS, RH_SECTIONS } from './rh-fields.js';

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {auth:{persistSession:false}});
const root = document.getElementById('fiche');
const token = new URLSearchParams(location.search).get('t') || '';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FILLED = '__rempli__';

async function load(){
  if (!token) return fail('Ce lien est incomplet. Vérifie le lien reçu par mail.');
  const {data, error} = await sb.rpc('rh_get', {p_token: token});
  if (error) return fail('La fiche ne peut pas être chargée pour le moment. Réessaie dans quelques minutes.');
  if (!data) return fail('Ce lien n’est pas valide. Écris-nous à production@lartboristerie.com.');
  draw(data);
}
function fail(msg){ root.innerHTML = `<div class="panel pad fiche-msg">${esc(msg)}</div>`; }

function input(f, v){
  const id = 'f-' + f.k, known = v === FILLED;
  const req = f.req && !known ? ' required' : '';
  const lab = `${esc(f.label)}${f.req ? ' <span class="req" aria-hidden="true">*</span>' : ''}`;
  const wrap = inner => `<div class="field${f.full ? ' full' : ''}">${inner}</div>`;
  if (f.type === 'choice') return wrap(`<fieldset class="choice"${req ? ' data-req="1"' : ''}><legend>${lab}</legend>${f.options.map(o => `<label><input type="radio" name="${f.k}" value="${esc(o)}" ${o === v ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</fieldset>`);
  const ph = known ? 'Déjà renseigné — laisse vide pour garder' : (f.placeholder || '');
  return wrap(`<label for="${id}">${lab}</label><input id="${id}" name="${f.k}" type="${f.type || 'text'}" value="${known ? '' : esc(v)}"${ph ? ` placeholder="${esc(ph)}"` : ''}${f.secret ? ' autocomplete="off"' : ''}${req}>`);
}

function draw(d){
  const info = d.info || {}, have = new Set(d.docs || []);
  const val = f => (['first_name','last_name','email','phone'].includes(f.k) ? d[f.k] : info[f.k]) ?? f.def ?? '';
  root.innerHTML = `
    <section class="panel pad"><p class="fiche-kicker">Fiche salarié</p><h1>${esc([d.first_name, d.last_name].filter(Boolean).join(' ') || 'Bienvenue')}</h1>
      <p class="help">Ces informations servent à établir tes contrats et bulletins de paie avec L’ArtBoristerie Productions. Elles restent confidentielles.</p>
      ${d.submitted_at ? `<p class="fiche-engage">Fiche déjà envoyée le ${new Date(d.submitted_at).toLocaleDateString('fr-FR')}. Tu peux la compléter ou la corriger.</p>` : ''}</section>
    <form id="rh-form" class="fiche-form" novalidate>
      ${RH_SECTIONS.map(sec => `<section class="panel pad"><h2>${esc(sec.title)}</h2>${sec.help ? `<p class="help">${esc(sec.help)}</p>` : ''}
        <div class="fiche-grid">${sec.fields.map(f => input(f, val(f))).join('')}</div></section>`).join('')}
      <section class="panel pad"><h2>Pièces justificatives</h2><p class="help">Photo ou PDF. Pour la carte d’identité, recto et verso.</p>
        <div class="fiche-grid">${RH_DOCS.map(([k, l, req]) => `<div class="field"><label for="d-${k}">${esc(l)}${req && !have.has(k) ? ' <span class="req">*</span>' : ''}${have.has(k) ? ' <span class="doc-ok">✓ déjà reçu</span>' : ''}</label>
          <input id="d-${k}" type="file" data-doc="${k}" data-label="${esc(l)}" accept="image/*,application/pdf" multiple${req && !have.has(k) ? ' data-req-doc="1"' : ''}></div>`).join('')}</div></section>
      <div class="fiche-actions"><p class="help"><span class="req">*</span> obligatoire</p><button class="btn primary" type="submit">Envoyer</button></div>
    </form>`;
  const form = document.getElementById('rh-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.invalid').forEach(x => x.classList.remove('invalid'));
    const missing = [...form.querySelectorAll('[required]')].filter(x => !x.value.trim())
      .concat([...form.querySelectorAll('fieldset[data-req]')].filter(fs => !fs.querySelector('input:checked')))
      .concat([...form.querySelectorAll('[data-req-doc]')].filter(x => !x.files.length));
    if (missing.length){ missing.forEach(x => x.classList.add('invalid')); (missing[0].querySelector?.('input') || missing[0]).focus(); return note(`Il manque ${missing.length} élément${missing.length > 1 ? 's' : ''} obligatoire${missing.length > 1 ? 's' : ''}.`, true); }
    const v = Object.fromEntries([...new FormData(form)].filter(([, x]) => typeof x === 'string').map(([k, x]) => [k, x.trim()]));
    const main = {}, data = {};
    RH_SECTIONS.forEach(sec => sec.fields.forEach(f => { if (v[f.k]) (f.col ? main : data)[f.k] = v[f.k]; }));
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    const docs = [];
    const inputs = [...form.querySelectorAll('[data-doc]')].filter(x => x.files.length);
    let n = 0; const total = inputs.reduce((t, x) => t + x.files.length, 0);
    for (const inp of inputs){
      for (const file of inp.files){
        btn.textContent = `Envoi des pièces… ${++n}/${total}`;
        const ext = (file.name.match(/\.(\w{1,5})$/) || ['', 'pdf'])[1].toLowerCase();
        const path = `${token}/${inp.dataset.doc}_${Date.now()}_${n}.${ext}`;
        const {error} = await sb.storage.from('rh').upload(path, file, {contentType: file.type || 'application/octet-stream'});
        if (error){ btn.disabled = false; btn.textContent = 'Envoyer'; return note(`Envoi de « ${file.name} » impossible : ${error.message}`, true); }
        docs.push({kind: inp.dataset.doc, label: inp.dataset.label, path, name: file.name});
      }
    }
    btn.textContent = 'Enregistrement…';
    const {error} = await sb.rpc('rh_submit', {p_token: token, p_main: main, p_info: data, p_docs: docs});
    btn.disabled = false; btn.textContent = 'Envoyer';
    if (error) return note(error.message || 'Envoi impossible, réessaie.', true);
    root.innerHTML = `<div class="panel pad fiche-ok"><h2>Merci !</h2><p>Ta fiche${docs.length ? ` et tes ${docs.length} pièce${docs.length > 1 ? 's' : ''}` : ''} sont bien enregistrées.</p><p><a href="${esc(location.href)}">Revenir à la fiche</a></p></div>`;
    window.scrollTo(0, 0);
  });
}

function note(msg, err){
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
}

load();
