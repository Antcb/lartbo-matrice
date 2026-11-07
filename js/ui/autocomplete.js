/**
 * Champ de recherche avec suggestions (structures, dates, contacts, villes / adresses).
 * On voit ce qu'on tape, la liste se met à jour, ↑ ↓ Entrée pour choisir, et on peut créer
 * l'élément s'il n'existe pas (« + Créer … »).
 *
 * acInput(kind, {value, attrs, placeholder, create, fill}) :
 *   - kind  : une des SOURCES ci-dessous
 *   - attrs : attributs posés sur l'input caché qui porte l'identifiant (name="…" ou data-t/data-id/data-f)
 *   - fill  : pour les adresses, préfixe des champs du formulaire à remplir automatiquement
 *   - activeOnly : structures — les inactives (v1.54) ne sont pas proposées ; une ligne « Afficher aussi … » les montre sur demande ;
 *                  destinataires (rcpt) d'une prospection — contacts liés uniquement à des structures inactives, même principe (v1.60.2)
 * Au choix, l'input caché reçoit l'identifiant et déclenche « change » (enregistrement direct ou formulaire).
 */
import { byId, contactMails, isInactive, linksOfContact, linksOfStructure, onlyInactive, placeOfEvent, placeOfStructure, showLabel, structName } from '../selectors.js';
import { S } from '../state.js';
import { esc, fmtDate, hayOf, mailAddr, mailOk, mailParts, norm } from '../utils.js';
import { searchPlaces } from '../geo.js';

const LIMIT = 12;
/** Adresses d'un contact (mail 1, mail 2), sans doublon : même liste que pour « À » (contactMails) */
const mailsOf = c => contactMails(c).split(', ').filter(Boolean);

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

/** Destinataires (v1.60.3) : adresses déjà dans le champ lié à la recherche (box) */
const rcptChosen = box => { const src = box?.dataset.rcptFor && document.getElementById(box.dataset.rcptFor);
  return new Set(mailParts(src?.value).map(x => mailAddr(x).toLowerCase())); };
/** Une ligne par adresse : nom, puis adresse · structure(s) (inactives signalées) ; contacts de la structure du mail d'abord,
 *  contacts liés uniquement à des structures inactives en dernier (comme les structures) */
function rcptRows(contacts, q, box){
  const chosen = rcptChosen(box), sid = box?.dataset.structure, n = norm(q), hit = m => n && hayOf(m).includes(n) ? 0 : 1;
  return contacts.flatMap(c => {
    const mails = mailsOf(c), sts = linksOfContact(c.id), here = !!sid && sts.some(st => st.id === sid);
    const where = sts.length ? sts.slice(0, 3).map(st => st.name + (isInactive(st) ? ' (inactive)' : '')).join(', ') + (sts.length > 3 ? ` +${sts.length - 3}` : '') : 'sans structure';
    if (!mails.length) return [{id:'sans-adresse:' + c.id, label:c.display_name, inactive:onlyInactive(c), here, hint:['pas d’adresse mail', where].join(' · ')}];
    return [...mails].sort((a, b) => hit(a) - hit(b)).filter(m => !chosen.has(m.toLowerCase()))
      .map(m => ({id:m, label:c.display_name, inactive:onlyInactive(c), here,
        hint:[m, where, mails.length > 1 ? `adresse ${mails.indexOf(m) + 1} sur ${mails.length}` : '', onlyInactive(c) ? 'structures inactives uniquement' : ''].filter(Boolean).join(' · ')}));
  }).sort((a, b) => a.inactive - b.inactive || b.here - a.here);
}

