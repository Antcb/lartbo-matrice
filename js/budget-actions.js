/**
 * Actions du budget : lignes, préremplissage, copie d'une date, case « booking uniquement »,
 * pièces lues par l'IA (glisser-déposer) et brouillons Pennylane (devis, factures).
 */
import { render } from './app.js';
import { PROD_LINES, isProductionShow, prodOf } from './production-budget.js';
import { cnmDue, isSolde, lineForecast, linesOf, prodShowsOf } from './budget.js';
import { acompteState, isInvoiced, paymentsOf, payAmount } from './calc.js';
import { insert, mergeRows, openStored, refreshFor, remove, save, sb } from './data.js';
import { byId, membersOfProject, setting } from './selectors.js';
import { callScript } from './mail.js';
import { applyTemplate } from './budget-template.js';
import { exportArtistBudget } from './artist-export.js';
import { S, touch } from './state.js';
import { openModal } from './ui/modal.js';
import { confirmAsk, inform } from './ui/dialog.js';
import { esc, eur2, fmtDate, norm, toast, today } from './utils.js';

const nextSort = showId => Math.max(0, ...linesOf(showId).map(l => l.sort || 0)) + 1;
const safeName = n => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_') || 'piece';
const simil = (a, b) => { a = norm(a||''); b = norm(b||''); if (!a || !b) return 0; if (a === b) return 1;
  const wa = new Set(a.split(/\W+/).filter(w => w.length > 2)), wb = b.split(/\W+/).filter(w => w.length > 2);
  return wb.length ? wb.filter(w => wa.has(w)).length / Math.max(wa.size, wb.length) : 0; };

/** Taxe CNM : la ligne n'existe que si la date est concernée (entrée gratuite, en France). Appelé quand la billetterie change. */
export async function syncCnmLine(showId){
  const s = byId('shows', showId); if (!s || !linesOf(s.id).length) return;
  const cnm = linesOf(s.id).filter(l => l.auto === 'cnm');
  if (cnmDue(s) && !cnm.length)
    await insert('budget_lines', {project_id:s.project_id, show_id:s.id, category:'Taxes', label:'Taxe CNM (entrée gratuite)', supplier:'CNM', auto:'cnm', payer:'compte', sort: nextSort(s.id)});
  if (!cnmDue(s)) for (const l of cnm) if (l.amount == null && l.forecast == null && !l.file_path && !l.doc_number && !l.paid_at) await remove('budget_lines', l.id);
}

/** Frais Movinmotion : dès qu'une date a un salarié, la ligne « Commission bulletins de paie » (calculée seule) est ajoutée */
export async function syncMovinmotionLine(showId){
  const s = byId('shows', showId); if (!s || s.prod_mode === 'booking') return;
  const ls = linesOf(s.id);
  if (!ls.some(l => l.category === 'Staff') || ls.some(l => l.auto === 'movinmotion')) return;
  // ajout fait par la base : une seule ligne Movinmotion par date, même si deux personnes ajoutent un salarié en même temps
  const {error} = await sb.rpc('ensure_movinmotion', {p_show: s.id});
  if (error) return toast('Ligne Movinmotion : ' + error.message, true);
  await refreshFor('budget_lines', 'show_id', s.id);
}

/** Budget de production : paramètres et tarifs enregistrés sur la date (shows.production) */
async function saveProd(showId, change){
  const s = byId('shows', showId); if (!s) return;
  const p = prodOf(s); change(p);
  await save('shows', showId, {production: p});
}
document.addEventListener('change', async e => {
  const el = e.target.closest?.('[data-prod-path]'); if (!el) return;
  e.stopPropagation();
  const path = el.dataset.prodPath.split('.'), raw = el.value.trim();
  const v = /label/.test(path.at(-1)) ? raw : (raw === '' ? null : Number(raw.replace(',', '.')));
  await saveProd(el.dataset.prodShow, p => { let o = p; path.slice(0, -1).forEach(k => { o = o[k]; }); o[path.at(-1)] = v; });
}, true);

