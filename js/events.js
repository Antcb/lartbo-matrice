/**
 * Écoute des saisies et formulaires : filtres, journal des échanges, pièces jointes (bouton ou glisser-déposer),
 * recherche par distance, ajout de projets.
 */
import { render } from './app.js';
import { insert, save, uploadFiles } from './data.js';
import { geocode } from './geo.js';
import { byId, projIds } from './selectors.js';
import { S, localSet } from './state.js';
import { parseCSV, toast, today } from './utils.js';

// + Projet sur un suivi / une tâche
document.addEventListener('change', async e => {
  const pid = e.target.dataset?.addproj; if (!pid || !e.target.value) return;
  const tb = e.target.dataset.table || 'prospects', r = byId(tb, pid); const ids = [...new Set([...projIds(r), e.target.value])];
  await save(tb, pid, {project_ids: ids, project_id: ids[0]});
});

// Recherche « autour de » une ville (Structures)
document.addEventListener('submit', async e => {
  if (e.target.id !== 'near-form') return; e.preventDefault();
  const q = e.target.elements.autour.value.trim(), km = Number(e.target.elements.km.value);
  S.search.structures = e.target.elements.recherche.value;
  if (!q){ S.near = null; return render(); }
  toast('Recherche de la ville…');
  const g = await geocode(q);
  if (!g) return toast(`Ville introuvable : ${q}`, true);
  S.near = {label:q, lat:g.lat, lng:g.lng, km}; render();
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('[data-struct-tag]')){ S.structTag = t.value; render(); return; }
  if (t.form?.id === 'near-form' && t.name === 'km' && S.near){ S.near.km = Number(t.value); render(); return; }
  const k = t.dataset?.suiviFilter;
  if (k==='project'){ S.project = t.value; localSet('project', S.project); render(); }
  else if (k==='status'){ S.suiviStatus = t.value; render(); }
  else if (t.dataset?.todoDept !== undefined){ S.todoDept = t.value; render(); }
});

// Journal des échanges d'un suivi
document.addEventListener('submit', async e => {
  const pid = e.target.dataset?.logform; if (!pid) return; e.preventDefault();
  const f = e.target.elements;
  if (!f.body.value.trim() && !f.who.value.trim()) return toast("Écris au moins une note ou l'interlocuteur", true);
  const date = f.date.value || today();
  const row = await insert('prospect_logs', {prospect_id:pid, date, kind:f.kind.value, contact_name:f.who.value.trim()||null, body:f.body.value.trim()||null, author:S.user.email});
  if (row){ const p=byId('prospects',pid); if (row.date && (!p.last_contact || row.date>p.last_contact)) await save('prospects', pid, {last_contact:row.date}, {rerender:false}); render(); toast('Ajouté au journal'); }
});

// Journal des échanges d'un projet
document.addEventListener('submit', async e => {
  const pid = e.target.dataset?.projlog; if (!pid) return; e.preventDefault();
  const f = e.target.elements;
  const body = f.body.value.trim(), link = f.url?.value.trim();
  const files = [...(f.files?.files || [])];
  if (!body && !link && !files.length) return toast('Écris une note, colle un lien ou ajoute un fichier', true);
  const row = await insert('project_logs', {project_id:pid, date:f.date.value || today(), kind:f.kind.value, body:body||null, url:link||null, author:S.user.email});
  if (row && files.length) await uploadFiles({project_id:pid, project_log_id:row.id}, files);
  render(); toast('Ajouté aux échanges');
});

// Pièces jointes : bouton « Ajouter un fichier »
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset?.filelist){ const el = document.getElementById('fl-'+t.dataset.filelist); if (el) el.textContent = [...t.files].map(f=>f.name).join(', '); return; }
  if (!t.dataset?.uploadOwner) return;
  const files = [...t.files]; if (!files.length) return;
  await uploadFiles(JSON.parse(t.dataset.uploadOwner), files);
  render();
});