export const SOURCES = {
  structures: {
    label: id => structName(id),
    search: q => rank(S.db.structures, q, s => `${s.name} — ${[s.city, s.department_code].filter(Boolean).join(' ')}${q.includes('@') ? ' ' + linksOfStructure(s.id).flatMap(c => [c.email, c.email_2]).filter(Boolean).join(' ') : ''}`)
      // structures inactives (v1.54) : toujours trouvables, mais après les autres et signalées
      .sort((a, b) => isInactive(a) - isInactive(b))
      .map(s => ({id:s.id, label:s.name, inactive:isInactive(s), hint:[s.city, s.department_code && '('+s.department_code+')', isInactive(s) && 'inactive'].filter(Boolean).join(' ')})),
  },
  contacts: {
    label: id => byId('contacts', id)?.display_name || '',
    search: q => rank(S.db.contacts, q, c => `${c.display_name} — ${c.email||''} ${c.email_2||''}`)
      .map(c => ({id:c.id, label:c.display_name, hint:[c.email, c.email_2].filter(Boolean).join(' · ')})),
  },
  // destinataires d'un mail (v1.60.2) : un contact se trouve par son nom ou par N'IMPORTE LAQUELLE de ses adresses, et chacune de
  // ses adresses est proposée (une ligne par adresse, celle qui correspond à la saisie d'abord) ; l'identifiant est l'adresse.
  // Champ unique (v1.60.3, demande d'Anthony du 07/11) : la recherche est dans le champ Destinataire / Copie lui-même (box) ;
  // champ vide = adresses des contacts de la structure du mail ; adresses déjà choisies jamais reproposées ; nom, adresse et
  // structure(s) lisibles ; contacts de la structure du mail d'abord ; adresse complète tapée = « Ajouter … » (ajout libre).
  rcpt: {
    label: () => '',
    empty: box => rcptRows(linksOfStructure(box?.dataset.structure), '', box),
    search: (q, box) => {
      const rows = rcptRows(rank(S.db.contacts, q, c => `${c.display_name} — ${c.email||''} ${c.email_2||''}`), q, box);
      const a = mailAddr(q), chosen = rcptChosen(box);
      const free = mailOk(a) && a.includes('@') && !chosen.has(a.toLowerCase()) && !rows.some(r => r.id.toLowerCase() === a.toLowerCase())
        ? [{id: q.trim(), label: `Ajouter « ${q.trim()} »`, hint: 'adresse saisie'}] : [];
      return free.concat(rows);
    },
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
  // Lieu d'une date ou d'un suivi (v1.60.2) : salles / festivals connus (fiches structures et leurs événements) ; le nom tapé
  // sans choisir reste tel quel. lieuxAdr : avec en plus les adresses (Géoplateforme / OpenStreetMap), pour le lieu d'un suivi.
  lieux: { async: true, mixed: true, label: () => '', local: q => knownPlaces(q), search: async () => [] },
  lieuxAdr: { async: true, mixed: true, label: () => '', local: q => knownPlaces(q),
    search: async q => (await searchPlaces(q)).map(p => ({...p, id: p.label, venue: null, hint: 'adresse'})) },
  // adresse complète enregistrée telle quelle (membres, livraison des affiches…)
  fulladdr: { async: true, label: () => '', search: async q => (await searchPlaces(q)).map(p => ({...p, id: p.label, label: p.label})) },
};

/** Lieux connus (v1.60.2) : une suggestion porte le lieu entier (nom, adresse, code postal, ville, département, coordonnées) ;
 *  structures inactives après les autres et signalées */
function knownPlaces(q){
  const rows = [...S.db.structures.map(r => ({st: r})), ...(S.db.structure_events || []).map(r => ({ev: r}))];
  return rank(rows, q, x => x.st ? `${x.st.name} — ${[x.st.address, x.st.postal_code, x.st.city].filter(Boolean).join(' ')}`
      : `${x.ev.name} — ${[x.ev.place, x.ev.city, structName(x.ev.structure_id)].filter(Boolean).join(' ')}`, 8)
    .sort((a, b) => isInactive(a.st || byId('structures', a.ev.structure_id)) - isInactive(b.st || byId('structures', b.ev.structure_id)))
    .map(x => { const pl = x.st ? placeOfStructure(x.st) : placeOfEvent(x.ev); if (!pl?.venue) return null;
      const where = [pl.address, [pl.postal_code, pl.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      // place_structure : la structure elle-même choisie comme lieu (vaut confirmation de son adresse, décision du 07/11/2026)
      return {...pl, id: pl.venue, label: pl.venue, street: pl.address, place_structure: x.st ? x.st.id : null, postcode: pl.postal_code, department_code: pl.department,
        hint: [x.ev ? [x.ev.place, 'événement de ' + structName(x.ev.structure_id)].filter(Boolean).join(', ') : '', where, isInactive(x.st) ? 'inactive' : ''].filter(Boolean).join(' · ')}; })
    .filter(Boolean);
}

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

/** inputAttrs / boxAttrs (v1.60.3) : attributs du champ visible (id, aria-label…) et de son conteneur (contexte de la recherche) */
export function acInput(kind, {value='', text, attrs='', placeholder='Rechercher…', create=false, fill=false, activeOnly=false, inputAttrs='', boxAttrs=''}={}){
  const label = text ?? (value ? SOURCES[kind].label(value) : '');
  return `<span class="ac" data-ac="${kind}" ${create?'data-create="1"':''} ${activeOnly?'data-active-only="1"':''} ${fill!==false && fill!=null ?`data-fill="${esc(fill)}"`:''} ${boxAttrs}>
    <input type="text" class="ac-input" ${inputAttrs} value="${esc(label)}" placeholder="${esc(placeholder)}" autocomplete="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true" role="combobox" aria-expanded="false" aria-autocomplete="list">
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
  list.innerHTML = items.length ? items.map((it,i) => `<div class="ac-item ${i===idx?'on':''} ${it.create||it.more?'create':''}" data-i="${i}" role="option">
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
  if (!q && !src.empty){ OPEN.items = []; OPEN.loading = false; draw(); return; }
  const token = OPEN.token = Symbol();
  let items;
  if (src.async){
    const local = src.local ? src.local(q) : [];
    OPEN.items = local; OPEN.loading = !local.length; draw();
    items = await src.search(q); if (!OPEN || OPEN.token !== token) return; OPEN.loading = false;
    // villes connues d'abord, puis les autres (sans doublon)
    // lieux (v1.60.2) : lieux connus puis adresses, sans dédoublonnage par ville (plusieurs lieux dans une même ville)
    const seen = src.mixed ? null : new Set(local.map(x => norm(x.city) + '|' + x.department_code));
    items = local.concat(items.filter(x => !seen || !seen.has(norm(x.city || '') + '|' + (x.department_code || '')))).slice(0, src.mixed ? 12 : 10);
  }
  else items = q ? src.search(q, box) : src.empty(box);   // champ vide : propositions de départ (destinataires, v1.60.3)
  // nouvelle prospection (v1.56) : structures inactives masquées par défaut, montrées seulement sur demande explicite
  if (box.dataset.activeOnly && !box._showInactive){
    const n = items.filter(it => it.inactive).length;
    items = items.filter(it => !it.inactive);
    if (n) items.push(kind === 'rcpt'
      // prospection (v1.60.2) : contacts liés uniquement à des structures inactives, montrés seulement sur demande
      ? {more:true, label:`Afficher aussi ${n} adresse${n>1?'s':''} de contacts liés uniquement à des structures inactives`, hint:'hors prospection par défaut'}
      : {more:true, label:`Afficher aussi ${n} structure${n>1?'s':''} inactive${n>1?'s':''}`, hint:'fermée(s), gardée(s) avec leur historique'});
  }
  if (box.dataset.create) items = items.concat([{create:true, label:`+ Créer « ${q} »`, q}]);
  if (!q && !items.length) return close();   // rien à proposer sur un champ vide : pas de liste « Aucun résultat »
  OPEN.items = items; OPEN.idx = 0; draw();
}

async function choose(i){
  if (!OPEN) return;
  const {box, input, items} = OPEN; const it = items[i]; if (!it) return;
  if (it.more){ box._showInactive = true; return update(input); }   // la liste reste ouverte, inactives comprises (signalées)
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
  // champ cible lui-même à suggestions (ville, adresse d'une date — v1.60.2) : son texte visible suit, sinon il serait repris à l'enregistrement
  const set = (k, v) => { const el = root.querySelector(`[name="${box.dataset.fill}${k}"]`); v = v ?? ''; if (el && el !== box.querySelector('.ac-val') && el.value !== String(v)) { el.value = v;
    if (el.classList.contains('ac-val')){ const vis = el.closest('.ac')?.querySelector('.ac-input'); if (vis) vis.value = v; }
    el.dispatchEvent(new Event('input', {bubbles:true})); if (!el.closest('form')) el.dispatchEvent(new Event('change', {bubbles:true})); } };
  set('address', p.street);
  set('postal_code', p.postcode); set('city', p.city); set('region', p.region); set('country', p.country);
  set('department_code', p.department_code); set('department_name', p.department_name);
  set('department', p.department_code || (p.country && p.country !== 'France' ? p.country_code : null));
  set('lat', p.lat); set('lng', p.lng);
}

document.addEventListener('input', e => { if (e.target.classList?.contains('ac-input')){ clearTimeout(e.target._t); const t = e.target; const async = SOURCES[t.closest('.ac').dataset.ac].async; t._t = setTimeout(() => update(t), async ? 160 : 60); } });
// tout le texte est sélectionné au clic (on tape par-dessus) ; pas sur téléphone, où la sélection forcée gêne le « Coller »
document.addEventListener('focusin', e => { if (e.target.classList?.contains('ac-input')){ if (!matchMedia('(pointer:coarse)').matches) e.target.select(); if (e.target.value || SOURCES[e.target.closest('.ac').dataset.ac].empty) update(e.target); } });
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