export const BUDGET_ACTIONS = {
  prodAddTicket: t => saveProd(t.dataset.id, p => { p.tickets.push({label: '', qty: 0, price: 0, dl_prod: 0, dl_net: 0}); }),
  prodDelTicket: async t => { const lab = prodOf(byId('shows', t.dataset.id)).tickets[Number(t.dataset.i)]?.label;
    if (await confirmAsk('Retirer le tarif ?', `Retirer le tarif « ${lab || 'sans nom'} » de la billetterie de cette date (quantités et prix de ce tarif compris) ?`, 'Retirer le tarif', {danger: true}))
      saveProd(t.dataset.id, p => { p.tickets.splice(Number(t.dataset.i), 1); }); },
  prefillProduction: async t => {
    const s = byId('shows', t.dataset.id); let sort = nextSort(s.id);
    const rows = PROD_LINES.map(([category, label]) => ({project_id: s.project_id, show_id: s.id, category, label, payer: 'artbo', sort: sort++}));
    const {data, error} = await sb.from('budget_lines').insert(rows).select();
    if (error) return toast('Préremplissage impossible : ' + error.message, true);
    mergeRows('budget_lines', data);
    if (!s.production) await saveProd(s.id, () => {});
    render(); toast('Budget de production prérempli : indique les quantités et prix unitaires');
  },
  toggleBookingOnly: async t => {
    const s = byId('shows', t.dataset.id), on = t.checked;
    if (on && linesOf(s.id).length && !(await confirmAsk('Passer la date en booking uniquement ?', `Cette date a déjà un budget (${linesOf(s.id).length} ligne${linesOf(s.id).length > 1 ? 's' : ''}). Il sera masqué (pas supprimé) et la date sortira du solde du compte.`, 'Passer en booking'))){ t.checked = false; return; }
    if (!(await save('shows', s.id, {prod_mode: on ? 'booking' : 'production', prod_mode_manual: (on ? 'booking' : 'production') !== (byId('projects', s.project_id)?.mode || 'production')}, {rerender: false}))){ render(); return; }   // refusé (facture émise) : le message du garde-fou reste
    // passage en production : la base ajoute l'acompte et le solde manquants (factures déjà faites gardées) ; on les recharge
    if (!on) await refreshFor('show_payments', 'show_id', s.id);
    render();
    toast(on ? 'Date en booking uniquement : seulement la facture de commission' : 'Date en production : budget et compte dédié');
  },
  toggleProjBudget: t => { S.openBudget ||= new Set(); const id = t.dataset.id; S.openBudget.has(id) ? S.openBudget.delete(id) : S.openBudget.add(id); render(); },
  openProdShow: t => { S.openProd.add(t.dataset.id); render(); document.getElementById('prod-' + t.dataset.id)?.scrollIntoView({block:'start', behavior:'smooth'}); },
  addBudgetLine: async t => {
    const s = t.dataset.show ? byId('shows', t.dataset.show) : null;
    const project_id = s ? s.project_id : t.dataset.project;
    const cat = t.dataset.cat || (s ? 'Technique' : 'Promo');
    if (cat === 'Solde artiste' && s){   // versement à l'artiste : depuis le compte dédié, au bénéficiaire du projet
      const first = !linesOf(s.id).some(isSolde);
      await insert('budget_lines', {project_id, show_id: s.id, category: cat, label: 'Solde artiste', supplier: byId('projects', project_id)?.artist_payee || null,
        payer: 'compte', auto: first ? 'solde_artiste' : null, sort: nextSort(s.id)});
      return render();
    }
    const row = await insert('budget_lines', {project_id, show_id: s?.id || null, category: cat, label: cat === 'Staff' ? 'Cachet' : null, payer: isProductionShow(s) ? 'artbo' : 'compte', sort: s ? nextSort(s.id) : 0, doc_date: s ? null : today()});
    if (s && cat === 'Staff') await syncMovinmotionLine(s.id);
    render();
    // la nouvelle ligne est rangée dans sa catégorie : on l'amène à l'écran, curseur dans le libellé
    const tr = row && document.querySelector(`tr[data-budget-line="${row.id}"]`);
    if (tr){ tr.scrollIntoView({block: 'center', behavior: 'smooth'}); tr.classList.add('just-added'); setTimeout(() => tr.classList.remove('just-added'), 2000);
      tr.querySelector(cat === 'Staff' ? '[data-f="supplier"]' : '[data-f="label"]')?.focus({preventScroll: true}); }
  },
  exportArtistBudget: t => exportArtistBudget(t.dataset.id),
  delBudgetLine: async t => { const l = byId('budget_lines', t.dataset.id);
    if (await confirmAsk('Supprimer la ligne du budget ?', `Supprimer la ligne « ${l?.label || l?.category || 'sans nom'} »${l?.amount != null ? ` (${eur2(l.amount)})` : ''} du budget ?`, 'Supprimer la ligne', {danger: true})
      && await remove('budget_lines', t.dataset.id)) render(); },
  prefillBudget: async t => { await applyTemplate(byId('shows', t.dataset.id)); render(); },
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
          .filter(l => !l.auto || !linesOf(s.id).some(x => x.auto === l.auto))
          .filter(l => l.auto !== 'cnm' || cnmDue(s));
        let sort = nextSort(s.id);
        const rows = src.map(l => ({project_id:s.project_id, show_id:s.id, category:l.category, label:l.label, supplier:l.supplier, auto:l.auto, qty:l.qty, unit_cost:l.unit_cost,
          forecast: l.auto || l.category === 'Staff' ? l.forecast : (l.forecast ?? l.amount), payer:l.payer, payer_name:l.payer_name, employee_id:l.employee_id, sort: sort++}));
        if (!rows.length) return toast('Rien à copier', true);
        const {data, error} = await sb.from('budget_lines').insert(rows).select();
        if (error){ toast(error.message, true); return false; }
        mergeRows('budget_lines', data); await syncMovinmotionLine(s.id); toast(`${data.length} ligne(s) copiée(s)`); render();
      }});
  },
  openBudgetFile: t => { const l = byId('budget_lines', t.dataset.id); if (l?.file_path) openStored(l.file_path); },
  syncPennylane: async t => {
    t.disabled = true; toast('Lecture des factures payées dans Pennylane…');
    try {
      const out = await pennylane('sync', {});
      const {refreshShowSide} = await import('./data.js');
      for (const sid of new Set(out.updated.map(u => S.db.show_payments.find(p => p.id === u.id)?.show_id).filter(Boolean))) await refreshShowSide(sid);
      // factures d'acompte / de solde faites depuis le devis : leur numéro vient d'être repris
      if (out.linked?.length) await refreshFor('show_payments', 'show_id', S.db.shows.filter(x => x.pennylane_quote_id).map(x => x.id));
      render();
      const lines = [out.linked?.length ? `${out.linked.length} facture(s) faite(s) depuis le devis, numéro repris : ${out.linked.filter(Boolean).join(', ')}\n` : '', out.updated.length ? `${out.updated.length} facture(s) marquée(s) payée(s) :\n- ` + out.updated.map(u => u.label).join('\n- ') : (out.linked?.length || out.filed?.done?.length) ? '' : 'Rien de nouveau : la Matrice est à jour.',
        out.erreurs?.length ? `\nÉcritures REFUSÉES (rien n’a été modifié pour ces lignes) — à examiner :\n- ` + out.erreurs.join('\n- ') : '',
        out.caducs?.length ? `\nFacture(s) Pennylane d’acompte NON reliée(s) : l’acompte est caduc (solde déjà facturé), la date serait facturée au-delà de sa cession — à examiner :\n- ` + out.caducs.join('\n- ') : '',
        out.pennylaneLate.length ? `\nPayées dans la Matrice mais pas encore dans Pennylane (à mettre à jour dans Pennylane) :\n- ` + out.pennylaneLate.join('\n- ') : '',
        // PDF des factures rangés dans le Drive (compta + dossier de la date)
        out.filed?.done?.length ? `\n${out.filed.done.length} facture(s) rangée(s) dans le Drive (compta › D - Factures de ventes et 02_Finance de la date) :\n- ` + out.filed.done.join('\n- ') : '',
        out.filed?.left ? `\nEncore ${out.filed.left} facture(s) à ranger dans le Drive : relance la synchronisation.` : '',
        out.filed?.errors?.length ? `\nRangement Drive impossible :\n- ` + out.filed.errors.join('\n- ') : '',
        // la synchronisation ne choisit jamais le compte (§6.6) : les encaissements payés sans compte sont signalés
        (n => n ? `\n${n} encaissement(s) payé(s) sans compte d’encaissement : choisis « Arrive sur » dans l’onglet Factures de la date.` : '')(
          out.updated.map(u => S.db.show_payments.find(p => p.id === u.id)).filter(p => p && ['acompte','solde','autre'].includes(p.kind) && !p.payee && byId('shows', p.show_id)?.prod_mode !== 'booking').length)];
      await inform({title: 'Synchronisation Pennylane', text: lines.join('\n')});
    } catch (err) { toast(err.message, true); }
    t.disabled = false;
  },
  testPennylane: async () => { try { const out = await pennylane('status', {}); toast(`Pennylane OK : ${out.company || 'compte connecté'}`); } catch (err) { toast(err.message, true); } },
  pennylaneQuote: async t => {
    const s = byId('shows', t.dataset.id);
    if (s.pennylane_quote_id && !(await confirmAsk('Créer un nouveau devis ?', 'Un devis a déjà été créé dans Pennylane pour cette date. Le nouveau devis s’ajoute à l’ancien (rien n’est supprimé dans Pennylane).', 'Créer un nouveau devis'))) return;
    t.disabled = true; toast('Création du devis dans Pennylane…');
    try { const out = await pennylane('quote', {show_id: s.id}); await save('shows', s.id, {pennylane_quote_id: String(out.id), pennylane_quote_url: out.url || null}); toast(`Devis ${out.number || ''} créé dans Pennylane${out.headers === false ? ' (complète « Projet » et « Date de réalisation » dans Pennylane)' : ''}`); }
    catch (err) { toast(err.message, true); }
    t.disabled = false;
  },
  // pièce gardée « à rattacher » : l'utilisateur choisit la ligne (jamais une ligne qui a déjà sa pièce)
  attachPiece: async t => {
    const a = byId('attachments', t.dataset.id), s = byId('shows', t.dataset.show); if (!a || !s) return;
    const lines = attachableLines(s).filter(p => !p.file_path);
    if (!lines.length) return toast(s.prod_mode === 'booking' ? 'Date en booking : les factures d’acompte et de solde sont celles de l’artiste, aucune ne se rattache ici (seule la commission de L’ArtBo est suivie).' : 'Aucune ligne d’acompte, de solde ou autre sans pièce sur cette date : ajoute la ligne d’abord.', true);
    await openModal({title: 'Rattacher la pièce', saveLabel: 'Rattacher',
      extraTop: `<p class="help full">Pièce : <b>${esc(a.name)}</b><br>Le montant, le % et la date de paiement de la ligne ne changent pas.</p>`,
      fields: [{k: 'pay', label: 'Ligne', type: 'select', full: true, options: lines.map(p => [p.id, `${p.label || p.kind} · ${eur2(payAmount(p) || 0)} HT${p.invoice_number ? ' · ' + p.invoice_number : ''}`])},
        {k: 'invoice_number', label: 'N° de facture (si la ligne n’en a pas)', type: 'text'}],
      onSave: async v => {
        const pay = byId('show_payments', v.pay); if (!pay){ toast('Choisis la ligne à laquelle rattacher la pièce', true); return false; }
        const patch = {file_path: a.path, file_name: a.name, ...(!pay.invoice_number && v.invoice_number ? {invoice_number: v.invoice_number} : {})};
        if (!(await save('show_payments', pay.id, patch, {rerender: false}))) return false;
        toast(`${pay.label || 'Ligne'} : pièce rattachée`);
        fileToDrive({table: 'show_payments', id: pay.id}, s, a.path, a.name);
        return true;
      }});
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
    const ref = await applyPiece({doc: doc || {}, path, name: file.name, show_id: show?.id || line?.show_id || null, project_id, line});
    const sid = show?.id || line?.show_id;
    if (ref && sid) await fileToDrive(ref, byId('shows', sid), path, file.name);
  }
  render();
}

