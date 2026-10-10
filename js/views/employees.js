/**
 * Onglet Salariés : liste, fiche complète (état civil, paie, pièces), questionnaire en ligne,
 * import de l'export Movinmotion, dépôt des bulletins de paie / notes de frais.
 * Les pièces sont rangées dans le dossier Drive du salarié par le script Google, avec les noms :
 *   « RIB - NOM Prénom », « BDS-NOM Prénom AAAA-MM-JJ », « NDF-AAAA-MM NOM Prénom ».
 */
import { render } from '../app.js';
import { insert, remove, save, sb } from '../data.js';
import { callScript } from '../mail.js';
import { RH_DOCS, RH_FIELDS, RH_SECTIONS, RH_TEAM_FIELDS, fullName } from '../rh-fields.js';
import { byId, setting } from '../selectors.js';
import { S } from '../state.js';
import { viewHead } from '../ui/bits.js';
import { openModal } from '../ui/modal.js';
import { esc, fmtDate, matches, norm, parseCSV, toast } from '../utils.js';

const REQ = RH_FIELDS.filter(f => f.req);
const val = (e, f) => f.col ? e[f.k] : e.info?.[f.k];
const docKinds = e => new Set((e.docs || []).map(d => d.kind));
const pending = e => (e.docs || []).filter(d => d.path && !d.file_id).length;

