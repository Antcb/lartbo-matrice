/**
 * 📝 Page publique fiche.html?t=<jeton> : l'organisateur vérifie les conditions de la date
 * (non modifiables) et remplit ses coordonnées administratives et les infos pratiques.
 * Lecture / écriture par les fonctions SQL fiche_get et fiche_submit (jeton unique par date).
 * Les conditions affichées sont toujours celles de la base : si l'équipe corrige le cachet
 * ou les acomptes, la fiche est à jour sans renvoyer de lien.
 */
import { CFG } from './config.js';
import { FICHE_SECTIONS } from './fiche-fields.js';

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {auth:{persistSession:false}});
const root = document.getElementById('fiche');
const token = new URLSearchParams(location.search).get('t') || '';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = n => n == null ? '—' : Number(n).toLocaleString('fr-FR', {style:'currency', currency:'EUR', maximumFractionDigits: Number(n) % 1 ? 2 : 0});
const pct = n => n == null ? '' : String(n).replace('.', ',') + ' %';
const DRAFT = 'fiche-brouillon-' + token;

async function load(){
  if (!token) return fail('Ce lien est incomplet. Vérifie le lien reçu par mail.');
  const {data, error} = await sb.rpc('fiche_get', {p_token: token});
  if (error) return fail('La fiche ne peut pas être chargée pour le moment. Réessaie dans quelques minutes.');
  if (!data) return fail('Ce lien n’est pas valide. Vérifie le lien reçu par mail ou écris-nous à production@lartboristerie.com.');
  draw(data);
}

function fail(msg){ root.innerHTML = `<div class="panel pad fiche-msg">${esc(msg)}</div>`; }

function conditions(d){
  const cr = d.contract_type === 'Co-Réalisation';
  const pays = (d.payments || []).map(p => `<li>${esc(p.label || (p.kind === 'solde' ? 'Solde' : 'Acompte'))}${p.pct != null ? ` : ${pct(p.pct)}` : ''}${p.ht != null ? ` · ${eur(p.ht)} HT` : ''}</li>`).join('');
  return `<section class="panel pad fiche-cond">
    <p class="fiche-kicker">Fiche de renseignements</p>
    <h1>${esc(d.artist)}</h1>
    <p class="fiche-when">${esc(d.date_label || '')}${d.date_end && d.date_end !== d.date ? ` → ${esc(d.date_end.split('-').reverse().join('/'))}` : ''} · ${esc(d.venue || '')} · ${esc(d.city || '')}${d.cp ? ` (${esc(d.cp)})` : ''}</p>
    <h2>Conditions convenues</h2>
    <dl class="fiche-dl">
      <dt>Contrat</dt><dd>${esc(d.contract_type || 'à préciser')}</dd>
      <dt>${cr ? 'Minimum garanti' : 'Montant de la cession'}</dt><dd><b>${eur(d.fee_ht)} HT</b> · ${eur(d.fee_ttc)} TTC (TVA ${pct(d.vat)})</dd>
      ${pays ? `<dt>Paiement</dt><dd><ul>${pays}</ul></dd>` : ''}
      ${d.capacity ? `<dt>Jauge</dt><dd>${esc(d.capacity)} personnes</dd>` : ''}
    </dl>
    <p class="help">Ces conditions ne sont pas modifiables ici. Pour toute question : <a href="mailto:production@lartboristerie.com">production@lartboristerie.com</a>.</p>
  </section>`;
}

function input(f, v, locked){
  const id = 'f-' + f.k, req = f.req ? ' required' : '', dis = locked ? ' disabled' : '';
  const ctl = f.type === 'textarea'
    ? `<textarea id="${id}" name="${f.k}" rows="3"${dis}>${esc(v)}</textarea>`
    : `<input id="${id}" name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.type === 'email' ? ' autocomplete="email"' : ''}${req}${dis}>`;
  return `<div class="field${f.full ? ' full' : ''}"><label for="${id}">${esc(f.label)}${f.req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>${ctl}</div>`;
}

function draw(d){
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DRAFT) || '{}'); } catch {}
  const admin = d.structure?.admin || {}, fiche = d.fiche || {};
  const val = f => saved[f.k] ?? (f.src === 'admin' ? (admin[f.k] ?? (f.k === 'legal_name' ? d.structure?.name : '')) : (fiche[f.k] ?? (f.k === 'capacity' ? d.capacity : f.k === 'venue_address' ? d.structure?.address : ''))) ?? '';
  const locked = !!d.locked;
  root.innerHTML = conditions(d) + `
    ${d.submitted_at ? `<div class="panel pad fiche-ok">Fiche envoyée le ${new Date(d.submitted_at).toLocaleDateString('fr-FR')}. ${locked ? 'Le contrat est en préparation : la fiche n’est plus modifiable.' : 'Tu peux encore la corriger et la renvoyer.'}</div>` : ''}
    <form id="fiche-form" class="fiche-form" novalidate>
      ${FICHE_SECTIONS.map(sec => `<section class="panel pad"><h2>${esc(sec.title)}</h2>${sec.help ? `<p class="help">${esc(sec.help)}</p>` : ''}
        <div class="fiche-grid${sec.cols === 3 ? ' cols3' : ''}">${sec.fields.map(f => input(f, val(f), locked)).join('')}</div></section>`).join('')}
      ${locked ? '' : `<div class="fiche-actions"><p class="help"><span class="req">*</span> champs nécessaires au contrat</p><button class="btn primary" type="submit">${d.submitted_at ? 'Renvoyer la fiche' : 'Envoyer la fiche'}</button></div>`}
    </form>`;
  const form = document.getElementById('fiche-form');
  form.addEventListener('input', () => { try { localStorage.setItem(DRAFT, JSON.stringify(read(form))); } catch {} });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const missing = [...form.querySelectorAll('[required]')].filter(x => !x.value.trim());
    form.querySelectorAll('.invalid').forEach(x => x.classList.remove('invalid'));
    if (missing.length){ missing.forEach(x => x.classList.add('invalid')); missing[0].focus(); return note(`Il manque ${missing.length} champ${missing.length > 1 ? 's' : ''} obligatoire${missing.length > 1 ? 's' : ''}.`, true); }
    const v = read(form), adm = {}, fi = {};
    FICHE_SECTIONS.forEach(sec => sec.fields.forEach(f => (f.src === 'admin' ? adm : fi)[f.k] = v[f.k] || ''));
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Envoi…';
    const {error} = await sb.rpc('fiche_submit', {p_token: token, p_admin: adm, p_fiche: fi});
    btn.disabled = false;
    if (error){ btn.textContent = 'Envoyer la fiche'; return note(error.message || 'Envoi impossible, réessaie.', true); }
    try { localStorage.removeItem(DRAFT); } catch {}
    root.innerHTML = conditions(d) + `<div class="panel pad fiche-ok"><h2>Merci !</h2><p>Ta fiche est bien enregistrée. Nous préparons le contrat et revenons vers toi rapidement.</p><p><a href="${esc(location.href)}">Revoir ou corriger la fiche</a></p></div>`;
    window.scrollTo(0, 0);
  });
}

const read = form => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));

function note(msg, err){
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
}

load();