/**
 * Range la pièce dans le dossier Drive de la date (02_Finance). Si elle y est déjà, on demande :
 * remplacer l'ancienne, garder l'ancienne, ou garder les deux.
 */
async function fileToDrive(ref, show, path, name){
  if (!setting('drive_webhook_url')) return;
  if (!show?.drive_folder_id) return toast('Pièce gardée dans la Matrice : la date n’a pas encore de dossier Drive', true);
  const {data: signed} = await sb.storage.from('suivi').createSignedUrl(path, 900);
  if (!signed?.signedUrl) return;
  const base = {folder_id: show.drive_folder_id, url: signed.signedUrl, name};
  try {
    let out = await callScript('file_piece', base);
    if (out.duplicate){
      const decision = await askDuplicate(out.duplicate, name);
      if (!decision) return toast('Pièce gardée dans la Matrice, pas ajoutée au Drive');
      out = await callScript('file_piece', {...base, decision});
    }
    await save(ref.table, ref.id, {drive_file_id: out.file_id}, {rerender: false});
    toast(out.skipped ? `Déjà dans le Drive : « ${out.name} » gardé` : out.replaced ? `Rangée dans le Drive (02_Finance), l’ancienne « ${out.replaced} » est à la corbeille` : `Rangée dans le Drive : 02_Finance › ${out.name}`);
  } catch (err) { toast('Rangement Drive impossible : ' + err.message, true); }
}

