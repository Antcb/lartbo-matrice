/**
 * 📄 Fiche de renseignements → validation par l'équipe → contrat (Google Doc puis PDF dans le Drive).
 *
 * 1. L'organisateur remplit la fiche (fiche.html) : ses réponses restent « à valider ».
 * 2. validateFiche() : l'équipe compare ses réponses aux infos connues, corrige et valide.
 *    Les coordonnées sont alors recopiées sur la structure et « Pré-contrat complété » est coché.
 * 3. generateContract() : le script Google copie le modèle (Réglages › Contrats) dans le dossier
 *    de la date, remplit les balises <<…>> et les montants, puis exportContractPdf() en fait un PDF.
 */
import { paymentsOf, payAmount, showVat } from './calc.js';
import { save } from './data.js';
import { FICHE_SECTIONS, ficheDefaults, ficheKind, fieldOn } from './fiche-fields.js';
import { callScript } from './mail.js';
import { byId, setting } from './selectors.js';
import { openModal } from './ui/modal.js';
import { esc, fmtDate, toast, today } from './utils.js';

const stripCode = name => String(name || '').replace(/\s*•.*$/, '').trim();
const venueName = v => String(v || '').replace(/\*\*/g, '').replace(/\s*•\s*[A-Z/]{1,5}\s*$/, '').trim();
const num = n => n == null || n === '' ? '' : Number(n).toLocaleString('fr-FR', {minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2}).replace(/ /g, ' ');
const longDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'}).replace(/^(\D+ )1 /, '$11er ') : '';
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

/** Ce que l'app sait déjà de la date (proposé quand l'organisateur n'a rien répondu) */
function knownValues(s){
  const st = byId('structures', s.structure_id);
  const defs = ficheDefaults({structure: st, venue: venueName(s.venue), city: s.city, cp: st?.postal_code || s.department, capacity: s.capacity ?? st?.capacity_1, ticketing_type: s.ticketing_type});
  return {...defs, ...(st?.admin || {})};
}

// ─────────────── Validation de la fiche ───────────────

