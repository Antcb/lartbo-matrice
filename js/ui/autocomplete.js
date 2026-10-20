/**
 * Champ de recherche avec suggestions (structures, dates, contacts, villes / adresses).
 * On voit ce qu'on tape, la liste se met à jour, ↑ ↓ Entrée pour choisir, et on peut créer
 * l'élément s'il n'existe pas (« + Créer … »).
 *
 * acInput(kind, {value, attrs, placeholder, create, fill}) :
 *   - kind  : une des SOURCES ci-dessous
 *   - attrs : attributs posés sur l'input caché qui porte l'identifiant (name="…" ou data-t/data-id/data-f)
 *   - fill  : pour les adresses, préfixe des champs du formulaire à remplir automatiquement
 * Au choix, l'input caché reçoit l'identifiant et déclenche « change » (enregistrement direct ou formulaire).
 */
import { byId, linksOfStructure, showLabel, structName } from '../selectors.js';
import { S } from '../state.js';
import { esc, fmtDate, hayOf, norm } from '../utils.js';
import { searchPlaces } from '../geo.js';

const LIMIT = 12;

function rank(rows, q, text, limit=LIMIT){
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const r of rows){
    const h = hayOf(text(r)); if (!words.every(w => h.includes(w))) continue;
    const name = norm(text(r).split(' — ')[0]);
    out.push([name.startsWith(words[0]) ? 0 : name.includes(' '+words[0]) ? 1 : 2, r]);
    if (out.length > 3000) break;
  }
  return out.sort((a,b)=>a[0]-b[0]).slice(0, limit).map(x=>x[1]);
}

export const SOURCES = {
  structures: {
    label: id => structName(id),
    search: q => rank(S.db.structures, q, s => `${s.name} — ${[s.city, s.department_code].filter(Boolean).join(' ')}${q.includes('@') ? ' ' + linksOfStructure(s.id).flatMap(c => [c.email, c.email_2]).filter(Boolean).join(' ') : ''}`)
      .map(s => ({id:s.id, label:s.name, hint:[s.city, s.department_code && '('+s.department_code+')'].filter(Boolean).join(' ')})),
  },
  contacts: {
    label: id => byId('contacts', id)?.display_name || '',
    search: q => rank(S.db.contacts, q, c => `${c.display_name} — ${c.email||''} ${c.email_2||''}`)
      .map(c => ({id:c.id, label:c.display_name, hint:[c.email, c.email_2].filter(Boolean).join(' · ')})),
  },
  shows: {
    label: id => showLabel(byId('shows', id)),
    search: q => rank(S.db.shows.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')), q,
        s => `${s.venue} — ${s.city||''} ${fmtDate(s.date)} ${s.date||''} ${(s.date||'').split('-').reverse().join('/')} ${byId('projects', s.project_id)?.name||''} ${s.status||''}`, 60)
      .map(s => ({id:s.id, label:showLabel(s), hint:[byId('projects', s.project_id)?.name, s.status].filter(Boolean).join(' · ')})),
  },
  // Villes et adresses (France : Géoplateforme ; ailleurs : OpenStreetMap)
  places: { async: true, label: () => '', search: q => searchPlaces(q) },
  cities: { async: true, label: () => '', search: q => searchPlaces(q, {cities:true}), local: q => knownCities(q) },
  // adresse complète enregistrée telle quelle (membres, livraison des affiches…)
  fulladdr: { async: true, label: () => '', search: async q => (await searchPlaces(q)).map(p => ({...p, id: p.label, label: p.label})) },
};

/** Villes déjà connues (fiches structures localisées) : proposées tout de suite, avant la réponse de la Géoplateforme */
let CITY_IDX = null, CITY_N = -1;
function knownCities(q){
  if (CITY_N !== S.db.structures.length){
    const m = new Map();
    for (const s of S.db.structures) if (s.city && s.lat != null && s.department_code){ const k = norm(s.city) + '|' + s.department_code; if (!m.has(k)) m.set(k, s); }
    CITY_IDX = [...m.values()]; CITY_N = S.db.structures.length;
  }
  const n = norm(q); if (n.length < 2) return [];
  return CITY_IDX.filter(s => norm(s.city).startsWith(n)).slice(0, 5).map(s => ({id: s.city, label: s.city, city: s.city, postcode: s.postal_code || null,
    lat: s.lat, lng: s.lng, department_code: s.department_code, department_name: s.department_name, region: s.region, country: s.country || 'France',
    hint: `${s.department_code} ${s.department_name || ''}`.trim()}));
}