function askDuplicate(dup, name){
  return openModal({title: 'Pièce déjà dans le dossier Drive', saveLabel: 'Valider',
    extraTop: `<p class="help full">${dup.same ? 'Le même fichier' : 'Un fichier du même nom'} est déjà dans le dossier de la date : <a href="${dup.url}" target="_blank" rel="noopener">${esc(dup.name)} ↗</a><br>Nouvelle pièce : <b>${esc(name)}</b></p>`,
    fields: [{k: 'decision', label: 'Que faire ?', type: 'select', blank: false, full: true, options: [
      ['skip', 'Garder l’ancien (ne pas ajouter le nouveau)'], ['replace', 'Remplacer l’ancien par le nouveau (l’ancien va à la corbeille)'], ['keep_both', 'Garder les deux']]}],
    values: {decision: dup.same ? 'skip' : 'replace'}, onSave: v => v.decision});
}

const isOurs = n => /artboristerie/i.test(n || '');
const cleanDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null;

/** Lignes auxquelles une facture de vente peut être rattachée : celles affichées dans l'onglet Factures
 *  (date en booking : aucune — acomptes / soldes de l'artiste, hors du suivi de L'ArtBo) */
const attachableLines = s => !s || s.prod_mode === 'booking' ? []   // booking : acomptes / soldes = factures de l'artiste, jamais rattachées (lot C1)
  : paymentsOf(s.id).filter(p => ['acompte','solde','autre'].includes(p.kind) && acompteState(p) !== 'caduc');   // acompte caduc : ne s'émet plus (lot C1)

