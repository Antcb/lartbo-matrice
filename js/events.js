/**
 * Écoute des saisies et formulaires : filtres, journal des échanges, pièces jointes (bouton ou glisser-déposer),
 * recherche par distance, ajout de projets.
 */
import { importMovinmotion } from './views/employees.js';
import { render } from './app.js';
import { insert, save, sb, uploadFiles } from './data.js';
import { geocode } from './geo.js';
import { byId, projIds } from './selectors.js';
import { S, localSet } from './state.js';
import { parseCSV, toast, today } from './utils.js';
import { setLogDraft } from './views/suivi.js';

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
  if (row){ setLogDraft(pid, {}); const p=byId('prospects',pid); if (row.date && (!p.last_contact || row.date>p.last_contact)) await save('prospects', pid, {last_contact:row.date}, {rerender:false}); render(); toast('Ajouté au journal'); autoSummary(pid); }
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
  if (t.dataset?.filelist){ showPicked(t); return; }
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

// Import des membres d'un projet depuis un export Movinmotion : crée / met à jour les salariés et les relie au projet
const importMembers = (projectId, file) => importMovinmotion(file, projectId);
document.addEventListener('change', e => { const pid = e.target.dataset?.membersImport; if (pid && e.target.files[0]) importMembers(pid, e.target.files[0]); });
document.addEventListener('drop', e => { const z = e.target.closest?.('[data-members-drop]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importMembers(z.dataset.membersDrop, f); });
document.addEventListener('dragover', e => { const z = e.target.closest?.('[data-members-drop]'); if (z){ e.preventDefault(); z.classList.add('over'); } });


/** Après un ajout au journal : résumé mis à jour par l'IA si une clé est configurée (sinon rien) */
async function autoSummary(pid){
  const {data, error} = await sb.functions.invoke('resume-suivi', {body:{prospect_id:pid}});
  if (error || !data?.summary) return;
  const p = byId('prospects', pid); if (!p) return;
  p.summary = data.summary; render(); toast('Résumé mis à jour par l’IA');
}

// Espace de prospection : rayon (curseur) et rattachement d'une date existante au suivi
document.addEventListener('input', e => { if (e.target.dataset?.wsRadius){ const v = document.getElementById('ws-radius-v'); if (v) v.textContent = e.target.value + ' km'; } });
document.addEventListener('change', e => { if (e.target.dataset?.wsRadius){ S.wsRadius = Number(e.target.value); render(); } });
document.addEventListener('change', async e => {
  const pid = e.target.dataset?.linkShow; if (!pid || !e.target.value) return;
  await save('shows', e.target.value, {prospect_id: pid});
  toast('Date rattachée au suivi');
});


/** Fichiers choisis dans un formulaire (pas encore envoyés) : liste avec ✕ pour en retirer un */
function showPicked(input){
  const el = document.getElementById('fl-'+input.dataset.filelist); if (!el) return;
  el.innerHTML = [...input.files].map((f,i)=>`<div class="file-row"><span class="file-ico" aria-hidden="true">📎</span><span>${f.name.replace(/</g,'&lt;')}</span>
    <button type="button" class="btn icon sm ghost danger" data-rmpick="${input.dataset.filelist}" data-i="${i}" aria-label="Retirer ${f.name.replace(/"/g,'')}">✕</button></div>`).join('');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rmpick]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const input = document.querySelector(`input[data-filelist="${b.dataset.rmpick}"]`); if (!input) return;
  const dt = new DataTransfer(); [...input.files].forEach((f,i) => { if (i !== Number(b.dataset.i)) dt.items.add(f); });
  input.files = dt.files; showPicked(input);
}, true);

// Brouillon des notes d'échange : enregistré à chaque frappe
const saveDraft = e => { const f = e.target.closest?.('form[data-logform]'); if (!f) return;
  const el = f.elements; setLogDraft(f.dataset.logform, {date: el.date?.value || '', kind: el.kind.value, who: el.who.value, body: el.body.value}); };
document.addEventListener('input', saveDraft);
document.addEventListener('change', saveDraft);
