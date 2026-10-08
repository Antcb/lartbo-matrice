/**
 * Écoute des saisies et formulaires (filtres, journal, pièces jointes, recherche par distance).
 */
import { render } from './app.js';
import { insert, save, uploadFiles } from './data.js';
import { geocode } from './geo.js';
import { byId, projIds } from './selectors.js';
import { S, localSet } from './state.js';
import { toast } from './utils.js';

document.addEventListener('change', async e => {
  const pid = e.target.dataset?.addproj; if (!pid || !e.target.value) return;
  const tb = e.target.dataset.table || 'prospects', r = byId(tb, pid); const ids = [...new Set([...projIds(r), e.target.value])];
  if (tb==='prospects') S.focusProspect = pid;
  await save(tb, pid, {project_ids: ids, project_id: ids[0]});
});

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
  if (e.target.matches('[data-struct-tag]')){ S.structTag = e.target.value; render(); return; }
  if (e.target.form?.id === 'near-form' && e.target.name === 'km' && S.near){ S.near.km = Number(e.target.value); render(); }
});

document.addEventListener('change', e => {
  const k = e.target.dataset?.suiviFilter; if (!k) return;
  if (k==='project'){ S.project = e.target.value; localSet('project', S.project); }
  else S.suiviStatus = e.target.value;
  render();
});

document.addEventListener('submit', async e => {
  const pid = e.target.dataset?.logform; if (!pid) return; e.preventDefault();
  const f = e.target.elements;
  if (!f.body.value.trim() && !f.who.value.trim()) return toast("Écris au moins une note ou l'interlocuteur", true);
  const row = await insert('prospect_logs', {prospect_id:pid, date:f.date.value||null, kind:f.kind.value, contact_name:f.who.value.trim()||null, body:f.body.value.trim()||null, author:S.user.email});
  if (row){ const p=byId('prospects',pid); if (row.date && (!p.last_contact || row.date>p.last_contact)) await save('prospects', pid, {last_contact:row.date}, {rerender:false}); S.focusProspect=pid; render(); toast('Ajouté au journal'); }
});

document.addEventListener('change', async e => {
  const pid = e.target.dataset?.upload;
  if (e.target.dataset?.filelist){ const el = document.getElementById('fl-'+e.target.dataset.filelist); if (el) el.textContent = [...e.target.files].map(f=>f.name).join(', '); return; }
  if (!pid) return;
  const files = [...e.target.files]; if (!files.length) return;
  await uploadFiles(pid, files);
  S.focusProspect = pid; render();
});