/**
 * Ligne d'acompte / de solde d'une facture de vente lue par l'IA. Seules correspondances sûres :
 *  1. le même numéro de facture ;
 *  2. le type indiqué sur la pièce (acompte / solde) : une ligne libre de ce type (ni émise, ni avec pièce), du même montant
 *     s'il est lu ; à montant égal, la première dans l'ordre (acomptes facturés dans l'ordre) ;
 *  3. sans type lu : une seule ligne libre du même montant.
 * Un montant seul ne rattache jamais à une ligne d'un autre type que celui de la pièce. Sinon : rien, avec la raison.
 */
export function matchSale(pays, d, ht){
  const byNum = d.numero && pays.find(p => p.invoice_number && norm(p.invoice_number) === norm(d.numero));
  // la facture a déjà sa pièce : jamais remplacée sans trace, la nouvelle est gardée à part
  if (byNum) return byNum.file_path ? {why: `la facture ${byNum.invoice_number} a déjà sa pièce (${byNum.file_name || 'fichier'})`} : {pay: byNum};
  const free = p => !isInvoiced(p) && !p.file_path, near = p => Math.abs((payAmount(p) || 0) - ht) < 1;
  const kind = ['acompte', 'solde'].includes(d.acompte_ou_solde) ? d.acompte_ou_solde : null;
  if (kind){
    const c = pays.filter(p => p.kind === kind && free(p));
    if (!c.length) return {why: `aucun ${kind} libre sur cette date (déjà facturé ou avec une pièce)`};
    const pay = ht == null ? c[0] : c.find(near);
    return pay ? {pay} : {why: `aucun ${kind} libre de ${eur2(ht)} HT sur cette date`};
  }
  if (ht == null) return {why: 'ni le type (acompte / solde) ni le montant ne sont lisibles sur la pièce'};
  const c = pays.filter(p => free(p) && near(p));
  return c.length === 1 ? {pay: c[0]} : {why: c.length ? `plusieurs lignes libres de ${eur2(ht)} HT : type non lisible sur la pièce` : `aucune ligne libre de ${eur2(ht)} HT sur cette date`};
}

