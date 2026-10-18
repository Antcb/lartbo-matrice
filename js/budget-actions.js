/**
 * Actions du budget : lignes, préremplissage, copie d'une date, case « booking uniquement »,
 * pièces lues par l'IA (glisser-déposer) et brouillons Pennylane (devis, factures).
 */
import { render } from './app.js';
import { lineForecast, linesOf, prodShowsOf } from './budget.js';
import { paymentsOf, payAmount } from './calc.js';
import { insert, openStored, remove, save, sb } from './data.js';
import { byId, membersOfProject } from './selectors.js';
import { S, touch } from './state.js';
import { openModal } from './ui/modal.js';
import { fmtDate, norm, toast, today } from './utils.js';

const nextSort = showId => Math.max(0, ...linesOf(showId).map(l => l.sort || 0)) + 1;
const safeName = n => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_') || 'piece';
const simil = (a, b) => { a = norm(a||''); b = norm(b||''); if (!a || !b) return 0; if (a === b) return 1;
  const wa = new Set(a.split(/\W+/).filter(w => w.length > 2)), wb = b.split(/\W+/).filter(w => w.length > 2);
  return wb.length ? wb.filter(w => wa.has(w)).length / Math.max(wa.size, wb.length) : 0; };

/** Lignes standard d'une date : salariés (repris de la dernière date budgétée), Movinmotion, CNM, solde artiste */
async function prefill(s){
  const p = byId('projects', s.project_id);
  const prev = prodShowsOf(s.project_id).filter(x => x.id !== s.id && linesOf(x.id).some(l => l.category === 'Staff'))
    .sort((a,b) => Math.abs(new Date(a.date) - new Date(s.date)) - Math.abs(new Date(b.date) - new Date(s.date)))[0];
  const staff = prev ? linesOf(prev.id).filter(l => l.category === 'Staff').map(l => ({supplier:l.supplier, label:l.label, qty:l.qty, unit_cost:l.unit_cost, employee_id:l.employee_id}))
    : membersOfProject(s.project_id).map(m => ({supplier:[m.first_name, m.last_name].filter(Boolean).join(' '), label:m.role || 'Cachet', qty:null, unit_cost:null}));
  const rows = [
    ...staff.map(x => ({...x, category:'Staff', label: x.label || 'Cachet'})),
    {category:'Movinmotion', label:'Commission bulletins de paie', supplier:'Movinmotion', auto:'movinmotion'},
    {category:'Taxes', label:'Taxe CNM (entrée gratuite)', supplier:'CNM', auto:'cnm'},
    {category:'Solde artiste', label:'Solde artiste', supplier: p?.artist_payee || null, auto:'solde_artiste', payer:'compte'},
  ];
  let sort = nextSort(s.id);
  const {data, error} = await sb.from('budget_lines').insert(rows.map(r => ({payer:'compte', ...r, project_id:s.project_id, show_id:s.id, sort: sort++}))).select();
  if (error) return toast('Préremplissage impossible : ' + error.message, true);
  S.db.budget_lines.push(...data); touch('budget_lines');
  toast(prev ? `Budget prérempli (salariés repris du ${fmtDate(prev.date)})` : 'Budget prérempli');
}

