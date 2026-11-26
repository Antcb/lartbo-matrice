/**
 * Actions du budget : lignes, préremplissage, copie d'une date, case « booking uniquement »,
 * pièces lues par l'IA (glisser-déposer) et brouillons Pennylane (devis, factures).
 */
import { render } from './app.js';
import { PROD_LINES, isProductionShow, prodOf } from './production-budget.js';
import { cnmDue, commissionOf, coreaCommissionCheck, isFacture, isFree, isSolde, lineForecast, linesOf, payerLabel, prodShowsOf } from './budget.js';
import { breakFromText, commissionPctOf, coreaCalc, isCorea } from './corea.js';
import { acompteState, canFixInvoice, correctionsOf, isCoproduction, isInvoiced, paymentsOf, payAmount, payVat, ttc, reglementsOf, resteDuTtc, tropPercuTtc, factureNetTtc, encaisseTtc } from './calc.js';
import { contentTypeOf, insert, mergeRows, openStored, refreshBudgetMarker, refreshFor, remove, save, sb, typedFile, uploadFailure } from './data.js';
import { byId, membersOfProject, setting } from './selectors.js';
import { callScript } from './mail.js';
import { applyTemplate, offerCostFill, spectacleStaffRows } from './budget-template.js';
import { exportArtistBudget } from './artist-export.js';
import { S, touch } from './state.js';
import { openModal } from './ui/modal.js';
import { ask, askText, confirmAsk, inform } from './ui/dialog.js';
import { PROMO_LEGACY_LABEL, coprodClose } from './production-budget.js';
import { esc, eur2, fmtDate, norm, pct, toast, today } from './utils.js';
import { takeDropped } from './ui/dropfiles.js';

const nextSort = showId => Math.max(0, ...linesOf(showId).map(l => l.sort || 0)) + 1;
const safeName = n => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_') || 'piece';
const simil = (a, b) => { a = norm(a||''); b = norm(b||''); if (!a || !b) return 0; if (a === b) return 1;
  const wa = new Set(a.split(/\W+/).filter(w => w.length > 2)), wb = b.split(/\W+/).filter(w => w.length > 2);
  return wb.length ? wb.filter(w => wa.has(w)).length / Math.max(wa.size, wb.length) : 0; };

/** Taxe CNM : la ligne n'existe que quand L'ArtBo en supporte le coût (v1.51 : gratuit par usage, ou attribuée sur la date), en France.
 *  Appelé quand la billetterie, la structure qui supporte la taxe ou le contrat changent.
 *  add = false : retrait seulement (v1.67, demande d'Anthony du 25/11/2026 : un ancien budget sans ligne CNM n'en reçoit une que si
 *  les paramètres CNM de la date sont modifiés, ou à la création du budget — jamais par l'ajout d'une dépense sans rapport). */
export async function syncCnmLine(showId, {add = true} = {}){
  const s = byId('shows', showId); if (!s || !linesOf(s.id).length) return;
  const cnm = linesOf(s.id).filter(l => l.auto === 'cnm');
  if (add && cnmDue(s) && !cnm.length)
    await insert('budget_lines', {project_id:s.project_id, show_id:s.id, category:'Taxes', label: isFree(s) ? 'Taxe CNM (entrée gratuite)' : 'Taxe CNM (billetterie)', supplier:'CNM', auto:'cnm', payer:'compte', sort: nextSort(s.id)});
  if (!cnmDue(s)) for (const l of cnm) if (l.amount == null && l.forecast == null && !l.file_path && !l.doc_number && !l.paid_at) await remove('budget_lines', l.id);
}

/** Frais Movinmotion : dès qu'une date a un salarié, la ligne « Commission bulletins de paie » (calculée seule) est ajoutée */
export async function syncMovinmotionLine(showId){
  const s = byId('shows', showId); if (!s || s.prod_mode === 'booking') return;
  const ls = linesOf(s.id);
  // (v1.67) seulement une ligne de salaire AU CACHET : une ligne sur facture ne génère aucun bulletin (même règle : ensure_movinmotion)
  if (!ls.some(l => l.category === 'Staff' && !isFacture(l)) || ls.some(l => l.auto === 'movinmotion')) return;
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
  // textes : libellés, débiteur / payeur / date de paiement de la promotion locale (v1.51)
  const v = /label|^(promo_(debtor|payer|paid_at)|receipts_cashed_at)$/.test(path.at(-1)) ? (raw === '' && !/label/.test(path.at(-1)) ? null : raw) : (raw === '' ? null : Number(raw.replace(',', '.')));
  // parts de L'ArtBo (bénéfices, pertes) : un pourcentage de 0 à 100, sinon rien n'est enregistré
  if (/^artbo_(loss_)?share$/.test(path.at(-1)) && v != null && !(v >= 0 && v <= 100)){ toast('Un pourcentage entre 0 et 100 est attendu', true); render(); return; }
  await saveProd(el.dataset.prodShow, p => { let o = p; path.slice(0, -1).forEach(k => { o = o[k]; }); o[path.at(-1)] = v; });
}, true);

/** Coréalisation : tarifs, break, méthode et charges enregistrés sur la date (shows.corea, v1.51) */
async function saveCorea(showId, change){
  const s = byId('shows', showId); if (!s) return;
  const c = structuredClone(s.corea || {}); c.tiers ||= []; c.charges ||= []; change(c);
  await save('shows', showId, {corea: c});
}
document.addEventListener('change', async e => {
  const el = e.target.closest?.('[data-corea-path]'); if (!el) return;
  e.stopPropagation();
  const path = el.dataset.coreaPath.split('.'), raw = el.value.trim();
  const v = /label/.test(path.at(-1)) ? raw : (raw === '' ? null : Number(raw.replace(',', '.')));
  if (v !== null && typeof v === 'number' && (!isFinite(v) || v < 0)) { toast('Nombre positif attendu', true); render(); return; }
  await saveCorea(el.dataset.coreaShow, c => { let o = c; path.slice(0, -1).forEach(k => { o = o[k]; }); o[path.at(-1)] = v; });
}, true);
const me = () => S.user?.email || '';
/** Commission versée / facturée avant validation de la part du résultat (coréalisation) : avertissement NON bloquant, confirmation
 *  explicite du caractère provisoire (décision d'Anthony du 27/10/2026, 22 h 36). Rien n'est modifié ensuite automatiquement. */