// exportée pour les tests
export async function applyPiece({doc, path, name, show_id, project_id, line}){
  const d = doc, date = cleanDate(d.date) || today();
  const ht = d.montant_ht != null ? Number(d.montant_ht) : null, ttc = d.montant_ttc != null ? Number(d.montant_ttc) : null;
  // Facture émise par L'ArtBo à l'organisateur : acompte / solde reçu
  if (show_id && (d.type === 'facture_emise' || isOurs(d.emetteur) && !isOurs(d.destinataire))){
    const pays = attachableLines(byId('shows', show_id));
    const {pay, why} = matchSale(pays, d, ht);
    if (pay){
      // facture émise : jamais de montant réécrit (§6.4) ; un écart avec la pièce est seulement signalé
      const gap = ht != null && Math.abs((payAmount(pay)||0) - ht) >= 1;
      // une facture émise n'est pas un paiement (audit A-03) : jamais de date de paiement écrite ici (Pennylane ou la saisie la donnent)
      if (!(await save('show_payments', pay.id, {invoice_number: d.numero || pay.invoice_number, file_path: path, file_name: name},
        {rerender:false}))) return null;   // aucun montant réécrit : la ligne vient d'une correspondance sûre (matchSale)
      toast(`${pay.label || 'Encaissement'} : facture ${d.numero || ''} rattachée (le paiement se note à réception)` + (gap ? ` — montant de la pièce (${eur2(ht)} HT) différent de la ligne (${eur2(payAmount(pay))} HT) : à vérifier, rien n’a été changé` : ''), gap);
      return {table: 'show_payments', id: pay.id};
    }
    // facture de vente sans correspondance sûre : jamais rattachée au hasard, ni enregistrée comme une dépense ;
    // la pièce reste dans la Matrice, listée « Pièces à rattacher » dans l'onglet Factures de la date (décision d'Anthony du 24/10)
    const kept = await insert('attachments', {project_id: project_id || byId('shows', show_id)?.project_id || null, name, path});
    toast(`Facture ${d.numero || name} : ${why}. Rien n’a été rattaché` + (kept ? ' : la pièce est gardée dans « Pièces à rattacher » (onglet Factures de la date).' : ` ; pièce gardée dans le stockage (${path}).`), true);
    return null;
  }
  const s = show_id ? byId('shows', show_id) : null;
  const bulletin = d.type === 'bulletin';
  const amount = bulletin ? (d.cout_employeur ?? ttc ?? ht) : (ht ?? ttc);
  const patch = {doc_number: d.numero || (bulletin ? `BDS ${String(date).slice(0,7)}` : null), doc_date: date, file_path: path, file_name: name,   // jamais paid_at : un justificatif n'est pas un paiement (v1.46a)
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
    toast(`Ligne « ${target.label || target.category} » mise à jour : ${d.numero || name} (pièce rattachée ; le paiement se note à part)`);
    return {table: 'budget_lines', id: target.id};
  }
  const row = await insert('budget_lines', {project_id, show_id: s?.id || null, category: bulletin ? 'Staff' : (d.categorie || 'Autres'),
    label: d.libelle || (bulletin ? 'Cachet' : name), supplier: (bulletin ? d.personne : d.emetteur) || null, payer: 'compte',
    qty: bulletin ? 1 : null, sort: s ? nextSort(s.id) : 0, ...patch});
  if (row && bulletin && s) await syncMovinmotionLine(s.id);
  if (row) toast(`Nouvelle ligne ajoutée : ${row.label} (${row.category}) ; le paiement se note à part`);
  return row ? {table: 'budget_lines', id: row.id} : null;
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