export const BUDGET_ACTIONS = {
  toggleBookingOnly: async t => {
    const s = byId('shows', t.dataset.id), on = t.checked;
    if (on && linesOf(s.id).length && !confirm('Cette date a déjà un budget. Il sera masqué (pas supprimé) et la date sortira du solde du compte. Continuer ?')){ t.checked = false; return; }
    await save('shows', s.id, {prod_mode: on ? 'booking' : 'production'});
    toast(on ? 'Date en booking uniquement : seulement la facture de commission' : 'Date en production : budget et compte dédié');
  },
  toggleProjBudget: t => { S.openBudget ||= new Set(); const id = t.dataset.id; S.openBudget.has(id) ? S.openBudget.delete(id) : S.openBudget.add(id); render(); },
  openProdShow: t => { S.openProd.add(t.dataset.id); render(); document.getElementById('prod-' + t.dataset.id)?.scrollIntoView({block:'start', behavior:'smooth'}); },
  addBudgetLine: async t => {
    const s = t.dataset.show ? byId('shows', t.dataset.show) : null;
    const project_id = s ? s.project_id : t.dataset.project;
    const cat = t.dataset.cat || (s ? 'Technique' : 'Promo');
    await insert('budget_lines', {project_id, show_id: s?.id || null, category: cat, label: cat === 'Staff' ? 'Cachet' : null, payer:'compte', sort: s ? nextSort(s.id) : 0, doc_date: s ? null : today()});
    render();
  },
  delBudgetLine: async t => { if (confirm('Supprimer cette ligne du budget ?') && await remove('budget_lines', t.dataset.id)) render(); },
  prefillBudget: async t => { await prefill(byId('shows', t.dataset.id)); render(); },
  copyBudget: t => {
    const s = byId('shows', t.dataset.id);
    const opts = prodShowsOf(s.project_id).filter(x => x.id !== s.id && linesOf(x.id).length).map(x => [x.id, `${fmtDate(x.date)} · ${x.venue}${x.city ? ' (' + x.city + ')' : ''}`]);
    if (!opts.length) return toast('Aucune autre date de cet artiste n’a encore de budget', true);
    openModal({title:'Copier les lignes d’une autre date', saveLabel:'Copier',
      fields:[{k:'from', label:'Date à copier', type:'select', options:opts, blank:false},
        {k:'what', label:'Lignes', type:'select', blank:false, options:[['all','Toutes les lignes (montants prévus, sans pièces)'],['staff','Seulement les salariés']]}],
      values:{from: opts[0][0], what:'all'},
      onSave: async v => {
        const src = linesOf(v.from).filter(l => v.what === 'all' || l.category === 'Staff')
          .filter(l => !l.auto || !linesOf(s.id).some(x => x.auto === l.auto));
        let sort = nextSort(s.id);
        const rows = src.map(l => ({project_id:s.project_id, show_id:s.id, category:l.category, label:l.label, supplier:l.supplier, auto:l.auto, qty:l.qty, unit_cost:l.unit_cost,
          forecast: l.auto || l.category === 'Staff' ? l.forecast : (l.forecast ?? l.amount), payer:l.payer, payer_name:l.payer_name, employee_id:l.employee_id, sort: sort++}));
        if (!rows.length) return toast('Rien à copier', true);
        const {data, error} = await sb.from('budget_lines').insert(rows).select();
        if (error){ toast(error.message, true); return false; }
        S.db.budget_lines.push(...data); touch('budget_lines'); toast(`${data.length} ligne(s) copiée(s)`); render();
      }});
  },
  openBudgetFile: t => { const l = byId('budget_lines', t.dataset.id); if (l?.file_path) openStored(l.file_path); },
  testPennylane: async () => { try { const out = await pennylane('status', {}); toast(`Pennylane OK : ${out.company || 'compte connecté'}`); } catch (err) { toast(err.message, true); } },
  pennylaneQuote: async t => {
    const s = byId('shows', t.dataset.id);
    if (s.pennylane_quote_id && !confirm('Un devis a déjà été créé dans Pennylane pour cette date. En créer un nouveau ?')) return;
    t.disabled = true; toast('Création du devis dans Pennylane…');
    try { const out = await pennylane('quote', {show_id: s.id}); await save('shows', s.id, {pennylane_quote_id: String(out.id), pennylane_quote_url: out.url || null}); toast(`Devis ${out.number || ''} créé dans Pennylane${out.headers === false ? ' (complète « Projet » et « Date de réalisation » dans Pennylane)' : ''}`); }
    catch (err) { toast(err.message, true); }
    t.disabled = false;
  },
  pennylaneInvoice: async t => {
    const p = byId('show_payments', t.dataset.id);
    t.disabled = true; toast('Création de la facture en brouillon dans Pennylane…');
    try { const out = await pennylane('invoice', {payment_id: p.id}); await save('show_payments', p.id, {pennylane_id: String(out.id), pennylane_url: out.url || null}); toast(`Facture créée en brouillon dans Pennylane${out.headers === false ? ' (complète « Projet » et « Date de réalisation »)' : ''}`); }
    catch (err) { toast(err.message, true); }
    t.disabled = false;
  },
};