// Pièces jointes : glisser-déposer
const zoneOf = e => e.target.closest?.('[data-drop],[data-drop-form]');
['dragenter','dragover'].forEach(ev => document.addEventListener(ev, e => {
  const z = zoneOf(e); if (!z || !e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; z.classList.add('over');
}));
document.addEventListener('dragleave', e => { const z = zoneOf(e); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
document.addEventListener('drop', async e => {
  const z = zoneOf(e); if (!z) { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); return; }
  e.preventDefault(); z.classList.remove('over');
  const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return;
  if (z.dataset.dropForm){
    // dans un formulaire : on ajoute les fichiers au champ, envoyés à l'enregistrement
    const input = z.querySelector('input[type=file]'); const dt = new DataTransfer();
    [...(input.files||[]), ...files].forEach(f => dt.items.add(f)); input.files = dt.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    return;
  }
  await uploadFiles(JSON.parse(z.dataset.drop), files);
  render();
});
// Un fichier lâché hors d'une zone ne doit pas ouvrir le fichier dans l'onglet
document.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });

// Liens d'un projet (YouTube, Spotify… / dossiers Drive) : liste enregistrée dans le projet
document.addEventListener('change', async e => {
  const t = e.target; if (!t.dataset?.plink) return;
  const p = byId('projects', t.dataset.pid), f = t.dataset.plink, list = (p[f]||[]).map(x=>({...x}));
  list[Number(t.dataset.i)][t.dataset.k] = t.value.trim();
  await save('projects', p.id, {[f]: list});
});

// Coordonnées administratives d'une structure (champ JSON « admin »)
document.addEventListener('change', async e => {
  const t = e.target; if (!t.dataset?.admin) return;
  const st = byId('structures', t.dataset.sid);
  await save('structures', st.id, {admin: {...(st.admin||{}), [t.dataset.admin]: t.value.trim()}}, {rerender:false});
  toast('Enregistré');
});

// Espace de prospection : date en négociation
document.addEventListener('change', e => {
  if (e.target.dataset?.wsTarget === undefined) return;
  S.wsTarget = e.target.value || null; render();
});

// Import des membres d'un projet depuis un export Movinmotion (CSV)
const MEMBER_COLS = {
  first_name: /^pr[eé]nom/i, last_name: /^nom( de famille| d'usage| usuel)?$|^nom$/i, email: /mail/i, phone: /t[eé]l[eé]phone|portable|mobile/i,
  role: /emploi|fonction|poste|r[oô]le|m[eé]tier/i, address: /^adresse/i, birth_date: /naissance/i,
};
async function importMembers(projectId, file){
  const rows = parseCSV(await file.text());
  if (rows.length < 2) return toast('Fichier vide ou illisible', true);
  const head = rows[0].map(h => h.trim());
  const idx = {}; for (const [k, re] of Object.entries(MEMBER_COLS)){ const i = head.findIndex((h, j) => re.test(h) && !Object.values(idx).includes(j)); if (i>=0) idx[k] = i; }
  const cityI = head.findIndex(h => /^ville|commune/i.test(h)), cpI = head.findIndex(h => /code postal/i.test(h));
  let n = 0;
  for (const r of rows.slice(1)){
    const m = {project_id: projectId, data:{}};
    for (const [k, i] of Object.entries(idx)) m[k] = (r[i]||'').trim() || null;
    if (m.address && (cpI>=0 || cityI>=0)) m.address = [m.address, [r[cpI], r[cityI]].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (m.birth_date){ const d = m.birth_date.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); m.birth_date = d ? `${d[3]}-${d[2].padStart(2,'0')}-${d[1].padStart(2,'0')}` : /^\d{4}-\d{2}-\d{2}/.test(m.birth_date) ? m.birth_date.slice(0,10) : null; }
    head.forEach((h, i) => { if (!Object.values(idx).includes(i) && i!==cityI && i!==cpI && (r[i]||'').trim()) m.data[h] = r[i].trim(); });
    if (!m.first_name && !m.last_name && !m.email) continue;
    if (await insert('project_members', m)) n++;
  }
  toast(`${n} membre(s) importé(s)`); render();
}
document.addEventListener('change', e => { const pid = e.target.dataset?.membersImport; if (pid && e.target.files[0]) importMembers(pid, e.target.files[0]); });
document.addEventListener('drop', e => { const z = e.target.closest?.('[data-members-drop]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importMembers(z.dataset.membersDrop, f); });
document.addEventListener('dragover', e => { const z = e.target.closest?.('[data-members-drop]'); if (z){ e.preventDefault(); z.classList.add('over'); } });