export function acInput(kind, {value='', text, attrs='', placeholder='Rechercher…', create=false, fill=false}={}){
  const label = text ?? (value ? SOURCES[kind].label(value) : '');
  return `<span class="ac" data-ac="${kind}" ${create?'data-create="1"':''} ${fill!==false && fill!=null ?`data-fill="${esc(fill)}"`:''}>
    <input type="text" class="ac-input" value="${esc(label)}" placeholder="${esc(placeholder)}" autocomplete="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true" role="combobox" aria-expanded="false" aria-autocomplete="list">
    <input type="hidden" class="ac-val" value="${esc(value||'')}" ${attrs}></span>`;
}

// Fonctions de création appelées par « + Créer … » (définies par forms.js)
export const CREATORS = {};

/** Ville / adresse : le texte tapé (sans suggestion choisie) est repris tout de suite, avant l'enregistrement d'un formulaire */
export function commitTypedText(root){
  root.querySelectorAll('.ac').forEach(box => {
    if (!SOURCES[box.dataset.ac]?.async) return;
    const input = box.querySelector('.ac-input'), val = box.querySelector('.ac-val');
    if (input && val && val.value !== input.value.trim()) val.value = input.value.trim();
  });
}

let OPEN = null;   // {box, input, items, idx, list}

function close(){ if (OPEN){ OPEN.list.remove(); OPEN.input.setAttribute('aria-expanded','false'); OPEN = null; } }

function place(list, input){
  const r = input.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  list.style.left = r.left + 'px'; list.style.width = Math.max(r.width, 280) + 'px';
  if (below < 240 && r.top > below){ list.style.bottom = (window.innerHeight - r.top + 4) + 'px'; list.style.top = 'auto'; }
  else { list.style.top = (r.bottom + 4) + 'px'; list.style.bottom = 'auto'; }
}

function draw(){
  const {list, items, idx} = OPEN;
  list.innerHTML = items.length ? items.map((it,i) => `<div class="ac-item ${i===idx?'on':''} ${it.create?'create':''}" data-i="${i}" role="option">
      <span>${esc(it.label)}</span>${it.hint?`<small>${esc(it.hint)}</small>`:''}</div>`).join('')
    : `<div class="ac-empty">${OPEN.loading ? 'Recherche…' : 'Aucun résultat'}</div>`;
}

async function update(input){
  const box = input.closest('.ac'), kind = box.dataset.ac, src = SOURCES[kind];
  const q = input.value.trim();
  if (!OPEN || OPEN.input !== input){
    close();
    const list = document.createElement('div'); list.className = 'ac-list'; list.setAttribute('role','listbox');
    (input.closest('dialog') || document.body).appendChild(list);
    OPEN = {box, input, list, items:[], idx:0};
    input.setAttribute('aria-expanded','true');
  }
  place(OPEN.list, input);
  if (!q){ OPEN.items = []; OPEN.loading = false; draw(); return; }
  const token = OPEN.token = Symbol();
  let items;
  if (src.async){
    const local = src.local ? src.local(q) : [];
    OPEN.items = local; OPEN.loading = !local.length; draw();
    items = await src.search(q); if (!OPEN || OPEN.token !== token) return; OPEN.loading = false;
    // villes connues d'abord, puis les autres (sans doublon)
    const seen = new Set(local.map(x => norm(x.city) + '|' + x.department_code));
    items = local.concat(items.filter(x => !seen.has(norm(x.city || '') + '|' + (x.department_code || '')))).slice(0, 10);
  }
  else items = src.search(q);
  if (box.dataset.create) items = items.concat([{create:true, label:`+ Créer « ${q} »`, q}]);
  OPEN.items = items; OPEN.idx = 0; draw();
}