/** Appel de la fonction serveur Pennylane (le jeton API reste côté serveur) */
export async function pennylane(action, body){
  const {data, error} = await sb.functions.invoke('pennylane', {body:{action, ...body}});
  if (error){ let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ——— Pièces lues par l'IA ———

/** Envoie la pièce, la fait lire par l'IA, puis met à jour (ou crée) la bonne ligne */
export async function readPieces(ctx, files){
  for (const file of files){
    const show = ctx.show_id ? byId('shows', ctx.show_id) : null;
    const line = ctx.line_id ? byId('budget_lines', ctx.line_id) : null;
    const project_id = ctx.project_id || show?.project_id || line?.project_id;
    const folder = `budget/${show?.id || line?.show_id || 'projet-' + project_id}`;
    const path = `${folder}/${Date.now()}_${safeName(file.name)}`;
    toast(`Lecture de « ${file.name} » par l’IA…`);
    const {error: upErr} = await sb.storage.from('suivi').upload(path, file, {contentType: file.type || 'application/octet-stream'});
    if (upErr){ toast(`${file.name} : ${upErr.message}`, true); continue; }
    let doc = null;
    const {data, error} = await sb.functions.invoke('lire-piece', {body:{path, show_id: show?.id || line?.show_id || null, project_id}});
    if (error || data?.error){ let msg = data?.error || error?.message; try { msg = (await error.context.json()).error || msg; } catch {} toast(`Pièce enregistrée, mais l’IA n’a pas pu la lire : ${msg}. Complète la ligne à la main.`, true); }
    else doc = data.doc;
    await applyPiece({doc: doc || {}, path, name: file.name, show_id: show?.id || line?.show_id || null, project_id, line});
  }
  render();
}

const isOurs = n => /artboristerie/i.test(n || '');
const cleanDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null;

async function applyPiece({doc, path, name, show_id, project_id, line}){
  const d = doc, date = cleanDate(d.date) || today();
  const ht = d.montant_ht != null ? Number(d.montant_ht) : null, ttc = d.montant_ttc != null ? Number(d.montant_ttc) : null;
  // Facture émise par L'ArtBo à l'organisateur : acompte / solde reçu
  if (show_id && (d.type === 'facture_emise' || isOurs(d.emetteur) && !isOurs(d.destinataire))){
    const pays = paymentsOf(show_id).filter(p => ['acompte','solde','autre'].includes(p.kind));
    const pay = pays.find(p => d.numero && p.invoice_number && norm(p.invoice_number) === norm(d.numero))
      || pays.find(p => d.acompte_ou_solde && p.kind === d.acompte_ou_solde && !p.paid_at)
      || pays.find(p => ht != null && Math.abs((payAmount(p)||0) - ht) < 1 && !p.paid_at);
    if (pay){
      await save('show_payments', pay.id, {invoice_number: d.numero || pay.invoice_number, paid_at: pay.paid_at || date, file_path: path, file_name: name,
        ...(ht != null && Math.abs((payAmount(pay)||0) - ht) >= 1 ? {amount: ht} : {})}, {rerender:false});
      return toast(`${pay.label || 'Encaissement'} : facture ${d.numero || ''} rattachée et marquée reçue`);
    }
  }
  const s = show_id ? byId('shows', show_id) : null;
  const bulletin = d.type === 'bulletin';
  const amount = bulletin ? (d.cout_employeur ?? ttc ?? ht) : (ht ?? ttc);
  const patch = {doc_number: d.numero || (bulletin ? `BDS ${String(date).slice(0,7)}` : null), doc_date: date, paid_at: date, file_path: path, file_name: name,
    ...(amount != null ? {amount: Number(amount)} : {}), ...(ttc != null ? {amount_ttc: ttc} : {}), ...(d.tva_taux != null ? {vat_rate: Number(d.tva_taux)} : {})};
  let target = line;
  if (!target && s){
    const cands = linesOf(s.id).filter(l => !l.paid_at && !l.file_path && l.auto !== 'solde_artiste' || l.auto === 'solde_artiste' && !l.paid_at);
    const who = bulletin ? d.personne : d.emetteur;
    const score = l => (simil(l.supplier, who) * 3) + (l.category === d.categorie ? 1 : 0) + simil(l.label, d.libelle)
      + (bulletin && l.category === 'Staff' ? 1 : 0) + (amount != null && Math.abs((lineForecast(l)||0) - amount) < 1 ? 1 : 0);
    const best = cands.map(l => [l, score(l)]).sort((a,b) => b[1]-a[1])[0];
    if (best && best[1] >= 2) target = best[0];
  }
  if (target){
    await save('budget_lines', target.id, {...patch, supplier: target.supplier || (bulletin ? d.personne : d.emetteur) || null}, {rerender:false});
    return toast(`Ligne « ${target.label || target.category} » mise à jour : ${d.numero || name} (payée le ${fmtDate(date)})`);
  }
  const row = await insert('budget_lines', {project_id, show_id: s?.id || null, category: bulletin ? 'Staff' : (d.categorie || 'Autres'),
    label: d.libelle || (bulletin ? 'Cachet' : name), supplier: (bulletin ? d.personne : d.emetteur) || null, payer: 'compte',
    qty: bulletin ? 1 : null, sort: s ? nextSort(s.id) : 0, ...patch});
  if (row) toast(`Nouvelle ligne ajoutée : ${row.label} (${row.category})`);
}

// Glisser-déposer / choix d'une pièce sur le budget (zone ou ligne précise)
const ctxOf = el => { const z = el.closest?.('[data-budget-line],[data-budget-drop]'); if (!z) return null;
  return z.dataset.budgetLine ? {line_id: z.dataset.budgetLine} : JSON.parse(z.dataset.budgetDrop); };
document.addEventListener('dragover', e => { if (!e.dataTransfer?.types?.includes('Files')) return; const z = e.target.closest?.('[data-budget-line],[data-budget-drop]'); if (!z) return;
  e.preventDefault(); e.stopPropagation(); document.querySelectorAll('.budget-over').forEach(x => x !== z && x.classList.remove('budget-over')); z.classList.add('budget-over'); }, true);
document.addEventListener('dragleave', e => { const z = e.target.closest?.('.budget-over'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('budget-over'); }, true);
document.addEventListener('drop', e => { const ctx = ctxOf(e.target); if (!ctx) return; e.preventDefault(); e.stopPropagation();
  document.querySelectorAll('.budget-over').forEach(x => x.classList.remove('budget-over'));
  const files = [...(e.dataTransfer?.files || [])]; if (files.length) readPieces(ctx, files); }, true);
document.addEventListener('change', e => { const t = e.target; if (!t.dataset?.budgetPick) return; const files = [...t.files]; t.value = '';
  if (files.length) readPieces(JSON.parse(t.dataset.budgetPick), files); });