export function viewEmployees(){
  const q = S.search.employees || '';
  const showOff = !!S.showInactiveEmployees;
  const all = S.db.employees.slice().sort((a,b) => fullName(a).localeCompare(fullName(b)));
  const rows = all.filter(e => (showOff || e.active) && matches([fullName(e), e.email, e.role, e.phone].join(' '), q));
  const waiting = all.reduce((n, e) => n + pending(e), 0);
  const head = viewHead('Salariés', {sub: `${all.filter(e => e.active).length} salarié${all.length > 1 ? 's' : ''}`,
    filters: `<input class="search" type="search" autocomplete="off" data-1p-ignore placeholder="Nom, poste, mail…" data-search="employees" value="${esc(q)}">
      <label class="check-line" style="margin:0"><input type="checkbox" data-act="toggleInactiveEmployees" ${showOff ? 'checked' : ''}> Anciens salariés</label>`,
    actions: `<label class="btn file-btn">Importer l’export Movinmotion<input type="file" class="file-input" accept=".csv,text/csv" data-mm-import="1"></label>
      ${waiting ? `<button class="btn" data-act="rhFileDocs">Ranger ${waiting} pièce${waiting > 1 ? 's' : ''} dans le Drive</button>` : ''}
      <button class="btn primary" data-act="newEmployee">Nouveau salarié</button>`});
  return head + `<div class="tbl-wrap panel"><table class="emp-table"><thead><tr><th>Nom</th><th>Poste</th><th>Mail</th><th>Téléphone</th><th>Fiche</th><th>Pièces</th><th>Drive</th></tr></thead><tbody>
    ${rows.map(e => {
      const filled = REQ.filter(f => val(e, f)).length, kinds = docKinds(e);
      return `<tr class="${e.active ? '' : 'muted'}" data-act="openEmployee" data-id="${e.id}" style="cursor:pointer">
        <td><b>${esc(fullName(e) || 'Sans nom')}</b></td><td>${esc(e.role || '')}</td><td>${esc(e.email || '')}</td><td class="nowrap">${esc(e.phone || '')}</td>
        <td><span class="${filled === REQ.length ? 'ok-badge' : 'warn-badge'}">${filled}/${REQ.length}</span>${e.form_submitted_at ? ` <span class="muted" title="Questionnaire rempli">✓ ${fmtDate(e.form_submitted_at.slice(0,10))}</span>` : e.form_sent_at ? ' <span class="muted">questionnaire envoyé</span>' : ''}</td>
        <td class="nowrap">${RH_DOCS.filter(d => d[2]).map(([k, l]) => `<span class="doc-chip ${kinds.has(k) ? 'on' : ''}" title="${esc(l)}">${esc(l)}</span>`).join(' ')}${pending(e) ? ` <span class="warn-badge">${pending(e)} à ranger</span>` : ''}</td>
        <td>${e.drive_folder_id ? `<a href="https://drive.google.com/drive/folders/${esc(e.drive_folder_id)}" target="_blank" rel="noopener" data-stop="1">Dossier</a>` : '<span class="muted">—</span>'}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">Aucun salarié.</td></tr>'}
  </tbody></table></div>`;
}

// ─────────────── Fiche ───────────────

export function editEmployee(id){
  const e = id ? byId('employees', id) : {active: true, info: {}, docs: []};
  const fields = [];
  RH_SECTIONS.forEach(sec => {
    fields.push({k:'_h_' + sec.title, type:'html', full:true, html:`<h3 class="block-title" style="margin:6px 0 0">${esc(sec.title)}</h3>`});
    sec.fields.forEach(f => fields.push({k:f.k, label:f.label, full:f.full, type: f.type === 'choice' ? 'select' : f.type === 'tel' ? 'text' : f.type, options:f.options}));
  });
  fields.push({k:'_h_team', type:'html', full:true, html:'<h3 class="block-title" style="margin:6px 0 0">Équipe</h3>'});
  RH_TEAM_FIELDS.forEach(f => fields.push({k:f.k, label:f.label, full:f.full, type:f.type, placeholder:f.placeholder}));
  fields.push({k:'active', label:'Salarié actif', type:'checkbox'});
  const values = {...Object.fromEntries([...RH_FIELDS, ...RH_TEAM_FIELDS].map(f => [f.k, val(e, f)])), active: e.active, id};
  const mm = e.info?.movinmotion || {};
  const extra = id ? `<div class="mail-wrap emp-extra">
    <h3 class="block-title">Questionnaire en ligne</h3>
    <p class="help">Le salarié complète sa fiche et envoie ses pièces (RIB, carte vitale…) depuis son téléphone. ${e.form_submitted_at ? `Rempli le ${fmtDate(e.form_submitted_at.slice(0,10))}.` : e.form_sent_at ? `Envoyé le ${fmtDate(e.form_sent_at.slice(0,10))}.` : ''}</p>
    <div class="vh-actions"><button type="button" class="btn sm primary" data-act="rhSendForm" data-id="${e.id}">Envoyer le questionnaire</button>
      <button type="button" class="btn sm" data-act="rhCopyLink" data-id="${e.id}">Copier le lien</button></div>
    <h3 class="block-title" style="margin-top:16px">Pièces et documents</h3>
    ${docsHTML(e)}
    <div class="vh-actions" style="margin-top:8px">
      <select class="sel" id="emp-doc-kind" aria-label="Type de pièce">${RH_DOCS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}<option value="bds">Bulletin de paie</option><option value="ndf">Note de frais</option><option value="autre">Autre</option></select>
      <input id="emp-doc-when" placeholder="Bulletin : 2026-09-12 ou 2026-09-12_25 · NDF : 2026-09" title="Date(s) du bulletin de paie ou mois de la note de frais" style="min-width:260px">
      <label class="btn sm primary file-btn">Ajouter le fichier<input type="file" class="file-input" multiple data-emp-doc="${e.id}"></label>
    </div>
    <p class="help">Les fichiers sont rangés dans le dossier Drive du salarié avec le bon nom : « RIB - ${esc(fullName(e))} », « BDS-${esc(fullName(e))} 2026-09-12 », « NDF-2026-09 ${esc(fullName(e))} ».</p>
    <div class="vh-actions">${e.drive_folder_id ? `<a class="btn sm" href="https://drive.google.com/drive/folders/${esc(e.drive_folder_id)}" target="_blank" rel="noopener">Ouvrir le dossier Drive</a>` : `<button type="button" class="btn sm" data-act="rhFolder" data-id="${e.id}">Créer le dossier Drive</button>`}
      ${pending(e) ? `<button type="button" class="btn sm primary" data-act="rhFileDocs">Ranger les pièces dans le Drive</button>` : ''}</div>
    ${Object.keys(mm).length ? `<details style="margin-top:14px"><summary>Données de l’export Movinmotion (${Object.keys(mm).length})</summary><dl class="fiche-dl" style="margin-top:8px">${Object.entries(mm).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>` : ''}
  </div>` : '';
  return openModal({title: id ? fullName(e) || 'Salarié' : 'Nouveau salarié', wide: true, fields, values, extraTop: extra,
    onDelete: id ? () => remove('employees', id) : null,
    onSave: async v => {
      const row = {active: !!v.active, info: {...(e.info || {})}, updated_at: new Date().toISOString()};
      [...RH_FIELDS, ...RH_TEAM_FIELDS].forEach(f => { const x = v[f.k] ?? null; if (f.col) row[f.k] = x; else if (x == null) delete row.info[f.k]; else row.info[f.k] = x; });
      if (row.last_name) row.last_name = row.last_name.toUpperCase();
      if (id) return !!(await save('employees', id, row, {rerender:false}));
      const created = await insert('employees', row);
      if (created && setting('drive_webhook_url')) callScript('rh_folders', {}).then(() => import('../data.js').then(m => m.loadAll()).then(render)).catch(() => {});
      return !!created;
    }});
}

function docsHTML(e){
  const docs = (e.docs || []).slice().sort((a,b) => (b.at || '').localeCompare(a.at || ''));
  const kinds = docKinds(e);
  const missing = RH_DOCS.filter(([k,, req]) => req && !kinds.has(k)).map(d => d[1]);
  return `${missing.length ? `<p class="err" style="margin:0 0 6px">Manque : ${missing.map(esc).join(', ')}</p>` : ''}
    ${docs.length ? `<ul class="doc-list">${docs.map(d => `<li>${d.file_id ? `<a href="https://drive.google.com/file/d/${esc(d.file_id)}/view" target="_blank" rel="noopener">${esc(d.drive_name || d.target || d.name)}</a>` : `<span>${esc(d.target || d.label || d.kind)} <span class="muted">(${esc(d.name)})</span></span> <span class="warn-badge">à ranger</span>`}
      <span class="muted">${d.at ? fmtDate(d.at.slice(0,10)) : ''}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune pièce pour l’instant.</p>'}`;
}

// ─────────────── Actions ───────────────

const formLink = e => (setting('site_url') || location.origin + location.pathname.replace(/[^/]*$/, '')) + 'rh.html?t=' + e.form_token;

export const EMP_ACTIONS = {
  newEmployee: () => editEmployee(null),
  openEmployee: (t, ev) => { if (ev.target.closest('[data-stop]')) return; editEmployee(t.dataset.id); },
  toggleInactiveEmployees: () => { S.showInactiveEmployees = !S.showInactiveEmployees; render(); },
  rhCopyLink: async t => { const link = formLink(byId('employees', t.dataset.id));
    try { await navigator.clipboard.writeText(link); toast('Lien du questionnaire copié'); } catch { prompt('Lien du questionnaire :', link); } },
  rhSendForm: async t => {
    const e = byId('employees', t.dataset.id);
    if (!e.email) return toast('Ajoute d’abord son mail', true);
    const link = formLink(e);
    const html = `<p>Bonjour ${esc(e.first_name || '')},</p><p>Pour préparer tes contrats et bulletins de paie avec L’ArtBoristerie Productions, peux-tu compléter ta fiche salarié et nous envoyer tes pièces (RIB, carte vitale, pièce d’identité…) ici :</p><p><a href="${link}">Compléter ma fiche salarié</a></p><p>Ça prend 5 minutes, depuis ton téléphone si tu veux. Merci !</p><p>Chloé</p>`;
    const subject = 'L’ArtBoristerie Productions • Ta fiche salarié';
    try {
      if (setting('drive_webhook_url')){ const out = await callScript('draft', {to: e.email, subject, html}); toast('Brouillon créé dans Gmail', false, out.url ? {label:'Ouvrir', fn: () => window.open(out.url, '_blank')} : null); }
      else { location.href = `mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Bonjour ${e.first_name || ''},\n\nPour préparer tes contrats et bulletins de paie, peux-tu compléter ta fiche salarié et nous envoyer tes pièces ici :\n${link}\n\nMerci !`)}`; }
      await save('employees', e.id, {form_sent_at: new Date().toISOString()}, {rerender:false});
    } catch (err) { toast(err.message, true); }
  },
  rhFolder: async () => { try { const out = await callScript('rh_folders', {}); toast(`${out.created || 0} dossier(s) créé(s), ${out.linked || 0} rattaché(s)`); await reload(); } catch (err) { toast(err.message, true); } },
  rhFileDocs: async t => { if (t) t.disabled = true; toast('Rangement des pièces dans le Drive…');
    try { const out = await callScript('rh_file_docs', {}); toast(`${out.filed} pièce(s) rangée(s) dans le Drive`); await reload(); } catch (err) { toast(err.message, true); }
    if (t) t.disabled = false; },
};
async function reload(){ const m = await import('../data.js'); await m.loadAll(); if (document.querySelector('#modal').open) document.querySelector('#modal').close(); render(); }

/** Nom du fichier dans le Drive pour une pièce déposée par l'équipe */
function targetName(e, kind, when){
  const n = fullName(e);
  if (kind === 'bds') return `BDS-${n} ${when || new Date().toISOString().slice(0,10)}`;
  if (kind === 'ndf') return `NDF-${(when || new Date().toISOString()).slice(0,7)} ${n}`;
  const d = RH_DOCS.find(x => x[0] === kind);
  return `${d ? d[1] : 'Document'} - ${n}`;
}

document.addEventListener('change', async ev => {
  const id = ev.target.dataset?.empDoc; if (!id || !ev.target.files.length) return;
  const e = byId('employees', id);
  const kind = document.getElementById('emp-doc-kind').value, when = document.getElementById('emp-doc-when').value.trim();
  if (['bds','ndf'].includes(kind) && !when) return toast(kind === 'bds' ? 'Indique la ou les dates du bulletin (ex. 2026-09-12 ou 2026-09-12_25)' : 'Indique le mois de la note de frais (ex. 2026-09)', true);
  const docs = [...(e.docs || [])];
  let i = 0;
  for (const file of ev.target.files){
    const ext = (file.name.match(/\.(\w{1,5})$/) || ['', 'pdf'])[1].toLowerCase();
    const path = `equipe/${id}/${kind}_${Date.now()}_${++i}.${ext}`;
    const {error} = await sb.storage.from('rh').upload(path, file, {contentType: file.type || 'application/octet-stream'});
    if (error) return toast('Envoi impossible : ' + error.message, true);
    const target = targetName(e, kind, when) + (ev.target.files.length > 1 && !['bds','ndf'].includes(kind) ? ` (${i})` : '');
    docs.push({kind, label: kind, path, name: file.name, target, at: new Date().toISOString()});
  }
  await save('employees', id, {docs}, {rerender:false});
  toast(`${i} fichier(s) ajouté(s)${setting('drive_webhook_url') ? ' : rangement dans le Drive…' : ''}`);
  if (setting('drive_webhook_url')) EMP_ACTIONS.rhFileDocs(); else editEmployee(id);
});

// ─────────────── Import Movinmotion ───────────────

const ALL_FIELDS = [...RH_FIELDS, ...RH_TEAM_FIELDS];
const isoDate = s => { const m = String(s || '').match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : s; };

/** Crée ou met à jour les salariés depuis l'export Movinmotion ; avec projectId, les ajoute aussi aux membres du projet */
export async function importMovinmotion(file, projectId){
  const rows = parseCSV(await file.text());
  if (rows.length < 2) return toast('Fichier vide ou illisible', true);
  const head = rows[0].map(h => h.trim());
  const idx = {}; ALL_FIELDS.forEach(f => { if (f.mm){ const i = head.findIndex(h => f.mm.test(h)); if (i >= 0) idx[f.k] = i; } });
  const used = new Set(Object.values(idx));
  let added = 0, updated = 0, linked = 0;
  for (const r of rows.slice(1)){
    const g = k => idx[k] != null ? (r[idx[k]] || '').trim() : '';
    const row = {info: {}, movinmotion: {}};
    ALL_FIELDS.forEach(f => { let x = g(f.k); if (!x) return; if (f.type === 'date') x = isoDate(x); if (f.col) row[f.k] = x; else row.info[f.k] = x; });
    head.forEach((h, i) => { if (h && !used.has(i) && (r[i] || '').trim()) row.movinmotion[h] = r[i].trim(); });
    if (!row.first_name && !row.last_name && !row.email) continue;
    if (row.last_name) row.last_name = row.last_name.toUpperCase();
    let emp = S.db.employees.find(x => (row.email && x.email && x.email.toLowerCase() === row.email.toLowerCase())
      || (norm(x.last_name) === norm(row.last_name) && norm(x.first_name) === norm(row.first_name)));
    const info = {...(emp?.info || {}), ...row.info, movinmotion: {...(emp?.info?.movinmotion || {}), ...row.movinmotion}};
    const patch = {info}; ['first_name','last_name','email','phone','role'].forEach(k => { if (row[k]) patch[k] = row[k]; });
    if (emp){ await save('employees', emp.id, patch, {rerender:false}); updated++; }
    else { emp = await insert('employees', {...patch, active: true}); if (emp) added++; }
    if (projectId && emp){
      const m = S.db.project_members.find(x => x.project_id === projectId && (x.employee_id === emp.id || (row.email && x.email === row.email) || (x.first_name === row.first_name && norm(x.last_name) === norm(row.last_name))));
      const member = {project_id: projectId, employee_id: emp.id, first_name: emp.first_name, last_name: emp.last_name, email: emp.email, phone: emp.phone, role: emp.role || row.role || null,
        address: [info.address, info.address2, [info.postal_code, info.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null, birth_date: info.birth_date || null};
      if (m) await save('project_members', m.id, member, {rerender:false}); else await insert('project_members', member);
      linked++;
    }
  }
  toast(`${added} salarié(s) ajouté(s), ${updated} mis à jour${projectId ? ` · ${linked} membre(s) du projet` : ''}`);
  if (added && setting('drive_webhook_url')) callScript('rh_folders', {}).then(reload).catch(() => {});
  render();
}
document.addEventListener('change', ev => { if (ev.target.dataset?.mmImport && ev.target.files[0]) importMovinmotion(ev.target.files[0]); });