async function choose(i){
  if (!OPEN) return;
  const {box, input, items} = OPEN; const it = items[i]; if (!it) return;
  close();
  let chosen = it;
  if (it.create){
    const fn = CREATORS[box.dataset.ac]; if (!fn) return;
    chosen = await fn(it.q); if (!chosen) return;
  }
  const val = box.querySelector('.ac-val');
  input.value = SOURCES[box.dataset.ac].async ? (chosen.id ?? chosen.label) : chosen.label;
  if (box.hasAttribute('data-fill')) fillPlace(box, chosen);
  if (chosen.id !== undefined && val.value !== String(chosen.id ?? '')){ val.value = chosen.id ?? ''; val.dispatchEvent(new Event('change', {bubbles:true})); }
  box.dispatchEvent(new CustomEvent('ac-chosen', {bubbles:true, detail: chosen}));
}

/** Adresse choisie : remplit adresse, code postal, ville, département, région, pays, coordonnées */
function fillPlace(box, p){
  const root = box.closest('form') || document;
  // un lieu choisi remplace TOUT l'emplacement : ce que le nouveau lieu n'indique pas est vidé (pas d'ancien département / région qui traîne)
  const set = (k, v) => { const el = root.querySelector(`[name="${box.dataset.fill}${k}"]`); v = v ?? ''; if (el && el !== box.querySelector('.ac-val') && el.value !== String(v)) { el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); if (!el.closest('form')) el.dispatchEvent(new Event('change', {bubbles:true})); } };
  set('address', p.street);
  set('postal_code', p.postcode); set('city', p.city); set('region', p.region); set('country', p.country);
  set('department_code', p.department_code); set('department_name', p.department_name);
  set('department', p.department_code || (p.country && p.country !== 'France' ? p.country_code : null));
  set('lat', p.lat); set('lng', p.lng);
}

document.addEventListener('input', e => { if (e.target.classList?.contains('ac-input')){ clearTimeout(e.target._t); const t = e.target; const async = SOURCES[t.closest('.ac').dataset.ac].async; t._t = setTimeout(() => update(t), async ? 160 : 60); } });
// tout le texte est sélectionné au clic (on tape par-dessus) ; pas sur téléphone, où la sélection forcée gêne le « Coller »
document.addEventListener('focusin', e => { if (e.target.classList?.contains('ac-input')){ if (!matchMedia('(pointer:coarse)').matches) e.target.select(); if (e.target.value) update(e.target); } });
document.addEventListener('keydown', e => {
  if (!e.target.classList?.contains('ac-input')) return;
  if (!OPEN || OPEN.input !== e.target){ if (e.key === 'ArrowDown'){ update(e.target); e.preventDefault(); } return; }
  if (e.key === 'ArrowDown'){ OPEN.idx = Math.min(OPEN.idx+1, OPEN.items.length-1); draw(); e.preventDefault(); }
  else if (e.key === 'ArrowUp'){ OPEN.idx = Math.max(OPEN.idx-1, 0); draw(); e.preventDefault(); }
  else if (e.key === 'Enter'){ e.preventDefault(); if (OPEN.items.length) choose(OPEN.idx); }
  else if (e.key === 'Escape'){ close(); }
});
document.addEventListener('mousedown', e => {
  const it = e.target.closest('.ac-item');
  if (it && OPEN){ e.preventDefault(); choose(Number(it.dataset.i)); return; }
  if (OPEN && !e.target.closest('.ac-list') && e.target !== OPEN.input) close();
});
document.addEventListener('focusout', e => {
  if (!e.target.classList?.contains('ac-input')) return;
  const input = e.target;
  setTimeout(() => {
    if (OPEN && OPEN.input === input) close();
    // Champ vidé → on retire le lien
    const box = input.closest('.ac'); if (!box) return;
    const val = box.querySelector('.ac-val');
    if (SOURCES[box.dataset.ac].async){   // ville / adresse : le texte tapé compte même sans suggestion choisie
      if (val.value !== input.value.trim()){ val.value = input.value.trim(); val.dispatchEvent(new Event('change', {bubbles:true})); }
      return;
    }
    if (!input.value.trim() && val.value){ val.value = ''; val.dispatchEvent(new Event('change', {bubbles:true})); }
    else if (val.value){ input.value = SOURCES[box.dataset.ac].label(val.value) || input.value; }
  }, 150);
});
window.addEventListener('scroll', () => { if (OPEN) place(OPEN.list, OPEN.input); }, true);
window.addEventListener('resize', () => { if (OPEN) place(OPEN.list, OPEN.input); });   // le clavier du téléphone redimensionne l'écran : la liste suit au lieu de se fermer