export function validateFiche(showId){
  const s = byId('shows', showId); const st = byId('structures', s.structure_id);
  const kind = ficheKind(s.contract_type);
  const fiche = s.fiche || {}, answers = {...fiche, ...(fiche.admin || {})};
  const known = knownValues(s), kept = s.contract_data || {};
  const pick = f => kept[f.k] ?? (answers[f.k] !== undefined && answers[f.k] !== '' ? answers[f.k] : known[f.k]) ?? '';
  const rows = FICHE_SECTIONS.map(sec => {
    const fields = sec.fields.filter(f => fieldOn(f, kind, {...known, ...answers, ...kept}) || (f.if && answers[f.if[0]] === undefined));
    if (!fields.length) return '';
    return `<tr class="vf-sec"><th colspan="3">${esc(sec.title)}</th></tr>` + fields.map(f => {
      const a = answers[f.k], k = known[f.k];
      const diff = f.src === 'admin' && k && a && String(k).trim() !== String(a).trim();
      const ctl = f.type === 'choice'
        ? `<select name="${f.k}"><option value=""></option>${f.options.map(o => `<option ${o === pick(f) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : f.type === 'textarea' ? `<textarea name="${f.k}" rows="2">${esc(pick(f))}</textarea>`
        : `<input name="${f.k}" value="${esc(pick(f))}">`;
      return `<tr class="${diff ? 'vf-diff' : ''}"><td>${esc(f.label)}${f.tag ? ' <span class="vf-tag" title="Repris dans le contrat">contrat</span>' : ''}</td>
        <td class="vf-answer">${a ? esc(a) : '<span class="muted">—</span>'}${diff ? `<div class="vf-was">Fiche structure : ${esc(k)}</div>` : ''}</td>
        <td>${ctl}</td></tr>`;
    }).join('');
  }).join('');
  const extra = `<div class="mail-wrap">
    <p class="help" style="margin-top:0">${s.fiche_submitted_at ? `Fiche envoyée par l’organisateur le ${fmtDate(s.fiche_submitted_at.slice(0,10))}.` : 'L’organisateur n’a pas encore rempli la fiche : tu peux tout de même compléter les infos ici.'}
      Corrige la colonne « Valeur retenue » si besoin : c’est elle qui part dans le contrat. En orange : l’organisateur a donné une autre valeur que celle de la fiche structure.</p>
    <div class="tbl-wrap"><table class="vf-table"><thead><tr><th>Champ</th><th>Réponse de l’organisateur</th><th>Valeur retenue</th></tr></thead><tbody>${rows}</tbody></table></div>
    <label class="check-line"><input type="checkbox" id="vf-struct" checked> Mettre à jour les coordonnées de la structure${st ? ` « ${esc(st.name)} »` : ''} avec ces valeurs</label>
  </div>`;
  return openModal({title: `Fiche de renseignements · ${venueName(s.venue)}`, wide: true, fields: [], extra,
    saveLabel: s.fiche_validated_at ? 'Enregistrer' : 'Valider la fiche',
    onSave: async () => {
      const form = document.querySelector('#modal form');
      const data = {};
      FICHE_SECTIONS.forEach(sec => sec.fields.forEach(f => { const el = form.elements[f.k]; if (el) data[f.k] = el.value.trim(); }));
      if (st && form.querySelector('#vf-struct').checked){
        const adm = {...(st.admin || {})};
        FICHE_SECTIONS.forEach(sec => sec.fields.forEach(f => { if (f.src === 'admin' && data[f.k] !== undefined && data[f.k] !== '') adm[f.k] = data[f.k]; }));
        await save('structures', st.id, {admin: adm}, {rerender:false});
      }
      const patch = {contract_data: data, fiche_validated_at: s.fiche_validated_at || new Date().toISOString()};
      if (!s.precontract_done) patch.precontract_done = today();
      const ok = await save('shows', s.id, patch, {rerender:false});
      if (ok) toast(s.fiche_validated_at ? 'Fiche enregistrée' : 'Fiche validée : le contrat peut être généré');
      return !!ok;
    }});
}

// ─────────────── Contrat ───────────────

/** Balises et montants envoyés au script pour remplir le modèle */
export function contractVars(s){
  const kind = ficheKind(s.contract_type);
  const d = {...knownValues(s), ...(s.contract_data || {})};
  const vat = showVat(s), ht = Number(s.fee_ht) || 0, ttc = Math.round(ht * (1 + vat / 100) * 100) / 100;
  const pays = paymentsOf(s.id);
  const ttcOf = p => p ? Math.round((payAmount(p) || 0) * (1 + vat / 100) * 100) / 100 : null;
  const acompte = pays.find(p => p.kind === 'acompte'), solde = pays.find(p => p.kind === 'solde');
  const tags = {};
  FICHE_SECTIONS.forEach(sec => sec.fields.forEach(f => { if (f.tag) tags[f.tag] = d[f.k] ?? ''; }));
  tags['N° TVA Intracommunautaire'] = d.vat_subject === 'Non' ? 'non assujettie à la TVA' : (d.vat || '');
  tags['Jauge Public'] = d.capacity ? `${num(d.capacity)} personnes` : '';
  tags['Billetterie'] = /gratuit/i.test(d.ticketing || '') ? 'gratuit' : 'payant';
  tags["Nom de L'Artiste"] = stripCode(byId('projects', s.project_id)?.name);
  tags['Date du Concert'] = longDate(s.date);
  tags['Prix de Cession Hors Taxe Validé'] = num(ht);
  tags['Minimum Garanti Hors Taxe Validé'] = num(ht);
  tags['% du résultat net après break au PRODUCTEUR'] = s.cr_producer_pct != null ? num(s.cr_producer_pct) : '';
  tags['Break'] = s.cr_break || '';
  // Passages « XXX » du modèle, remplacés dans l'ordre où ils apparaissent
  const seq = [
    {find: '<<Date du Concert>> (-1)', values: [s.date ? longDate(addDays(s.date, -1)) : '']},
    {find: 'XXX€ TTC (montant en lettres)', values: [`${num(ttc)}€ TTC (${euros(ttc)})`]},
    {find: '€ HT (montant en lettres)', values: [`€ HT (${euros(ht)})`]},
    {find: 'XXXX€ TTC', values: [acompte ? `${num(ttcOf(acompte))}€ TTC` : 'XXXX€ TTC', solde ? `${num(ttcOf(solde))}€ TTC` : 'XXXX€ TTC']},
  ];
  if (vat !== 5.5) seq.push({find: 'TVA 5,5%', values: [`TVA ${num(vat)}%`]});
  if (s.invitations != null) seq.push({find: 'quota de XXX places', values: [`quota de ${s.invitations} places`]});
  const st = byId('structures', s.structure_id);
  const cp = d.venue_postal_code || st?.postal_code || s.department || '';
  const name = [tags["Nom de L'Artiste"], s.date, `${s.city || d.venue_city || ''}${cp ? ` (${cp})` : ''}`, venueName(s.venue), kind.toUpperCase()].filter(Boolean).join(' • ');
  return {kind, tags, seq, name, missing: Object.entries(tags).filter(([k, v]) => v === '' && !(kind === 'cc' && /Minimum|Break|% du/.test(k)) && !(kind === 'cr' && /Prix de Cession|Billetterie/.test(k)) && k !== 'N° Licence Entrepreneur du Spectacle').map(([k]) => k)};
}

const templateId = kind => { const v = String(setting(kind === 'cr' ? 'contract_template_cr' : 'contract_template_cc') || ''); return (v.match(/[-\w]{25,}/) || [''])[0]; };

export async function generateContract(showId){
  const s = byId('shows', showId);
  const v = contractVars(s);
  if (!templateId(v.kind)) return toast(`Ajoute le modèle de contrat ${v.kind === 'cr' ? 'de co-réalisation' : 'de cession'} dans Réglages › Contrats`, true);
  if (!s.drive_folder_id) return toast('Crée ou lie d’abord le dossier Drive de la date', true);
  if (!s.fiche_validated_at && !confirm('La fiche de renseignements n’est pas validée. Générer quand même le contrat ?')) return;
  if (v.missing.length && !confirm(`Infos manquantes (laissées visibles dans le contrat) :\n• ${v.missing.join('\n• ')}\n\nGénérer quand même ?`)) return;
  if (s.contract_doc_id && !confirm('Un contrat existe déjà pour cette date. En générer un nouveau ? (l’ancien reste dans le Drive)')) return;
  toast('Préparation du contrat…');
  try {
    const out = await callScript('contract', {template_id: templateId(v.kind), folder_id: s.drive_folder_id, name: v.name, tags: v.tags, seq: v.seq});
    await save('shows', s.id, {contract_doc_id: out.doc_id, contract_pdf_id: null});
    toast('Contrat prêt : relis-le dans Google Docs', false, {label:'Ouvrir', fn: () => window.open(`https://docs.google.com/document/d/${out.doc_id}/edit`, '_blank')});
  } catch (err) { toast(err.message, true); }
}

export async function exportContractPdf(showId){
  const s = byId('shows', showId);
  try {
    toast('Export du PDF…');
    const out = await callScript('contract_pdf', {doc_id: s.contract_doc_id});
    await save('shows', s.id, {contract_pdf_id: out.pdf_id});
    toast('PDF enregistré dans le dossier de la date', false, {label:'Ouvrir', fn: () => window.open(`https://drive.google.com/file/d/${out.pdf_id}/view`, '_blank')});
  } catch (err) { toast(err.message, true); }
}

// ─────────────── Montants en lettres ───────────────

const UNITS = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n){
  if (n < 20) return UNITS[n];
  if (n < 70){ const t = Math.floor(n / 10), u = n % 10; return TENS[t] + (u === 0 ? '' : u === 1 ? '-et-un' : '-' + UNITS[u]); }
  if (n < 80) return n === 71 ? 'soixante-et-onze' : 'soixante-' + UNITS[n - 60];
  if (n === 80) return 'quatre-vingts';
  return 'quatre-vingt-' + UNITS[n - 80];
}
function below1000(n){
  const h = Math.floor(n / 100), r = n % 100;
  if (!h) return below100(r);
  const head = h === 1 ? 'cent' : UNITS[h] + '-cent' + (r === 0 ? 's' : '');
  return r ? head + '-' + below100(r) : head;
}
/** Nombre entier en lettres (orthographe recommandée : traits d'union partout) */
export function enLettres(n){
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zéro';
  const parts = [];
  const mil = Math.floor(n / 1e6), th = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  if (mil) parts.push(below1000(mil) + '-million' + (mil > 1 ? 's' : ''));
  if (th) parts.push(th === 1 ? 'mille' : below1000(th).replace(/(cent|vingt)s$/, '$1') + '-mille');
  if (rest) parts.push(below1000(rest));
  return parts.join('-');
}
/** 6330.5 → « six-mille-trois-cent-trente euros et cinquante centimes » */
export function euros(x){
  const e = Math.floor(x + 1e-9), c = Math.round((x - e) * 100);
  return `${enLettres(e)}${e >= 1e6 && e % 1e6 === 0 ? ' d’' : ' '}euro${e > 1 ? 's' : ''}${c ? ` et ${enLettres(c)} centime${c > 1 ? 's' : ''}` : ''}`;
}