export async function confirmProvisionalCommission(s, what = 'versée'){
  if (!isCorea(s) || (s.corea_share != null && s.corea_share !== '')) return true;
  return !!(await confirmAsk('Commission provisoire', `La part du résultat de cette coréalisation n’est pas encore validée : la commission ${what} maintenant ne porte que sur le MG. Son montant restera celui-ci ; après validation de la part, la régularisation éventuelle sera affichée (aucune modification automatique).`, `Confirmer (commission ${what} à titre provisoire)`));
}
const sideLabel = (x, w) => w === 'artbo' ? 'L’ArtBoristerie' : (x.partner || 'le coproducteur');

const lineName = id => { const p = id && byId('show_payments', id); return p ? (p.label || p.kind) : ''; };
export const BUDGET_ACTIONS = {
  coreaAddTier: t => saveCorea(t.dataset.id, c => { c.tiers.push({label: '', price: null, vat: 5.5, planned: null, qty: null, after: null}); }),
  coreaDelTier: async t => { const lab = byId('shows', t.dataset.id)?.corea?.tiers?.[Number(t.dataset.i)]?.label;
    if (await confirmAsk('Retirer le tarif ?', `Retirer le tarif « ${lab || 'sans nom'} » (prix et billets vendus compris) ?`, 'Retirer le tarif', {danger: true}))
      saveCorea(t.dataset.id, c => { c.tiers.splice(Number(t.dataset.i), 1); }); },
  coreaAddCharge: t => saveCorea(t.dataset.id, c => { c.charges.push({label: '', amount: null}); }),
  coreaDelCharge: async t => { const lab = byId('shows', t.dataset.id)?.corea?.charges?.[Number(t.dataset.i)]?.label;
    if (await confirmAsk('Retirer la charge ?', `Retirer la charge « ${lab || 'sans nom'} » du calcul du résultat partagé ?`, 'Retirer la charge', {danger: true}))
      saveCorea(t.dataset.id, c => { c.charges.splice(Number(t.dataset.i), 1); }); },
  // break : validation manuelle obligatoire avant tout calcul (anciens breaks compris) ; une autre valeur la rend caduque
  coreaValidateBreak: async t => { const s = byId('shows', t.dataset.id);
    if (!(await confirmAsk('Valider le break ?', `Break de ${s.break_even} billets vendus pour cette date${s.cr_break ? ` (texte du contrat : « ${s.cr_break} »)` : ''}. Le partage sera calculé sur les billets vendus au-delà.`, 'Valider le break'))) return;
    saveCorea(s.id, c => { c.break_validated_at = new Date().toISOString(); c.break_value = Number(s.break_even); c.break_by = me(); }); },
  // break des Conditions lu sans ambiguïté (demande du 07/11/2026) : repris dans « Break (billets) » seulement sur ce clic, jamais
  // validé par ce geste (« Valider le break » reste obligatoire) ; le texte du contrat reste tel quel
  coreaUseTextBreak: async t => { const s = byId('shows', t.dataset.id), n = breakFromText(s?.cr_break);
    if (!s || n == null || (s.break_even != null && s.break_even !== '')) return render();
    if (await save('shows', s.id, {break_even: n})) toast(`Break repris des Conditions : ${n} billets${s.prod_mode === 'booking' ? '' : ' — à valider avant tout calcul'}`); },
  // jauge ouverte saisie dans un budget (ou le Ticketing) : proposition de compléter les coûts encore vides (demande du 07/11/2026)
  'change:shows.capacity': async (t, v) => { const old = byId('shows', t.dataset.id)?.capacity;
    if (!(await save('shows', t.dataset.id, {capacity: v}))) return;
    if (v != null && Number(v) !== Number(old)) await offerCostFill(t.dataset.id); },
  fillMissingCosts: t => offerCostFill(t.dataset.id, {manual: true}),
  // (v1.67, point n°10) mode de rémunération d'une ligne de salaire : au cachet → bulletin Movinmotion (ligne posée si besoin) ;
  // sur facture → aucun bulletin (le nombre proposé baisse ; un nombre saisi pour la date reste celui saisi)
  'change:budget_lines.pay_mode': async (t, v) => { const l = byId('budget_lines', t.dataset.id);
    if (!(await save('budget_lines', t.dataset.id, {pay_mode: v === 'facture' ? 'facture' : 'cachet'}))) return;
    if (l?.show_id) await syncMovinmotionLine(l.show_id); render(); },
  'change:budget_lines.category': async (t, v) => { const l = byId('budget_lines', t.dataset.id);
    if (!(await save('budget_lines', t.dataset.id, {category: v}))) return;
    if (l?.show_id && v === 'Staff') await syncMovinmotionLine(l.show_id); render(); },
  // prorata des ventes : jamais appliqué sans validation explicite, pour cette date seulement
  coreaValidateProrata: async t => { const s = byId('shows', t.dataset.id), k = coreaCalc(s);
    if (!(await confirmAsk('Valider le prorata ?', `Les ventes après le break ne sont pas connues par tarif. Retenir pour cette date les recettes au prorata des ventes de chaque tarif : ${eur2(k.range.prorata)} HT (fourchette ${eur2(k.range.min)} à ${eur2(k.range.max)}) ?`, 'Valider le prorata'))) return;
    saveCorea(s.id, c => { c.method = {kind: 'prorata', at: new Date().toISOString(), by: me(), sig: k.sig}; }); },
  coreaClearMethod: t => saveCorea(t.dataset.id, c => { delete c.method; }),
  // part du résultat validée : elle entre dans la base de la commission (MG + part, décision du 27/10/2026 au soir) ; une commission
  // déjà figée (versement, facture) n'est jamais recalculée en silence : elle est signalée, la régularisation se décide à part
  coreaValidateShare: async t => { const s = byId('shows', t.dataset.id); if (!s) return;
    // part proposée : saisie dans Conditions en booking (pas de budget de production), calculée dans le Budget en production
    const booking = s.prod_mode === 'booking', raw = s.corea?.booking_share;
    const share = booking ? (raw == null || raw === '' ? null : Number(raw)) : coreaCalc(s)?.share;
    if (share == null || !isFinite(share) || share < 0) return toast(booking ? 'Saisis d’abord la part du résultat HT (0 si le break n’est pas dépassé)' : 'Part du résultat pas encore calculable', true);
    const mg = Number(s.fee_ht) || 0, rate = commissionPctOf(s), com = Math.round((mg + share) * rate) / 100, q = coreaCommissionCheck(s);
    const text = [`Part du résultat retenue : ${eur2(share)} HT.`, `Rémunération brute de l’artiste : MG ${eur2(mg)} + part = ${eur2(mg + share)}.`,
      `Commission L’ArtBo (${pct(rate)}) : ${eur2(com)} sur ce total.`,
      q?.frozen && Math.abs(com - q.held) >= 0.005 ? `Attention : la commission de cette date est déjà ${q.invoiced ? 'facturée' : q.cashed ? 'encaissée' : 'figée'} à ${eur2(q.held)}. Elle ne sera pas modifiée ; la régularisation (${com - q.held > 0 ? '+' : ''}${eur2(com - q.held)}) sera affichée, rien n’est fait automatiquement.` : ''].filter(Boolean).join('\n');
    if (!(await confirmAsk('Valider la part du résultat ?', text, 'Valider la part'))) return;
    await save('shows', s.id, {corea_share: share, corea: {...structuredClone(s.corea || {}), share_validated_at: new Date().toISOString(), share_validated_by: me()}}); },
  // part du résultat : ligne de facture préparée à la demande (rien n'est envoyé ni créé dans Pennylane) ; montant = part VALIDÉE
  coreaPrepareInvoice: async t => { const s = byId('shows', t.dataset.id), k = coreaCalc(s);
    if (k?.validatedShare == null) return toast('Valide d’abord la part du résultat', true);
    if (k.share == null || Math.abs(k.share - k.validatedShare) >= 0.005) return toast('La part calculée a changé depuis sa validation : valide-la de nouveau', true);
    if (paymentsOf(s.id).some(p => p.kind === 'autre' && /part du résultat/i.test(p.label || ''))) return toast('Une ligne « Part du résultat » existe déjà dans Factures', true);
    if (!(await confirmAsk('Préparer la ligne de facture ?', `Ajouter dans Factures une ligne « Part du résultat (coréalisation) » de ${eur2(k.validatedShare)} HT, en plus de l’acompte et du solde du minimum garanti. Rien n’est envoyé.`, 'Préparer la ligne'))) return;
    await insert('show_payments', {show_id: s.id, kind: 'autre', label: 'Part du résultat (coréalisation)', amount: k.validatedShare, sort: 60});
    toast('Ligne ajoutée dans Factures'); },
  // coproduction : clôture du résultat (synthèse, confirmation, enregistrement daté par la base, montants verrouillés)
  closeResult: async t => { const s = byId('shows', t.dataset.id), k = coprodClose(s), x = k.snapshot;
    if (!k.ok) return inform({title: 'Clôture impossible', text: k.issues.join('\n')});
    const text = [`Résultat global réel : ${eur2(x.result)}`, `Part de L’ArtBo (${x.shared_result < 0 ? 'pertes : ' + pct(x.artbo_loss_share) : pct(x.artbo_share)}) : ${eur2(x.artbo_part)}`, `Part de ${x.partner} : ${eur2(x.partner_part)}`,
      `Recettes encaissées par ${sideLabel(x, x.holder)} : ${eur2(x.net_encaisse)} (nettes)`, `Dépenses payées : L’ArtBo ${eur2(x.paid_artbo)} · coproducteur ${eur2(x.paid_partner)}`,
      ...(x.promo_debtor_rule === 'commun_historique' ? [`Promotion locale : ${PROMO_LEGACY_LABEL}`] : []),
      x.from ? `Reversement : ${sideLabel(x, x.from)} reverse ${eur2(x.transfer)} à ${sideLabel(x, x.to)}` : 'Aucun reversement', ...k.warnings,
      'Après clôture, les montants de la date sont verrouillés ; la réouverture demande un motif.'].join('\n');
    if (await ask({title: 'Clôturer le résultat ?', text, actions: [{value: 'ok', label: 'Clôturer le résultat'}]}) !== 'ok') return;
    const {error} = await sb.rpc('close_result', {p_show: s.id, p_snapshot: {...x, at: new Date().toISOString()}});
    if (error) return toast('Clôture impossible : ' + error.message, true);
    await refreshFor('shows', 'id', s.id); render(); toast('Résultat clôturé'); },
  reopenResult: async t => { const s = byId('shows', t.dataset.id);
    const reason = await askText({title: 'Rouvrir le résultat ?', text: 'Les montants de la date redeviennent modifiables. La réouverture est notée avec son motif.', label: 'Motif de la réouverture', ok: 'Rouvrir le résultat'});
    if (!reason) return;
    const {error} = await sb.rpc('reopen_result', {p_show: s.id, p_reason: reason});
    if (error) return toast('Réouverture impossible : ' + error.message, true);
    await refreshFor('shows', 'id', s.id); render(); toast('Résultat rouvert'); },

  prodAddTicket: t => saveProd(t.dataset.id, p => { p.tickets.push({label: '', qty: 0, price: 0, dl_prod: 0, dl_net: 0}); }),
  prodDelTicket: async t => { const lab = prodOf(byId('shows', t.dataset.id)).tickets[Number(t.dataset.i)]?.label;
    if (await confirmAsk('Retirer le tarif ?', `Retirer le tarif « ${lab || 'sans nom'} » de la billetterie de cette date (quantités et prix de ce tarif compris) ?`, 'Retirer le tarif', {danger: true}))
      saveProd(t.dataset.id, p => { p.tickets.splice(Number(t.dataset.i), 1); }); },
  prefillProduction: async t => {
    const s = byId('shows', t.dataset.id); let sort = nextSort(s.id);
    // date d'un spectacle (v1.57) : les cachets de son budget type (jauge ouverte) remplacent la ligne générique « Cachet artiste »
    const sp = s.spectacle_id ? byId('spectacles', s.spectacle_id) : null, staff = sp ? spectacleStaffRows(sp, s) : [];
    const rows = [...PROD_LINES.filter(([c, l]) => !(staff.length && c === 'Promoteur' && l === 'Cachet artiste')).map(([category, label]) => ({category, label})), ...staff]
      .map(r => ({...r, project_id: s.project_id, show_id: s.id, payer: 'artbo', sort: sort++}));
    const {data, error} = await sb.from('budget_lines').insert(rows).select();
    if (error) return toast('Préremplissage impossible : ' + error.message, true);
    mergeRows('budget_lines', data); await refreshBudgetMarker(data);
    if (staff.length) await syncMovinmotionLine(s.id);   // frais Movinmotion des bulletins (coût figé, v1.57)
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
    const fresh = !!s && !linesOf(s.id).length;   // budget créé par cette ligne (nouveau budget)
    const row = await insert('budget_lines', {project_id, show_id: s?.id || null, category: cat, label: cat === 'Staff' ? 'Cachet' : null, payer: isProductionShow(s) ? 'artbo' : 'compte', sort: s ? nextSort(s.id) : 0, doc_date: s ? null : today()});
    if (s && cat === 'Staff') await syncMovinmotionLine(s.id);
    // (v1.67) CNM due par L'ArtBo : ligne posée à la création du budget ; un budget existant sans ligne CNM garde son calcul
    // (demande d'Anthony du 25/11/2026 : seule une modification des paramètres CNM de la date l'ajoute)
    if (fresh) await syncCnmLine(s.id);
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
      // (v1.68.2) id : brouillon propre à la date de destination (sinon une saisie abandonnée revenait sur une autre date)
      values:{id: 'copie:' + s.id, from: opts[0][0], what:'all'},
      onSave: async v => {
        const src = linesOf(v.from).filter(l => v.what === 'all' || l.category === 'Staff')
          .filter(l => !l.auto || !linesOf(s.id).some(x => x.auto === l.auto))
          .filter(l => l.auto !== 'cnm' || cnmDue(s));
        let sort = nextSort(s.id);
        const rows = src.map(l => ({project_id:s.project_id, show_id:s.id, category:l.category, label:l.label, supplier:l.supplier, auto:l.auto, qty:l.qty, unit_cost:l.unit_cost, pay_mode:l.pay_mode ?? null,
          forecast: l.auto || l.category === 'Staff' ? l.forecast : (l.forecast ?? l.amount), payer:l.payer, payer_name:l.payer_name, employee_id:l.employee_id, sort: sort++}));
        if (!rows.length) return toast('Rien à copier', true);
        const {data, error} = await sb.from('budget_lines').insert(rows).select();
        if (error){ toast(error.message, true); return false; }
        mergeRows('budget_lines', data); await refreshBudgetMarker(data); await syncMovinmotionLine(s.id); toast(`${data.length} ligne(s) copiée(s)`); render();
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
      if (out.aRattacher || out.linked?.length){ const {fetchAll} = await import('./data.js'); S.db.pennylane_a_rattacher = await fetchAll('pennylane_a_rattacher'); touch('pennylane_a_rattacher'); }
      // (v1.69) avoirs importés : relus (lecture seule)
      if (out.avoirs){ const {fetchAll} = await import('./data.js'); S.db.pennylane_avoirs = await fetchAll('pennylane_avoirs'); touch('pennylane_avoirs'); }
      if (out.encaissements || out.remboursements){ const {fetchAll} = await import('./data.js'); S.db.reglements = await fetchAll('reglements'); touch('reglements'); }
      render();
      const lines = [out.linked?.length ? `${out.linked.length} facture(s) faite(s) depuis le devis, numéro repris : ${out.linked.filter(Boolean).join(', ')}\n` : '', out.updated.length ? `${out.updated.length} facture(s) marquée(s) payée(s) :\n- ` + out.updated.map(u => u.label).join('\n- ') : (out.linked?.length || out.filed?.done?.length || out.avoirs?.nouveaux || out.avoirs?.rattaches?.length) ? '' : 'Rien de nouveau : la Matrice est à jour.',
        out.erreurs?.length ? `\nÉcritures REFUSÉES (rien n’a été modifié pour ces lignes) — à examiner :\n- ` + out.erreurs.join('\n- ') : '',
        out.douteux?.length ? `\nFacture(s) Pennylane NON reliée(s) au solde : même montant qu’un acompte déjà noté à la main sur la date (numéro, envoi ou paiement) — à rattacher à la main à la bonne ligne :\n- ` + out.douteux.join('\n- ') : '',
        out.aRattacher ? `\n${out.aRattacher} facture(s) du devis NON reliée(s) automatiquement (plusieurs correspondances possibles, ou montant sans ligne) : « Rattacher… » dans l’onglet Factures de la date.` : '',
        out.pennylaneLate.length ? `\nPayées dans la Matrice mais pas encore dans Pennylane (à mettre à jour dans Pennylane) :\n- ` + out.pennylaneLate.join('\n- ') : '',
        // (v1.69, L1 du point 02) avoirs : importés et affichés, jamais un encaissement ni un remboursement
        out.avoirs?.importes ? `\n${out.avoirs.importes} avoir(s) Pennylane lu(s)${out.avoirs.nouveaux ? ` dont ${out.avoirs.nouveaux} nouveau(x)` : ''}${out.avoirs.rattaches?.length ? ` ; rattaché(s) à leur facture d’origine : ${out.avoirs.rattaches.join(', ')}` : ''}.` : '',
        out.avoirs?.aRattacher ? `\n${out.avoirs.aRattacher} avoir(s) à rattacher (facture d’origine inconnue, absente de MATRICE ou ambiguë) : liste en tête de Production. Rien n’est compté.` : '',
        out.avoirs?.origineChangee?.length ? `\nAvoir(s) dont Pennylane indique une AUTRE facture d’origine que celle du rattachement : laissés sur leur facture actuelle, à vérifier (signalés en tête de Production jusqu’à résolution) :\n- ` + out.avoirs.origineChangee.join('\n- ') : '',
        out.aVerifier?.length ? `\nRapprochements à VÉRIFIER À LA MAIN (doute : rien n’a été noté) :\n- ` + out.aVerifier.join('\n- ') : '',
        out.encaissements?.length ? `\nEncaissement(s) enregistré(s) d’après les virements Pennylane :\n- ` + out.encaissements.join('\n- ') : '',
        out.virementsPartiels?.length ? `\nEncaissement(s) partiel(s) : la facture reste due pour le reste :\n- ` + out.virementsPartiels.join('\n- ') : '',
        out.remboursements?.length ? `\nRemboursement(s) d’après les virements sortants rapprochés des avoirs :\n- ` + out.remboursements.join('\n- ') : '',
        out.avoirs?.disparus ? `\n${out.avoirs.disparus} avoir(s) qui ne sont plus dans Pennylane : gardés dans MATRICE, plus comptés.` : '',
        out.payeesAvecAvoir?.length ? `\nFactures avec avoir sans virement entrant établi : AUCUN encaissement noté (un avoir n’est pas un paiement) :\n- ` + out.payeesAvecAvoir.join('\n- ') : '',
        out.payeesSansTransaction?.length ? `\nPayées dans Pennylane sans virement rapproché : AUCUN encaissement noté (à vérifier dans Pennylane) :\n- ` + out.payeesSansTransaction.join('\n- ') : '',
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
  /**
   * (v1.70, L2a du point 02 — décisions d'Anthony du 26/11/2026, 18 h 47) Encaissement réel saisi à la main (TTC, E2) : date, montant,
   * compte ; marqué « non rapproché » jusqu'à son rapprochement Pennylane, qui ne le duplique jamais (R1). Au-delà du reste dû :
   * confirmation (trop-perçu affiché, aucun remboursement créé). Ligne couverte : date « Payée » = encaissement le plus récent.
   * Écriture côté serveur (reglement_saisir) ; rien n'est envoyé à Pennylane.
   */
  reglementEncaisser: async t => {
    const p = byId('show_payments', t.dataset.id); if (!p) return;
    if (p.paid_at) return toast('Facture déjà notée payée : son paiement est conservé tel quel.', true);
    const s = byId('shows', p.show_id), proj = byId('projects', s?.project_id), reste = resteDuTtc(p);
    const num = v => v == null || v === '' ? null : Number(String(v).replace(',', '.'));
    const level = MODALS_LEVEL();
    await openModal({title: 'Ajouter un encaissement', level, saveLabel: 'Enregistrer l’encaissement',
      fields: [{k: 'montant', label: 'Montant reçu TTC (€)', type: 'number'}, {k: 'date', label: 'Date de réception', type: 'date'},
        {k: 'compte', label: 'Arrivé sur', type: 'select', options: [['', 'Non renseigné'], ...['compte', 'artbo', 'artiste', 'autre'].map(c => [c, payerLabel(c, proj)])]},
        {k: 'reference', label: 'Référence (relevé bancaire)', full: true}],
      values: {id: 'encaissement:' + p.id, montant: reste || '', date: today(), compte: p.payee || ''},
      extraTop: `<p class="mb">${esc(p.label || p.kind)}${p.invoice_number ? ' · ' + esc(p.invoice_number) : ''} : facturé net <b>${eur2(factureNetTtc(p))}</b> TTC · déjà encaissé ${eur2(encaisseTtc(p))} TTC · reste dû <b>${eur2(reste)}</b> TTC. Saisi à la main : « non rapproché » jusqu’au rapprochement Pennylane (jamais compté deux fois).</p>`,
      onSave: async v => {
        const montant = num(v.montant);
        if (!(montant > 0)){ toast('Montant TTC à saisir', true); return false; }
        if (!v.date){ toast('Date de réception à saisir', true); return false; }
        if (montant > reste + 0.01 && !(await confirmAsk('Encaissement supérieur au reste dû ?', `${eur2(montant)} TTC pour un reste dû de ${eur2(reste)} TTC : l’excédent (${eur2(Math.round((montant - reste) * 100) / 100)} TTC) sera affiché comme encaissé au-delà du net facturé. Aucun remboursement n’est créé.`, 'Enregistrer quand même'))) return false;
        const {data, error} = await sb.rpc('reglement_saisir', {p_payment: p.id, p_sens: 'encaissement', p_etat: 'fait', p_montant: montant, p_date: v.date, p_compte: v.compte || null, p_reference: v.reference || null, p_motif: null});
        if (error){ toast(error.message, true); return false; }
        await reloadReglements(data);
        // ligne couverte : payée à la date de l'encaissement le plus récent (paiement non écrasé s'il a été noté entre-temps)
        const cur = byId('show_payments', p.id);
        if (cur && !cur.paid_at && resteDuTtc(cur) <= 0.01){
          const last = reglementsOf(p.id).filter(r => r.sens === 'encaissement' && r.etat === 'fait').map(r => r.date).sort().pop();
          const comptes = [...new Set(reglementsOf(p.id).filter(r => r.sens === 'encaissement').map(r => r.compte).filter(Boolean))];
          await save('show_payments', p.id, {paid_at: last, ...(!cur.payee && comptes.length === 1 ? {payee: comptes[0]} : {})}, {rerender: false});
        }
        toast('Encaissement enregistré.'); render(); return true;
      }});
  },
  /** (v1.70, L2a, D10) Remboursement à faire (montant, motif) ou fait (date, montant, compte, référence), saisi à la main : non rapproché
   *  jusqu'à son rapprochement Pennylane, qui ne le compte jamais une seconde fois. Un remboursement n'est jamais un avoir (E3). */
  reglementRembourser: async t => {
    const p = byId('show_payments', t.dataset.id); if (!p) return;
    const fait = t.dataset.etat === 'fait', s = byId('shows', p.show_id), proj = byId('projects', s?.project_id);
    const num = v => v == null || v === '' ? null : Number(String(v).replace(',', '.'));
    const fields = [{k: 'montant', label: 'Montant TTC (€)', type: 'number'}, ...(fait ? [{k: 'date', label: 'Date du remboursement', type: 'date'},
      {k: 'compte', label: 'Parti de', type: 'select', options: [['', 'Non renseigné'], ...['compte', 'artbo', 'artiste', 'autre'].map(c => [c, payerLabel(c, proj)])]},
      {k: 'reference', label: 'Référence (relevé bancaire)', full: true}] : []), {k: 'motif', label: 'Motif', type: 'textarea', full: true, max: 500}];
    await openModal({title: fait ? 'Remboursement fait' : 'Remboursement à faire', level: MODALS_LEVEL(), saveLabel: 'Enregistrer',
      fields, values: {id: (fait ? 'remboursement-fait:' : 'remboursement-a-faire:') + p.id, montant: tropPercuTtc(p) || '', ...(fait ? {date: today(), compte: p.payee || ''} : {})},
      extraTop: `<p class="mb">${esc(p.label || p.kind)}${p.invoice_number ? ' · ' + esc(p.invoice_number) : ''}. ${fait ? 'Mouvement d’argent sortant, saisi à la main : « non rapproché » jusqu’au rapprochement Pennylane.' : 'Décision de rembourser : aucun mouvement d’argent tant qu’il n’est pas marqué fait.'} Un remboursement et un avoir restent distincts.</p>`,
      onSave: async v => {
        const montant = num(v.montant);
        if (!(montant > 0)){ toast('Montant TTC à saisir', true); return false; }
        if (fait && !v.date){ toast('Date du remboursement à saisir', true); return false; }
        const {data, error} = await sb.rpc('reglement_saisir', {p_payment: p.id, p_sens: 'remboursement', p_etat: fait ? 'fait' : 'a_faire', p_montant: montant,
          p_date: fait ? v.date : null, p_compte: fait ? (v.compte || null) : null, p_reference: fait ? (v.reference || null) : null, p_motif: v.motif || null});
        if (error){ toast(error.message, true); return false; }
        await reloadReglements(data); toast(fait ? 'Remboursement enregistré.' : 'Remboursement à faire enregistré.'); render(); return true;
      }});
  },
  /** (v1.70) Remboursement à faire → fait : date, compte, référence (reglement_effectuer) */
  reglementFait: async t => {
    const r = (S.db.reglements || []).find(x => x.id === t.dataset.id); if (!r) return;
    const p = byId('show_payments', r.payment_id), proj = byId('projects', byId('shows', r.show_id)?.project_id);
    await openModal({title: 'Remboursement fait', level: MODALS_LEVEL(), saveLabel: 'Enregistrer',
      fields: [{k: 'date', label: 'Date du remboursement', type: 'date'}, {k: 'compte', label: 'Parti de', type: 'select', options: [['', 'Non renseigné'], ...['compte', 'artbo', 'artiste', 'autre'].map(c => [c, payerLabel(c, proj)])]},
        {k: 'reference', label: 'Référence (relevé bancaire)', full: true}],
      values: {id: 'remboursement-effectue:' + r.id, date: today(), compte: p?.payee || ''},
      extraTop: `<p class="mb">Remboursement de <b>${eur2(Number(r.montant_ttc))}</b> TTC${r.motif ? ' · ' + esc(r.motif) : ''}.</p>`,
      onSave: async v => {
        if (!v.date){ toast('Date du remboursement à saisir', true); return false; }
        const {data, error} = await sb.rpc('reglement_effectuer', {p_id: r.id, p_date: v.date, p_compte: v.compte || null, p_reference: v.reference || null});
        if (error){ toast(error.message, true); return false; }
        await reloadReglements(data); toast('Remboursement noté fait.'); render(); return true;
      }});
  },
  /** (v1.70, R2) Annuler une saisie manuelle non rapprochée : motif obligatoire ; jamais effacée (traçabilité). Une annulation n'est
   *  jamais un remboursement ; la base rouvre la facture si un reste dû apparaît (décision du 26/11/2026). */
  reglementAnnuler: async t => {
    const r = (S.db.reglements || []).find(x => x.id === t.dataset.id); if (!r) return;
    const motif = await askText({title: 'Annuler la saisie ?', text: `${r.sens === 'encaissement' ? 'Encaissement' : 'Remboursement'} de ${eur2(Number(r.montant_ttc))} TTC${r.date ? ' du ' + fmtDate(r.date) : ''}. La saisie reste visible, barrée, avec ce motif.`,
      label: 'Motif', ok: 'Annuler la saisie', check: v => !String(v || '').trim() ? 'Motif obligatoire' : String(v).trim().length > 500 ? '500 caractères au plus' : ''});
    if (motif == null) return;
    const {data, error} = await sb.rpc('reglement_annuler', {p_id: r.id, p_motif: motif});
    if (error){ toast(error.message, true); return; }
    await reloadReglements(data);
    // (décision d'Anthony du 26/11/2026, relecture B1) la base recalcule le statut de la ligne dans la même opération : rouverte si un
    // reste dû apparaît, sinon soldée à la date du dernier encaissement restant — relue ici (jamais recalculée par l'application)
    const {data: ligne} = await sb.from('show_payments').select('*').eq('id', r.payment_id).maybeSingle();
    const avant = byId('show_payments', r.payment_id), rouverte = !!(avant?.paid_at && ligne && !ligne.paid_at);
    if (ligne && avant){ Object.assign(avant, ligne); touch('show_payments'); }
    toast(rouverte ? 'Saisie annulée (gardée, barrée) : la facture redevient due.' : 'Saisie annulée (gardée, barrée).'); render();
  },
  /**
   * (v1.68, point n°23, décisions d'Anthony du 26/11/2026) « Déverrouiller pour corriger » une facture émise : la ligne reste
   * verrouillée tant que la correction n'est pas enregistrée ; montant HT, % du cachet et TVA de la ligne alignés sur la facture
   * réellement émise ; TYPE figé (un solde émis reclassé faisait recréer un second solde et son rappel — décision du 26/11/2026) ; motif obligatoire ; écriture et historique côté serveur (facture_corriger) ;
   * reverrouillée aussitôt. Le document Pennylane n'est ni modifié, ni annulé, ni réémis (aucun appel à Pennylane ici).
   */
  fixInvoice: async t => {
    const p = byId('show_payments', t.dataset.id); if (!p) return;
    if (!canFixInvoice(p)) return toast('Cette ligne ne se corrige pas ici (facture pas encore émise, commission de production ou ligne hors calcul).', true);
    const s = byId('shows', p.show_id), cur = payAmount(p);
    const KIND = {acompte: 'Acompte', solde: 'Solde', autre: 'Autre ligne', artbo: 'Commission L’ArtBo', partner: 'Part partenaire'};
    const num = v => v == null || v === '' ? null : Number(String(v).replace(',', '.'));
    const hist = correctionsOf(p.id).map(c => `<li>${fmtDate(String(c.at).slice(0, 10))}${c.actor ? ' · ' + esc(c.actor) : ''} · ${eur2(c.before?.amount ?? 0)} → ${eur2(c.after?.amount ?? 0)} HT · « ${esc(c.motif)} »</li>`).join('');
    const facts = [p.invoice_number ? `n° <b>${esc(p.invoice_number)}</b>` : 'sans n°', p.sent_at ? `envoyée le ${fmtDate(p.sent_at)}` : '', p.paid_at ? `payée le ${fmtDate(p.paid_at)}` : 'non payée',
      p.pennylane_id ? 'liée à Pennylane' : ''].filter(Boolean).join(' · ');
    const fields = [
      {k: 'amount', label: 'Montant HT (€)', type: 'number'},
      {k: 'pct', label: '% du cachet', type: 'number', placeholder: 'vide = non renseigné'},
      {k: 'vat_rate', label: 'TVA de la ligne (%)', type: 'number', placeholder: `vide = TVA par défaut (${String(payVat({...p, vat_rate: null})).replace(".", ",")} %)`},
      {k: 'motif', label: 'Motif de la correction (obligatoire)', type: 'textarea', full: true, rows: 2, max: 500, placeholder: 'ex. facture Pennylane émise à 35 %, et non 30 %'}];
    await openModal({title: 'Déverrouiller pour corriger', saveLabel: 'Enregistrer la correction', fields,
      // id : brouillon propre à CETTE facture (sans lui, une saisie abandonnée sur une facture revenait dans la fenêtre d'une autre)
      values: {id: p.id, amount: cur ?? '', pct: p.pct ?? '', vat_rate: p.vat_rate ?? ''},
      extraTop: `<div class="help full">
          <p class="m0"><b>${esc(p.label || KIND[p.kind] || p.kind)}</b> · ${facts}${s?.fee_ht ? ` · cachet ${eur2(s.fee_ht)} HT` : ''}</p>
          <p class="m0 mt-sm">La facture reste verrouillée tant que tu n’enregistres pas, et se reverrouille dès que la correction est enregistrée.</p>
          <p class="m0 mt-sm"><b>Modifiable ici (suivi MATRICE)</b> : montant HT, % du cachet, TVA de la ligne.</p>
          <p class="m0"><b>Inchangé</b> : type de ligne, date du concert, n° de facture, date d’envoi, date et statut de paiement, identifiant et lien Pennylane, « Arrive sur ».</p>
          <p class="m0"><b>À corriger dans Pennylane si le document est faux</b> (toi-même) : n°, montant et TVA facturés, client, date de facture, statut payé — avoir puis nouvelle facture. Rien n’est envoyé, modifié, annulé ni réémis dans Pennylane depuis ici.</p>
          ${hist ? `<p class="m0 mt-sm">Corrections précédentes :</p><ul class="warn-list">${hist}</ul>` : ''}</div>`,
      onSave: async v => {
        const amount = num(v.amount), pctv = num(v.pct), vat = num(v.vat_rate), motif = String(v.motif || '').trim();
        if (amount == null || !Number.isFinite(amount) || amount < 0 || amount >= 1e8){ toast('Montant HT à saisir (0 ou plus, moins de 100 millions)', true); return false; }
        if (pctv != null && !(pctv >= 0 && pctv <= 100)){ toast('% du cachet entre 0 et 100', true); return false; }
        if (vat != null && !(vat >= 0 && vat <= 100)){ toast('TVA entre 0 et 100 %', true); return false; }
        if (!motif){ toast('Indique le motif de la correction', true); return false; }
        if (motif.length > 500){ toast('Motif trop long (500 caractères au plus)', true); return false; }
        const same = (a, b) => (a == null || a === '' ? null : Number(a)) === (b == null || b === '' ? null : Number(b));
        const diffs = [!same(Math.round(amount * 100) / 100, p.amount) && `montant ${p.amount == null ? `${eur2(cur ?? 0)} (calculé)` : eur2(p.amount)} → ${eur2(amount)} HT`,
          !same(pctv, p.pct) && `% du cachet ${p.pct ?? "—"} → ${pctv ?? "—"}`, !same(vat, p.vat_rate) && `TVA ${p.vat_rate ?? 'par défaut'} → ${vat ?? 'par défaut'}`].filter(Boolean);
        if (!diffs.length){ toast('Aucun changement à enregistrer', true); return false; }
        const tt = ttc(amount, vat ?? payVat({...p, vat_rate: null}));
        if (!(await confirmAsk('Enregistrer la correction ?', `${p.invoice_number || p.label || KIND[p.kind]} : ${diffs.join(' ; ')} (TTC ${eur2(tt)}). Motif : « ${motif} ». La facture se reverrouille aussitôt ; Pennylane n’est pas modifié.`, 'Enregistrer la correction'))) return false;
        const {data, error} = await sb.rpc('facture_corriger', {p_payment: p.id, p_amount: amount, p_pct: pctv, p_vat: vat, p_motif: motif});
        if (error){ toast(error.message, true); return false; }
        if (data?.row) mergeRows('show_payments', [data.row]); else await refreshFor('show_payments', 'show_id', [p.show_id]);
        const {fetchAll} = await import('./data.js'); S.db.facture_corrections = await fetchAll('facture_corrections'); touch('facture_corrections');
        toast('Correction enregistrée : la facture est de nouveau verrouillée (Pennylane inchangé).'); render();
        return true;
      }});
  },
  /**
   * Rattacher (ou corriger le rattachement d') une facture Pennylane du devis à une ligne d'acompte ou de solde de la date (v1.56.9).
   * Choix explicite de la ligne ; document, montant et associations affichés ; motif obligatoire pour une correction ; confirmation ;
   * écriture et historique côté serveur (pennylane_rattacher) ; le document Pennylane n'est jamais modifié.
   */
  pennylaneAttach: async t => {
    const s = byId('shows', t.dataset.show), pid = t.dataset.pid; if (!s || !pid) return;
    const pend = S.db.pennylane_a_rattacher.find(r => r.pennylane_id === pid);
    const lines = paymentsOf(s.id).filter(p => ['acompte', 'solde'].includes(p.kind) && p.hors_calcul == null);
    const cur = lines.find(p => p.pennylane_id === pid);
    const num = cur?.invoice_number || pend?.invoice_number || 'Facture ' + pid, amt = pend?.amount_ht ?? cur?.amount;
    if (pend?.cancelled_at) return toast('Facture annulée dans Pennylane : elle ne se rattache plus', true);
    // lignes possibles : sans facture Pennylane ; un n° noté à la main seulement s'il est celui de ce document (cas Monestier) ;
    // jamais une ligne payée sans n° (même règle que la base : pennylane_rattacher) ; plus d'acompte « caduc » (10/11/2026)
    const same = n => String(n || '').replace(/[^a-z0-9]/gi, '').toUpperCase() === String(num).replace(/[^a-z0-9]/gi, '').toUpperCase();   // comme la synchronisation (norm)
    const targets = lines.filter(p => p.id !== cur?.id && !p.pennylane_id
      && (!String(p.invoice_number || '').trim() ? !p.paid_at : same(p.invoice_number)));
    if (!targets.length) return toast('Aucune ligne possible : chaque acompte / solde a déjà une autre facture (ou un paiement sans n°). Corrige d’abord la ligne concernée.', true);
    const assoc = lines.map(p => `<li>${esc(p.label || p.kind)} · ${eur2(payAmount(p) || 0)} HT · ${p.pennylane_id ? `facture ${esc(p.invoice_number || p.pennylane_id)}` : p.invoice_number ? `n° ${esc(p.invoice_number)} (noté à la main)` : '<span class="muted">aucune facture</span>'}${p.paid_at ? ' · payée' : ''}</li>`).join('');
    const hist = S.db.pennylane_rattachements.filter(h => h.pennylane_id === pid).sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .map(h => `<li>${fmtDate(String(h.at).slice(0, 10))} · ${esc(h.actor || '')} · ${esc(lineName(h.from_payment_id) || '—')} → ${esc(lineName(h.to_payment_id) || '—')}${h.motif ? ' · « ' + esc(h.motif) + ' »' : ''}</li>`).join('');
    await openModal({title: cur ? 'Corriger le rattachement' : 'Rattacher la facture', saveLabel: cur ? 'Corriger' : 'Rattacher',
      extraTop: `<div class="help full"><p class="m0"><b>${esc(num)}</b> · ${amt != null ? eur2(amt) + ' HT' : 'montant inconnu'}${pend?.invoice_date ? ' · ' + fmtDate(pend.invoice_date) : ''}
          ${(pend?.url || cur?.pennylane_url) ? ` · <a href="${esc(pend?.url || cur?.pennylane_url)}" target="_blank" rel="noopener">voir le document dans Pennylane ↗</a>` : ''}</p>
        ${pend?.reason && !pend.resolved_at ? `<p class="m0 warn-txt">${esc(pend.reason)}</p>` : ''}
        <p class="m0 mt-sm">Lignes de la date :</p><ul class="warn-list">${assoc}</ul>
        ${hist ? `<p class="m0">Historique de cette facture :</p><ul class="warn-list">${hist}</ul>` : ''}
        <p class="m0">Le document Pennylane n’est pas modifié. Le numéro, le lien, la date de facture et la date d’envoi suivent la facture.</p></div>`,
      // (v1.68.2) id : brouillon propre à CETTE facture Pennylane (sinon un motif ou une ligne choisie pour une facture revenait sur une autre)
      values: {id: 'pennylane:' + pid},
      fields: [{k: 'to', label: 'Ligne de cette facture', type: 'select', full: true, options: targets.map(p => [p.id, `${p.label || p.kind} · ${eur2(payAmount(p) || 0)} HT${p.invoice_number ? ` · n° ${p.invoice_number} noté à la main` : acompteState(p) === 'prevu' ? ' (prévu)' : ''}`])},
        {k: 'motif', label: cur ? 'Motif de la correction (obligatoire)' : 'Motif (facultatif)', type: 'textarea', full: true, rows: 2}],
      onSave: async v => {
        if (!v.to){ toast('Choisis la ligne', true); return false; }
        if (cur && !String(v.motif || '').trim()){ toast('Indique le motif de la correction', true); return false; }
        const to = byId('show_payments', v.to);
        if (!(await confirmAsk(cur ? 'Corriger le rattachement ?' : 'Rattacher la facture ?', `${num} (${amt != null ? eur2(amt) + ' HT' : 'montant inconnu'}) ${cur ? `passe de « ${cur.label || cur.kind} » à` : 'est rattachée à'} « ${to?.label || to?.kind} ». ${cur ? 'La ligne quittée redevient « non facturée ». ' : ''}Le document Pennylane n’est pas modifié ; le choix est gardé aux synchronisations suivantes.`, cur ? 'Corriger' : 'Rattacher'))) return false;
        const {data, error} = await sb.rpc('pennylane_rattacher', {p_pennylane_id: pid, p_payment: v.to, p_motif: v.motif || null});
        if (error){ toast(error.message, true); return false; }
        await refreshFor('show_payments', 'show_id', [s.id]);
        for (const tb of ['pennylane_a_rattacher', 'pennylane_rattachements']){ const {fetchAll} = await import('./data.js'); S.db[tb] = await fetchAll(tb); touch(tb); }
        toast(`${data?.invoice_number || num} rattachée à « ${to?.label || to?.kind} »`); render();
        return true;
      }});
  },
  testPennylane: async () => { try { const out = await pennylane('status', {}); toast(`Pennylane OK : ${out.company || 'compte connecté'}`); } catch (err) { toast(err.message, true); } },
  pennylaneQuote: async t => {
    const s = byId('shows', t.dataset.id);
    if (isCoproduction(s)) return toast('Coproduction : pas de devis Pennylane (le résultat n’est pas connu) ; les factures se préparent après la clôture', true);
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
      values: {id: 'piece:' + a.id},   // (v1.68.2) brouillon propre à cette pièce (ligne et n° de facture d'une pièce ne reviennent pas sur une autre)
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
    if (p?.kind === 'artbo' && !(await confirmProvisionalCommission(byId('shows', p.show_id), 'facturée'))) return;
    t.disabled = true; toast('Création de la facture en brouillon dans Pennylane…');
    try { const out = await pennylane('invoice', {payment_id: p.id}); await save('show_payments', p.id, {pennylane_id: String(out.id), pennylane_url: out.url || null}); toast(`Facture créée en brouillon dans Pennylane${out.headers === false ? ' (complète « Projet » et « Date de réalisation »)' : ''}`); }
    catch (err) { toast(err.message, true); }
    t.disabled = false;
  },
};

/** Niveau de fenêtre : au-dessus d'une fenêtre déjà ouverte */
const MODALS_LEVEL = () => document.querySelector('#modal[open]') ? 2 : 1;
/** Mouvements relus après une écriture côté serveur (lecture seule dans l'application) */
async function reloadReglements(row){
  if (row?.id){ S.db.reglements = [...(S.db.reglements || []).filter(r => r.id !== row.id), row]; touch('reglements'); return; }
  const {fetchAll} = await import('./data.js'); S.db.reglements = await fetchAll('reglements'); touch('reglements');
}
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
    let upErr;
    try { ({error: upErr} = await sb.storage.from('suivi').upload(path, typedFile(file), {contentType: contentTypeOf(file)})); }
    catch (err){ upErr = {message: await uploadFailure(file, err)}; }
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
    // (v1.68.2) id : brouillon propre à CE conflit, fichier du Drive + pièce ajoutée (sinon un choix fait ailleurs, ex. « Remplacer », revenait ici)
    values: {id: 'drive:' + (dup.url || dup.name) + ':' + name, decision: dup.same ? 'skip' : 'replace'}, onSave: v => v.decision});
}

const isOurs = n => /artboristerie/i.test(n || '');
const cleanDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null;

/** Lignes auxquelles une facture de vente peut être rattachée : celles affichées dans l'onglet Factures
 *  (date en booking : aucune — acomptes / soldes de l'artiste, hors du suivi de L'ArtBo) */
const attachableLines = s => !s || s.prod_mode === 'booking' ? []   // booking : acomptes / soldes = factures de l'artiste, jamais rattachées (lot C1)
  : paymentsOf(s.id).filter(p => ['acompte','solde','autre'].includes(p.kind));   // plus d'acompte « caduc » (10/11/2026) : un acompte prévu reste dû

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
  if (!e.dataTransfer?.files?.length) return;
  // (v1.60.3) pièce copiée en mémoire dès le dépôt (fichier temporaire d'une autre application, ex. pièce jointe glissée depuis Mail)
  takeDropped(e).then(({files}) => { if (files.length) readPieces(ctx, files); }); }, true);
document.addEventListener('change', e => { const t = e.target; if (!t.dataset?.budgetPick) return; const files = [...t.files]; t.value = '';
  if (files.length) readPieces(JSON.parse(t.dataset.budgetPick), files); });

