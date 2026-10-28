/**
 * Budget dans l'onglet Production : le budget de chaque date (prévu / réel, pièces, qui paie)
 * et la vue d'ensemble d'un artiste (compte dédié, toutes les dates, frais hors date).
 */
import { accountMoves, accountOf, availableForArtist, coreaCommissionCheck, cnmPct, commissionAmount, commissionOf, isFree, isSolde, lineForecast, lineStatus, lineValue, linesOf, offLinesOf, payerLabel, payslipCost, prodShowsOf, showBudget } from '../budget.js';
import { BUDGET_CATS, PAYERS } from '../constants.js';
import { commissionState, payAmount, paymentsOf } from '../calc.js';
import { byId } from '../selectors.js';
import { S } from '../state.js';
import { cChk, cIn, cSel } from '../ui/cells.js';
import { HOLDERS, cnmBearer, cnmOf, coreaCalc, holderLabel, isCorea } from '../corea.js';
import { esc, eur2, fmtDate, today, r2, pct as fmtPct } from '../utils.js';
import { COPROD_ROLES, PROD_CATS, PROMO_DEBTORS, PROMO_PAYERS, coprodClose, coprodLines, isProductionShow, productionBudget } from '../production-budget.js';

const STATUS = {paid:['Payé','ok-badge'], doc:['Pièce reçue','warn-badge'], planned:['Prévu','badge']};
const badge = l => { const [t,c] = STATUS[lineStatus(l)]; return `<span class="${c}">${t}</span>`; };
const money = (v, cls='') => `<span class="num nowrap ${cls}">${eur2(v)}</span>`;

function lineRow(l, project, {qtyAll = false} = {}){
  const fc = lineForecast(l), staff = l.category === 'Staff' || (qtyAll && !l.auto), auto = !!l.auto, st = lineStatus(l);
  // « Coproducteur » seulement dans le budget d'une coproduction (positions et reversement à la clôture, v1.51)
  const copro = byId('shows', l.show_id)?.contract_type === 'Co-Production';
  const payers = PAYERS.filter(c => c !== 'partenaire' || copro || l.payer === 'partenaire').map(c => [c, payerLabel(c, project)]);
  const hasQty = staff && l.forecast == null;
  const prev = staff && hasQty
    ? `<span class="qty-line">${cIn('budget_lines', l.id, 'qty', l.qty, 'number', `class="narrow" title="${qtyAll ? 'Quantité' : 'Nombre de bulletins'}" placeholder="${qtyAll ? 'qté' : 'nb'}"`)}<span class="x">×</span>${cIn('budget_lines', l.id, 'unit_cost', l.unit_cost, 'number', `class="narrow2" title="${qtyAll ? 'Prix unitaire HT' : 'Coût employeur d’un bulletin'}" placeholder="${qtyAll ? 'P.U.' : 'coût'}"`)}<b>${eur2(fc ?? 0)}</b></span>`
    : `<input type="number" step="any" data-t="budget_lines" data-id="${l.id}" data-f="forecast" value="${l.forecast??''}" placeholder="${fc==null?'à saisir':fc}" class="${auto && l.forecast!=null?'override':''}" title="${auto ? (l.forecast!=null ? 'Montant saisi à la main à la place du calcul automatique (efface-le pour revenir au calcul)' : 'Vide = calcul automatique') : 'Montant prévu HT'}">`;
  const calc = l.auto==='movinmotion' ? 'bulletins × coût Movinmotion' : l.auto==='cnm' ? '% du cachet (entrée gratuite)' : '';
  return `<tr data-budget-line="${l.id}" class="${st==='paid'?'is-paid':st==='doc'?'has-doc':''}" title="${st==='paid'?'Payé':st==='doc'?'Pièce reçue, pas encore payée':'Prévu'}">
    <td>${cSel('budget_lines', l.id, 'category', l.category, BUDGET_CATS)}</td>
    <td>${cIn('budget_lines', l.id, 'label', l.label, 'text', 'placeholder="Libellé"')}${calc?`<div class="muted calc-note">calcul : ${calc}</div>`:''}</td>
    <td>${cIn('budget_lines', l.id, 'supplier', l.supplier, 'text', `placeholder="${staff?'Salarié':'Fournisseur'}"`)}</td>
    <td>${cSel('budget_lines', l.id, 'payer', l.payer || 'compte', payers, false)}</td>
    <td class="num">${prev}</td>
    <td class="num"><input type="number" step="any" data-t="budget_lines" data-id="${l.id}" data-f="amount" value="${l.amount??''}" placeholder="—" title="${staff?'Coût total (bulletin)':'Montant réel HT (pièce)'}"></td>
    <td class="nowrap">${l.file_path ? `<button class="btn icon sm" data-act="openBudgetFile" data-id="${l.id}" title="${esc(l.file_name||'Pièce')}" aria-label="Ouvrir la pièce">📎</button>` : ''}${l.drive_file_id ? `<a class="btn icon sm" href="https://drive.google.com/file/d/${esc(l.drive_file_id)}/view" target="_blank" rel="noopener" title="Rangée dans le Drive de la date" aria-label="Ouvrir dans le Drive">▲</a>` : ''}${cIn('budget_lines', l.id, 'doc_number', l.doc_number, 'text', 'placeholder="N° pièce" class="doc-no"')}</td>
    <td class="${l.paid_at?'done-cell':''}">${cIn('budget_lines', l.id, 'paid_at', l.paid_at, 'date')}${['artbo', 'autre'].includes(l.payer) && l.paid_at ? `<div class="reimb ${l.reimbursed_at?'done-cell':''}" title="${esc(payerLabel(l.payer, project))} a avancé cette dépense : date à laquelle ${esc(payerLabel('compte', project))} l’a remboursée"><span class="muted">remboursé à ${esc(payerLabel(l.payer, project))} le</span>${cIn('budget_lines', l.id, 'reimbursed_at', l.reimbursed_at, 'date')}</div>` : ''}</td>
    <td><button class="btn icon sm ghost danger" data-act="delBudgetLine" data-id="${l.id}" aria-label="Supprimer la ligne">✕</button></td>
  </tr>`;
}

/**
 * Lignes rangées par catégorie (dans l'ordre des catégories du budget), avec un sous-total par catégorie ;
 * une ligne qui change de catégorie va d'elle-même au bon endroit. Dans une catégorie : l'ordre d'ajout.
 */
function byCategory(lines, project){
  const order = c => { const i = BUDGET_CATS.indexOf(c || 'Autres'); return i < 0 ? BUDGET_CATS.length : i; };
  const groups = new Map();
  for (const l of lines.slice().sort((a, b) => order(a.category) - order(b.category))) { const c = l.category || 'Autres'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(l); }
  return [...groups].map(([c, ls]) => { const f = ls.reduce((t, l) => t + (lineForecast(l) ?? (Number(l.amount) || 0)), 0), r = ls.reduce((t, l) => t + lineValue(l), 0);
    return `<tr class="cat-row"><td colspan="9"><b>${esc(c)}</b> <span class="muted">· prévu ${eur2(f)} · à jour ${eur2(r)}</span></td></tr>` + ls.map(l => lineRow(l, project)).join(''); }).join('');
}

const HEAD = '<thead><tr><th>Catégorie</th><th>Libellé</th><th>Fournisseur</th><th>Payé par</th><th class="num col-prev">Prévu HT</th><th class="num col-real">Réel HT</th><th>Pièce</th><th>Payé le</th><th></th></tr></thead>';

function dropZone(attrs, text){
  return `<div class="dropzone budget-drop" ${attrs}>
    <label class="btn sm file-btn">Ajouter une pièce<input class="file-input" type="file" multiple accept="application/pdf,image/*" ${attrs.replace('data-budget-drop','data-budget-pick')}></label>
    <span class="drop-hint">${text}</span></div>`;
}

/**
 * Résumé lisible : prévu / réel / écart. Une seule logique sur toutes les lignes :
 *  - « Réel » = ce qu'on sait aujourd'hui : le montant réel quand il est connu, sinon le prévu (encore estimé) ;
 *  - « Écart » = seulement ce qui a vraiment changé (réel connu − son prévu) ;
 *  - le reste pour l'artiste se calcule avec les mêmes chiffres, donc il tombe juste avec les lignes du dessus.
 */
/** Commission de production (lot D1) : total, déjà transféré, reste — même texte dans le budget, l'onglet Factures et l'export */
export function commissionStatus(com){
  if (!com) return 'pas encore versée';
  const st = commissionState(com), dates = st.transfers.map(t => fmtDate(t.transferred_at));
  if (st.legacy) return `versée le ${fmtDate(com.paid_at)}`;
  if (st.full) return st.transfers.length > 1 ? `versée en ${st.transfers.length} fois (${dates.join(', ')})` : `versée le ${dates[0]}`;
  if (st.partial) return `versée en partie : ${eur2(st.transferred)} transférés (${dates.join(', ')}), reste ${eur2(st.remaining)} à transférer`;
  return 'pas encore versée';
}
/** Cellule « versement » d'une commission de production : historique des versements + bouton pour noter le suivant */
export function commissionTransferCell(com){
  if (!com) return '<span class="muted">—</span>';
  const st = commissionState(com);
  const list = st.transfers.map(t => `<div class="nowrap" title="${esc([t.reference, t.note].filter(Boolean).join(' · '))}">${eur2(Number(t.amount))} · ${fmtDate(t.transferred_at)}${t.reference ? ' · ' + esc(t.reference) : ''}</div>`).join('');
  const legacy = st.legacy ? `<div class="nowrap">${eur2(st.total)} · ${fmtDate(com.paid_at)}</div>` : '';
  const btn = st.remaining >= 0.005 && !st.legacy ? `<button class="btn sm" data-act="addTransfer" data-id="${com.id}" title="Noter un virement réel vers L’ArtBo (date, montant, référence)">Noter un versement</button>` : '';
  return `${legacy}${list}${btn}`;
}

function summaryTable(s, b, com, p){
  const exp = b.lines.filter(l => !isSolde(l)), real = exp.filter(l => l.amount != null), est = exp.filter(l => l.amount == null);
  const realSum = real.reduce((t, l) => t + Number(l.amount), 0), estSum = est.reduce((t, l) => t + (lineForecast(l) || 0), 0);
  const expNow = r2(realSum + estSum), expGap = r2(real.reduce((t, l) => t + Number(l.amount) - (lineForecast(l) ?? Number(l.amount)), 0));
  const cashedRows = paymentsOf(s.id).filter(x => ['acompte', 'solde'].includes(x.kind) && x.paid_at);
  const cashed = cashedRows.reduce((t, x) => t + (payAmount(x) || 0), 0);
  // part encaissée sans compte d'encaissement (§6.6, Q6, M9) : comptée dans la date, signalée ; aucun total changé
  const unassigned = r2(cashedRows.filter(x => !x.payee).reduce((t, x) => t + (payAmount(x) || 0), 0));
  const gapCell = (g, cost) => `<td class="num nowrap ${Math.abs(g) < 0.01 ? 'muted' : (g > 0) === cost ? 'neg' : 'pos'}">${Math.abs(g) < 0.01 ? eur2(0) : (g > 0 ? '+' : '') + eur2(g)}</td>`;
  const row = (label, f, r, gap, help, {cost = false, strong = false} = {}) => `<tr class="${strong ? 'bill-total' : ''}"><td>${strong ? `<b>${label}</b>` : label}${help ? `<div class="muted tiny">${help}</div>` : ''}</td>
      <td class="num nowrap">${strong ? `<b>${eur2(f)}</b>` : eur2(f)}</td><td class="num nowrap">${strong ? `<b>${eur2(r)}</b>` : eur2(r)}</td>${gapCell(gap, cost)}</tr>`;
  const resteF = r2(b.gross - b.com - b.forecastExp), resteR = r2(b.gross - b.com - expNow);
  // coréalisation : rémunération brute = MG + part du résultat validée ; la commission porte sur le tout (v1.51)
  const corea = isCorea(s), shareTodo = corea && (s.corea_share == null || s.corea_share === '');
  const brut = corea ? 'MG + part − commission − dépenses' : 'cachet − commission − dépenses';
  return `<div class="tbl-wrap"><table class="budget-sum"><thead><tr><th></th><th class="num">Prévu</th><th class="num" title="Montant réel quand il est connu, sinon le prévu">Réel / à jour</th><th class="num">Écart</th></tr></thead><tbody>
    ${row('Cachet HT', b.fee, b.fee, 0, (cashed >= b.fee - 0.01 && b.fee ? 'entièrement encaissé' : `encaissé : ${eur2(cashed)} sur ${eur2(b.fee)}`) + (unassigned ? ` · dont ${eur2(unassigned)} — compte non renseigné` : ''))}
    ${corea ? row('Part du résultat (coréalisation)', b.share, b.share, 0, shareTodo ? 'pas encore validée : la commission ne porte pour l’instant que sur le MG' : 'validée · comprise dans la base de la commission') : ''}
    ${row('Commission L’ArtBo', b.com, b.com, 0, commissionStatus(com) + (corea ? ` · sur ${eur2(b.gross)} (MG${shareTodo ? ' seul, provisoire' : ' + part'})` : '')
      + ((q => q && Math.abs(q.gap) >= 0.005 ? ` · régularisation à prévoir : ${q.gap > 0 ? '+' : ''}${eur2(q.gap)} (montant historique conservé)` : '')(coreaCommissionCheck(s))), {cost: true})}
    ${row('Dépenses', b.forecastExp, expNow, expGap, !exp.length ? 'aucune ligne' : est.length ? `${eur2(realSum)} réels (${real.length} ligne${real.length > 1 ? 's' : ''}) + ${eur2(estSum)} encore au prévu (${est.length} ligne${est.length > 1 ? 's' : ''})` : 'toutes les lignes ont leur montant réel', {cost: true})}
    ${row('Reste pour l’artiste' + (p?.artist_payee ? ` (${esc(p.artist_payee)})` : ''), resteF, resteR, r2(resteR - resteF), est.length ? `${brut} · encore provisoire : ${est.length} dépense${est.length > 1 ? 's' : ''} au prévu` : `${brut} · définitif`, {strong: true})}
  </tbody></table></div>
  <p class="muted" style="font-size:12px;margin:6px 0 12px">Pièces reçues : ${b.docsIn}/${b.docsAll} · ${b.paid} payées.</p>`;
}

/**
 * Résultat : ce qui reste pour l'artiste (calculé, jamais saisi) et ce qui lui a été versé.
 * Écart vu de L'ArtBo : reste calculé − versé (négatif = versé plus que le reste, on perd de l'argent ; positif = on en garde).
 */
export function artistResult(s, b = showBudget(s)){
  const sl = b.lines.filter(isSolde), reste = r2(availableForArtist(s));
  // versé = montant saisi ET date de versement ; un montant sans date = connu, encore à verser
  const known = sl.filter(l => l.amount != null), paid = known.filter(l => l.paid_at);
  const verse = r2(paid.reduce((t, l) => t + Number(l.amount), 0)), todo = r2(known.filter(l => !l.paid_at).reduce((t, l) => t + Number(l.amount), 0));
  return {reste, verse, todo, hasVerse: paid.length > 0, ecart: known.length ? r2(reste - verse - todo) : null, lines: sl};
}
export const ecartHTML = e => e == null ? '<span class="muted">—</span>' : Math.abs(e) < 0.01 ? '<span class="muted">0,00 €</span>'
  : `<b style="color:var(--${e < 0 ? 'danger' : 'ok'})">${e > 0 ? '+' : ''}${eur2(e)}</b>`;

function artistBlock(s, b, p){
  const r = artistResult(s, b), who = p?.artist_payee || 'l’artiste';
  const payers = PAYERS.map(c => [c, payerLabel(c, p)]);
  const rows = r.lines.map(l => `<tr data-budget-line="${l.id}" class="${l.paid_at ? 'is-paid' : ''}">
      <td>${cIn('budget_lines', l.id, 'supplier', l.supplier, 'text', `placeholder="${esc(p?.artist_payee || 'Bénéficiaire')}"`)}</td>
      <td class="num"><input type="number" step="any" data-t="budget_lines" data-id="${l.id}" data-f="amount" value="${l.amount ?? ''}" placeholder="${esc(String(r.reste))}" title="Montant réellement versé (HT)"></td>
      <td class="${l.paid_at ? 'done-cell' : ''}">${cIn('budget_lines', l.id, 'paid_at', l.paid_at, 'date')}</td>
      <td>${cSel('budget_lines', l.id, 'payer', l.payer || 'compte', payers, false)}${(l.payer || 'compte') !== 'compte' && l.paid_at ? `<div class="reimb ${l.reimbursed_at ? 'done-cell' : ''}"><span class="muted">Déduit du compte le</span>${cIn('budget_lines', l.id, 'reimbursed_at', l.reimbursed_at, 'date')}</div>` : ''}</td>
      <td class="nowrap">${l.file_path ? `<button class="btn icon sm" data-act="openBudgetFile" data-id="${l.id}" title="${esc(l.file_name||'Pièce')}" aria-label="Ouvrir la pièce">📎</button>` : ''}${l.drive_file_id ? `<a class="btn icon sm" href="https://drive.google.com/file/d/${esc(l.drive_file_id)}/view" target="_blank" rel="noopener" title="Rangée dans le Drive de la date" aria-label="Ouvrir dans le Drive">▲</a>` : ''}${cIn('budget_lines', l.id, 'doc_number', l.doc_number, 'text', 'placeholder="N° facture" style="min-width:80px"')}</td>
      <td><button class="btn icon sm ghost danger" data-act="delBudgetLine" data-id="${l.id}" aria-label="Supprimer ce versement">✕</button></td></tr>`).join('');
  return `<div class="artist-result">
    <h4 class="block-title">Reste pour ${esc(who)}</h4>
    <div class="ar-grid">
      <div class="stat"><b>${eur2(r.reste)}</b><span>calculé : ${b.share ? `MG ${eur2(b.fee)} + part ${eur2(b.share)}` : `cachet ${eur2(b.fee)}`} − commission ${eur2(b.com)} − dépenses ${eur2(b.expenses)}</span></div>
      <div class="stat"><b>${r.hasVerse ? eur2(r.verse) : '—'}</b><span>versé à ${esc(who)}${r.todo ? ` · <b>${eur2(r.todo)}</b> encore à verser (pas de date)` : ''}</span></div>
      <div class="stat"><b>${ecartHTML(r.ecart)}</b><span>${r.ecart == null ? 'écart : quand le versement est noté' : r.ecart < -0.005 ? 'écart pour toi : versé plus que le reste, tu perds' : r.ecart > 0.005 ? 'écart pour toi : versé moins que le reste, tu gagnes' : 'écart pour toi : juste'}</span></div>
    </div>
    ${r.lines.length ? `<div class="tbl-wrap"><table class="budget-table"><thead><tr><th>Versé à</th><th class="num">Montant versé HT</th><th>Versé le</th><th>Payé par</th><th>Facture</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    <div class="vh-actions mt-sm">
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Solde artiste">${r.lines.length ? 'Ajouter un versement' : 'Noter le versement'}</button>
      <button class="btn sm ghost" data-act="exportArtistBudget" data-id="${s.id}">Exporter pour ${esc(who)}</button>
    </div>
  </div>`;
}

/** Budget d'une date (dans la date dépliée) */
export function showBudgetHTML(s){
  const p = byId('projects', s.project_id), b = showBudget(s), com = commissionOf(s);
  const cst = com ? commissionState(com) : null;
  const comRow = `<tr class="${cst?.full || cst?.legacy ? 'is-paid' : ''}"><td><b>Commission</b></td><td><span>Commission L'ArtBo</span> ${com?.amount != null && com.amount !== '' ? `<span class="muted" title="Montant saisi à la main dans Factures">(montant saisi)</span>` : com?.pct != null && com.pct !== '' ? cIn('show_payments', com.id, 'pct', com.pct, 'number', 'class="narrow" title="% de commission sur cette date"') : cIn('shows', s.id, 'artbo_pct', s.artbo_pct, 'number', 'class="narrow" title="% de commission sur cette date"')} %</td><td>L'ArtBoristerie</td><td>${esc(payerLabel('compte', p))}</td>
    <td class="num">${money(commissionAmount(s))}</td><td class="num">${cst && (cst.transferred || cst.remaining) ? eur2(cst.transferred) : '—'}</td><td class="muted">${cst?.full || cst?.legacy ? 'versée' : cst?.partial ? `reste ${eur2(cst.remaining)} à te verser` : 'à te verser'}</td>
    <td class="${cst?.full || cst?.legacy ? 'done-cell' : ''}">${commissionTransferCell(com)}</td><td></td></tr>`;
  return `<div class="prod-budget">

    ${summaryTable(s, b, com, p)}
    ${cnmBlock(s)}
    ${isCorea(s) ? coreaBlock(s) : ''}
    <div class="tbl-wrap"><table class="budget-table">${HEAD}<tbody>${comRow}${byCategory(b.lines.filter(l => !isSolde(l)), p)}</tbody></table></div>
    <div class="vh-actions mt">
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}">Ajouter une dépense</button>
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Staff">Ajouter un salarié</button>
      ${b.lines.length ? '' : `<button class="btn sm primary" data-act="prefillBudget" data-id="${s.id}">Préremplir (budget type)</button>`}
      <button class="btn sm ghost" data-act="copyBudget" data-id="${s.id}">Copier les lignes d'une autre date</button>
    </div>
    ${dropZone(`data-budget-drop='${JSON.stringify({show_id:s.id})}'`, 'Glisse ici une facture, un bulletin ou une note de frais (ou sur une ligne précise) : l’IA la lit, met la ligne à jour et la range dans le Drive de la date (02_Finance). La date de paiement se note à part : une pièce reçue n’est pas une dépense payée.')}
    ${artistBlock(s, b, p)}
    <p class="muted small mt-sm">Montants HT ; salaires en coût total. Ligne verte : payée ; jaune : pièce reçue, pas encore payée. Prévu en orange : montant tapé à la place du calcul automatique (Movinmotion, CNM) ; efface-le pour revenir au calcul.</p>
  </div>`;
}

/**
 * Date produite par L'ArtBo (contrat Production / Co-Production) dans le tableau de l'artiste : son budget est un PRÉVISIONNEL
 * à part (recettes, dépenses, répartition selon l'accord). Aucun « reste artiste » n'est calculé ici ; seuls les montants
 * réalisés s'affichent (dépenses payées, versements réellement faits à l'artiste). Hors compte dédié (accountOf), hors totaux.
 */
function ownProdRow(s, b, missing){
  const paidExp = r2(b.lines.filter(l => !isSolde(l) && (l.paid_at || l.reimbursed_at)).reduce((t, l) => t + lineValue(l), 0));
  const ar = artistResult(s, b), kind = s.contract_type === 'Co-Production' ? 'Coproduction' : 'Production';
  const dash = t => `<td class="num muted" title="${t}">—</td>`;
  return `<tr class="own-prod-row"><td class="nowrap"><a href="#" data-act="openProdShow" data-id="${s.id}">${fmtDate(s.date)}</a></td><td>${esc(s.venue||'')}${s.city?` <span class="muted">(${esc(s.city)})</span>`:''} <span class="badge" title="Budget de production à part (onglet Budget de la date) : prévisionnel, répartition selon l’accord">${kind}</span></td>
      ${dash('Pas de cession facturée par L’ArtBo à l’organisateur sur cette date')}${dash('Pas de commission calculée : répartition selon l’accord')}
      <td class="num nowrap" title="Dépenses réellement payées ; le prévisionnel est dans le budget de la date">${eur2(paidExp)} <span class="muted tiny">payées</span></td>
      ${dash('Pas de reste calculé : la part de l’artiste suit l’accord de production')}<td class="num">${ar.hasVerse ? eur2(ar.verse) : '<span class="muted">—</span>'}</td>
      ${dash('Pas d’écart calculé sans reste prévu')}<td class="${missing?'late-cell':''}">${b.lines.length ? `${b.docsIn}/${b.docsAll}${missing?' ⚠︎':''}` : '<span class="muted">—</span>'}</td></tr>`;
}

/** Vue d'ensemble d'un artiste : compte dédié + toutes ses dates en production + frais hors date */
export function projectBudgetHTML(projectId){
  const p = byId('projects', projectId); if (!p) return '';
  const shows = prodShowsOf(projectId); if (!shows.length) return '';
  const open = S.openBudget?.has(projectId);
  const a = accountOf(projectId);
  const head = `<button class="btn sm ${open?'':'primary'}" data-act="toggleProjBudget" data-id="${projectId}" aria-expanded="${!!open}">${open?'Masquer le budget':'Budget et compte'}</button>
    ${p.account_name ? `<span class="badge" title="Solde réel du compte : encaissé − payé">${esc(p.account_name)} : <b>${eur2(a.real)}</b></span>` : ''}`;
  if (!open) return `<div class="proj-budget-bar">${head}</div>`;
  const rows = shows.map(s => { const b = showBudget(s); const now = today();
    const missing = s.date && s.date < now && b.docsIn < b.docsAll;
    if (isProductionShow(s)) return ownProdRow(s, b, missing);
    return `<tr><td class="nowrap"><a href="#" data-act="openProdShow" data-id="${s.id}">${fmtDate(s.date)}</a></td><td>${esc(s.venue||'')}${s.city?` <span class="muted">(${esc(s.city)})</span>`:''}</td>
      <td class="num"${b.share ? ` title="MG ${eur2(b.fee)} + part du résultat ${eur2(b.share)}"` : ''}>${eur2(b.gross)}</td><td class="num">${eur2(b.com)}</td><td class="num">${eur2(b.expenses)}</td><td class="num"><b>${eur2(b.available)}</b></td><td class="num">${(r => r.hasVerse ? eur2(r.verse) : '<span class="muted">—</span>')(artistResult(s, b))}</td>
      ${b.lines.length ? `<td class="num nowrap">${ecartHTML(artistResult(s, b).ecart)}</td>
      <td class="${missing?'late-cell':''}">${b.docsIn}/${b.docsAll}${missing?' ⚠︎':''}</td>` : '<td class="num muted">—</td><td><span class="warn-badge">Budget à faire</span></td>'}</tr>`; }).join('');
  // dates produites par L'ArtBo (Production / Co-Production) : budget prévisionnel à part, hors totaux du cachet ; seul le versé réel compte
  const tot = shows.reduce((t,s) => { const b = showBudget(s), ar = artistResult(s, b); t.solde += ar.verse; if (isProductionShow(s)) { t.own++; return t; }
    t.fee += b.gross; ['com','expenses','available'].forEach(k => t[k] += b[k]); if (ar.ecart != null) t.result += ar.ecart; return t; }, {fee:0,com:0,expenses:0,available:0,solde:0,result:0,own:0});
  const off = offLinesOf(projectId);
  const cats = Object.entries(a.byCat).filter(([,v]) => Math.abs(v) >= 0.01).sort((x,y) => y[1]-x[1]);
  return `<div class="proj-budget panel">
    <div class="proj-budget-bar">${head}</div>
    ${!p.account_name ? `<p class="help mb">Pas de compte dédié pour cet artiste : les cessions arrivent sur un compte de L’ArtBoristerie, qui y garde sa commission. Aucun solde de compte artiste n’est calculé (lot D1).</p>` : `<div class="stat-row">
      <div class="stat"><b>${eur2(a.real)}</b><span>${esc(p.account_name)} : solde réel</span></div>
      <div class="stat"><b>${eur2(a.inTodo)}</b><span>Cachets encore à recevoir (HT)</span></div>
      <div class="stat"><b>${eur2(a.outTodo)}</b><span>Encore à payer par le compte</span></div>
      <div class="stat"><b>${eur2(a.end)}</b><span>Solde prévu en fin de tournée</span></div>
      ${a.artboAdvance ? `<div class="stat"><b style="color:var(--warn)">${eur2(a.artboAdvance)}</b><span>Avancé par L'ArtBo, pas encore remboursé par le compte</span></div>` : ''}
      ${a.unassignedDone || a.unassignedTodo ? `<div class="stat" title="Acomptes et soldes dont le compte d’encaissement (« Arrive sur ») n’est pas renseigné : comptés dans les dates et l’artiste, mais dans aucun compte tant qu’il n’est pas choisi (onglet Factures de la date)"><b>${eur2(a.unassignedDone)}</b><span>Compte non renseigné : encaissé${a.unassignedTodo ? ` · ${eur2(a.unassignedTodo)} à recevoir` : ''}</span></div>` : ''}
    </div>
    ${(() => { const mv = accountMoves(projectId); return mv.length ? `<details class="acc-moves"><summary>Détail des ${mv.length} mouvements du compte (à pointer avec le relevé de la banque)</summary>
      <div class="tbl-wrap"><table class="budget-table"><thead><tr><th>Date</th><th>Mouvement</th><th class="num">Entrée</th><th class="num">Sortie</th><th class="num">Solde</th></tr></thead><tbody>
      ${mv.map(m => `<tr><td class="nowrap">${fmtDate(m.date)}</td><td>${esc(m.label)}${m.calc ? ' <span class="muted" title="Pas de montant saisi : calculé à partir du pourcentage ou du prévu">(calculé)</span>' : ''}</td>
        <td class="num nowrap">${m.amount > 0 ? eur2(m.amount) : ''}</td><td class="num nowrap">${m.amount < 0 ? eur2(-m.amount) : ''}</td><td class="num nowrap">${eur2(m.balance)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small">Comptés : acomptes et soldes notés payés (encaissés sur le compte), commissions L’ArtBo virées, dépenses payées par le compte, avances remboursées par le compte. « (calculé) » : aucun montant saisi, c’est le pourcentage ou le prévu qui est utilisé.</p></details>` : ''; })()}`}
    <div class="steps" style="max-width:640px;margin-bottom:12px">
      <label>Nom du compte dédié</label>${cIn('projects', p.id, 'account_name', p.account_name, 'text', 'placeholder="ex. Compte The Locos L’ArtBo (vide = pas de compte dédié)"')}
      <label>Solde de départ du compte</label>${cIn('projects', p.id, 'account_opening', p.account_opening, 'number', 'class="narrow" placeholder="0"')}
      <label>Le solde artiste est versé à</label>${cIn('projects', p.id, 'artist_payee', p.artist_payee, 'text', 'placeholder="ex. Pipi"')}
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th class="num">Cachet HT</th><th class="num">Commission</th><th class="num">Dépenses</th><th class="num">Reste artiste</th><th class="num">Versé à l’artiste</th><th class="num" title="Reste calculé − versé : négatif = tu perds, positif = tu gagnes">Écart pour toi</th><th>Pièces</th></tr></thead>
      <tbody>${rows}<tr class="total-row"><td colspan="2"><b>Total (${shows.length} dates)</b>${tot.own ? `<div class="muted tiny">dont ${tot.own} en production / coproduction : hors totaux du cachet, de la commission, des dépenses et du reste (budget prévisionnel à part) ; seul le versé réel est compté</div>` : ''}</td><td class="num"><b>${eur2(tot.fee)}</b></td><td class="num"><b>${eur2(tot.com)}</b></td><td class="num"><b>${eur2(tot.expenses)}</b></td><td class="num"><b>${eur2(tot.available)}</b></td><td class="num"><b>${eur2(tot.solde)}</b></td><td class="num nowrap">${ecartHTML(r2(tot.result))}</td><td></td></tr></tbody></table></div>
    <p class="muted" style="font-size:13px;margin:6px 0 14px">Dépenses par catégorie : ${cats.map(([k,v]) => `${esc(k)} <b>${eur2(v)}</b>`).join(' · ') || '—'} · coût moyen par date : <b>${eur2(shows.length - tot.own ? (tot.com + tot.expenses) / (shows.length - tot.own) : 0)}</b></p>
    <h3 class="block-title">Frais hors date (affiches, avances…)</h3>
    <div class="tbl-wrap"><table class="budget-table">${HEAD}<tbody>${off.map(l => lineRow(l, p)).join('') || '<tr><td colspan="9" class="muted">Aucun frais hors date.</td></tr>'}</tbody></table></div>
    <div class="vh-actions mt"><button class="btn sm" data-act="addBudgetLine" data-project="${p.id}">Ajouter un frais hors date</button></div>
    ${dropZone(`data-budget-drop='${JSON.stringify({project_id:p.id})}'`, 'Glisse ici une pièce hors date : l’IA la lit et l’ajoute.')}
  </div>`;
}



// ─────────────── Taxe CNM (v1.51) et coréalisation ───────────────
const holderOpts = HOLDERS;
/** Taxe CNM de la date : base, taux (date ou Réglages), redevable légal, structure qui en supporte le coût */
function cnmBlock(s){
  const c = cnmOf(s), habit = cnmBearer({...s, cnm_bearer: null});
  return `<div class="steps prod-params cnm-block">
    <label>Taxe CNM</label><span>${c.abroad ? 'Date à l’étranger : pas de taxe CNM' : `${c.free ? 'Spectacle gratuit : sur le prix de cession HT' : 'Spectacle payant : sur la totalité des recettes de billetterie HT'}${c.real != null ? ` · <b>${eur2(c.real)}</b> (dépense CNM saisie)` : c.amount != null ? ` · <b>${eur2(c.amount)}</b>` : ' · <span class="muted">recettes de billetterie non saisies</span>'}`}</span>
    <label>Taux de la date (%)</label><span>${cIn('shows', s.id, 'cnm_pct', s.cnm_pct, 'number', `class="narrow" placeholder="${esc(String(cnmPct()))}" title="Vide : taux des Réglages"`)} <span class="muted">${s.cnm_pct == null || s.cnm_pct === '' ? 'taux des Réglages' : ''}</span></span>
    <label>Billetterie encaissée par</label>${cSel('shows', s.id, 'ticket_holder', s.ticket_holder, holderOpts)}
    ${c.free ? '' : `<label>Redevable légal</label><span>${c.debtor ? esc(holderLabel(c.debtor)) + ' (détenteur de la billetterie)' : '<span class="muted">le détenteur de la billetterie (à renseigner ci-dessus)</span>'}</span>`}
    <label>Coût supporté par</label><span>${cSel('shows', s.id, 'cnm_bearer', s.cnm_bearer, holderOpts)} <span class="muted">${s.cnm_bearer ? '' : habit ? 'usage habituel : ' + esc(holderLabel(habit)) : 'à attribuer selon le contrat'}</span></span>
    ${isCorea(s) ? `<label>Résultat partagé</label>${cChk('shows', s.id, 'cnm_in_result', s.cnm_in_result, 'CNM déduite du résultat net partagé (si le contrat le prévoit)')}` : ''}
  </div>`;
}

const cin = (s, path, v, extra = '') => `<input type="${/label/.test(path) ? 'text' : 'number'}" ${/label/.test(path) ? '' : 'step="any" inputmode="decimal"'} data-corea-show="${s.id}" data-corea-path="${path}" value="${esc(v ?? '')}" ${extra}>`;
/** Coréalisation : tarifs, break validé, recettes au-delà du break, charges déductibles, partage (MG + part du résultat) */
function coreaBlock(s){
  const c = coreaCalc(s), co = s.corea || {}, who = (at, by) => `${fmtDate(at)}${by ? ' par ' + esc(by) : ''}`;
  const tiers = c.tiers.map((t, i) => `<tr>
      <td>${cin(s, `tiers.${i}.label`, t.label, 'placeholder="Catégorie (ex. Plein tarif)"')}</td>
      <td class="num">${cin(s, `tiers.${i}.price`, co.tiers[i].price, 'class="narrow" title="Prix TTC"')}</td>
      <td class="num">${cin(s, `tiers.${i}.vat`, co.tiers[i].vat ?? 5.5, 'class="narrow" title="TVA (%)"')}</td>
      <td class="num">${cin(s, `tiers.${i}.qty`, co.tiers[i].qty, 'class="narrow" title="Billets vendus"')}</td>
      <td class="num nowrap">${eur2(t.ht)}</td>
      <td class="num">${cin(s, `tiers.${i}.after`, co.tiers[i].after, 'class="narrow" placeholder="—" title="Billets de ce tarif vendus après le break (si connu)"')}</td>
      <td><button class="btn icon sm ghost danger" data-act="coreaDelTier" data-id="${s.id}" data-i="${i}" aria-label="Retirer ce tarif">✕</button></td></tr>`).join('');
  const charges = (co.charges || []).map((x, i) => `<tr><td>${cin(s, `charges.${i}.label`, x.label, 'placeholder="Charge prévue au contrat (ex. SACEM, frais de billetterie)"')}</td>
      <td class="num">${cin(s, `charges.${i}.amount`, x.amount, 'class="narrow" title="Montant HT"')}</td>
      <td><button class="btn icon sm ghost danger" data-act="coreaDelCharge" data-id="${s.id}" data-i="${i}" aria-label="Retirer cette charge">✕</button></td></tr>`).join('');
  const brk = s.break_even == null || s.break_even === '' ? '<span class="muted">à renseigner</span>'
    : c.validated ? `<span class="ok-badge">validé</span> <span class="muted">le ${who(co.break_validated_at, co.break_by)}</span>`
    : `<button class="btn sm" data-act="coreaValidateBreak" data-id="${s.id}">Valider le break</button> <span class="muted">obligatoire avant tout calcul</span>`;
  const rev = !c.validated ? '<p class="muted">Partage non calculé : le break doit être validé.</p>'
    : c.exact != null ? `<p>Recettes HT des billets vendus après le break : <b>${eur2(c.exact)}</b> <span class="muted">(ventes après le break connues pour chaque tarif)</span></p>`
    : c.range ? `<p>Ventes après le break inconnues par tarif (${c.beyond} billets après le break) : recettes HT entre <b>${eur2(c.range.min)}</b> (billets les moins chers) et <b>${eur2(c.range.max)}</b> (les plus chers) ; au prorata des ventes de chaque tarif : <b>${eur2(c.range.prorata)}</b>.</p>
      ${c.method === 'prorata' ? `<p>Méthode retenue pour cette date : prorata des ventes <span class="muted">(validée le ${who(co.method.at, co.method.by)})</span> <button class="btn sm ghost" data-act="coreaClearMethod" data-id="${s.id}">Annuler</button></p>`
        : `<p><button class="btn sm" data-act="coreaValidateProrata" data-id="${s.id}">Valider le prorata pour cette date</button> <span class="muted">ou saisis les ventes après le break de chaque tarif</span></p>`}`
    : '<p class="muted">Saisis les tarifs et les billets vendus.</p>';
  const line = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num nowrap">${v == null ? '—' : eur2(v)}</td></tr>`;
  return `<div class="corea-block">
    <h4 class="block-title">Coréalisation : partage au-delà du break</h4>
    <div class="steps prod-params">
      <label>Minimum garanti (cachet HT)</label><span><b>${eur2(c.mg)}</b> <span class="muted">acquis, fixe</span></span>
      <label>Break (billets)</label><span>${cIn('shows', s.id, 'break_even', s.break_even, 'number', 'class="narrow"')} ${brk}</span>
      ${s.cr_break ? `<label>Break du contrat</label><span class="muted">« ${esc(s.cr_break)} » (texte conservé tel quel)</span>` : ''}
      <label>% du résultat net au producteur</label>${cIn('shows', s.id, 'cr_producer_pct', s.cr_producer_pct, 'number', 'class="narrow"')}
    </div>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th>Catégorie tarifaire</th><th class="num">Prix TTC</th><th class="num">TVA %</th><th class="num">Vendus</th><th class="num">Recettes HT</th><th class="num">Vendus après le break</th><th></th></tr></thead>
      <tbody>${tiers}</tbody>
      <tfoot><tr class="bill-total"><td><b>Total</b></td><td colspan="2"></td><td class="num"><b>${c.sold}</b></td><td class="num nowrap"><b>${eur2(c.ht)}</b></td><td class="num">${c.beyond == null ? '—' : c.beyond + ' attendus'}</td><td></td></tr></tfoot></table></div>
    <div class="vh-actions mt-sm"><button class="btn sm" data-act="coreaAddTier" data-id="${s.id}">Ajouter un tarif</button></div>
    ${rev}
    <h4 class="block-title">Charges déductibles (contrat)</h4>
    <div class="tbl-wrap"><table class="budget-table"><tbody>${charges}
      ${s.cnm_in_result ? `<tr><td>Taxe CNM (sur la totalité des recettes HT)</td><td class="num nowrap">${eur2(c.cnm)}</td><td></td></tr>` : ''}</tbody></table></div>
    <div class="vh-actions mt-sm"><button class="btn sm" data-act="coreaAddCharge" data-id="${s.id}">Ajouter une charge</button></div>
    ${c.issues.length ? `<ul class="warn-txt warn-list">${c.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="tbl-wrap"><table class="budget-table prod-table"><tbody>
      ${line('Recettes HT concernées (après le break)', c.revenue)}
      ${line('Charges déductibles', c.revenue == null ? null : -c.deducted)}
      ${line('<b>Résultat net à partager</b>', c.net, 'bill-total')}
      ${line(`Part du producteur (${c.pct == null ? '% à renseigner' : esc(fmtPct(c.pct))})`, c.share)}
      ${line(`Part de la structure (${c.pct == null ? '—' : esc(fmtPct(100 - c.pct))})`, c.partnerShare)}
      ${line('<b>Rémunération brute de l’artiste : MG + part</b>', c.total, 'bill-total')}
      ${line(`Commission L’ArtBo (${esc(fmtPct(c.comPct))}, sur MG + part)`, c.total == null ? null : -c.com)}
      ${line('<b>Rémunération nette de l’artiste</b>', c.total == null ? null : r2(c.total - c.com), 'bill-total')}
    </tbody></table></div>
    <p class="muted small">Part validée (base de la commission) : ${c.validatedShare == null ? '<b>pas encore validée</b> : la commission ne porte pour l’instant que sur le MG' : `<b>${eur2(c.validatedShare)}</b>${c.share == null ? ' <span class="warn-txt">la part n’est plus calculable (break, méthode ou ventes à revoir) : elle reste dans la base de la commission tant qu’une nouvelle part n’est pas validée</span>' : Math.abs(c.share - c.validatedShare) >= 0.005 ? ' <span class="warn-txt">différente de la part calculée : à valider de nouveau</span>' : ''}`}. La commission n’est jamais une charge du résultat partagé.</p>
    ${(q => !q?.frozen ? '' : `<p class="small ${Math.abs(q.gap) >= 0.005 ? 'warn-txt' : 'muted'}">Commission retenue : ${eur2(q.held)}${q.booking ? ` · facturée : ${q.invoiced ? 'oui' : 'non'}` : ''} · encaissée : ${eur2(q.cashed)}. Commission due sur MG + part validée : ${eur2(q.due)}.${Math.abs(q.gap) >= 0.005 ? ` <b>Régularisation à prévoir : ${q.gap > 0 ? '+' : ''}${eur2(q.gap)}</b> (rien n’est fait automatiquement ; le montant historique reste).` : ''}</p>`)(coreaCommissionCheck(s))}
    ${c.share != null && (c.validatedShare == null || Math.abs(c.share - c.validatedShare) >= 0.005) ? `<div class="vh-actions mt-sm"><button class="btn sm" data-act="coreaValidateShare" data-id="${s.id}">Valider la part du résultat (${eur2(c.share)})</button> <span class="muted">elle entre alors dans la base de la commission</span></div>` : ''}
    ${c.validatedShare ? `<div class="vh-actions mt-sm"><button class="btn sm" data-act="coreaPrepareInvoice" data-id="${s.id}">Préparer la ligne de facture « Part du résultat »</button> <span class="muted">action volontaire, rien n’est envoyé</span></div>` : ''}
    <p class="muted small mt-sm">Le minimum garanti reste facturé par l’acompte et le solde ; seule la part du résultat s’y ajoute (jamais deux fois). Résultat négatif ou nul : pas de part, le MG reste acquis.</p>
  </div>`;
}

/** Coproduction : structure qui encaisse, positions réelles, reversement, clôture du résultat (verrouillée, réouverture tracée) */
/** Lignes de Factures d'une coproduction : qualification explicite, encaisseur, encaissement (décision du 28/10/2026) */
function coprodReceiptsTable(s, closed){
  const ls = coprodLines(s); if (!ls.length) return '';
  const role = p => closed ? esc((COPROD_ROLES.find(c => c[0] === p.coprod_role) || [, 'non qualifiée'])[1]) : cSel('show_payments', p.id, 'coprod_role', p.coprod_role, COPROD_ROLES);
  const who = p => p.coprod_role !== 'recette' ? '' : closed ? esc(p.coprod_holder === 'artbo' ? 'L’ArtBoristerie' : p.coprod_holder === 'partenaire' ? 'Le coproducteur' : '—')
    : cSel('show_payments', p.id, 'coprod_holder', p.coprod_holder, [['artbo', 'L’ArtBoristerie'], ['partenaire', 'Le coproducteur']]);
  return `<h5 class="block-title">Lignes de Factures de la date</h5>
    <div class="tbl-wrap"><table class="budget-table"><thead><tr><th>Ligne</th><th class="num">Montant HT</th><th>Qualification</th><th>Encaissée par</th><th>Encaissée le</th></tr></thead><tbody>
    ${ls.map(p => `<tr><td>${esc(p.label || p.kind)}</td><td class="num nowrap">${eur2(payAmount(p) || 0)}</td><td>${role(p)}</td><td>${who(p)}</td><td>${p.coprod_role !== 'recette' ? '' : p.paid_at ? fmtDate(p.paid_at) : '<span class="warn-txt">pas encore encaissée</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">Une recette complémentaire entre une seule fois dans le résultat ; « déjà comptabilisée ailleurs » et « hors calcul » n’y entrent pas. La date d’encaissement se note dans l’onglet Factures (« Payée »).</p>`;
}

function coprodBlock(s){
  const k = coprodClose(s), x = s.result_closed || k.snapshot, closed = !!s.result_closed_at;
  const side = w => w === 'artbo' ? 'L’ArtBoristerie' : esc(x.partner || 'le coproducteur');
  const row = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="num nowrap">${eur2(v)}</td></tr>`;
  return `<div class="coprod-block">
    <h4 class="block-title">Clôture du résultat ${closed ? '<span class="ok-badge">clôturé</span>' : ''}</h4>
    <div class="steps prod-params">
      <label>Recettes encaissées par</label>${closed ? `<span>${esc(holderLabel(s.ticket_holder))}</span>` : cSel('shows', s.id, 'ticket_holder', s.ticket_holder, holderOpts.filter(h => h[0] !== 'organisateur'))}
    </div>
    ${coprodReceiptsTable(s, closed)}
    <div class="steps prod-params"><label>Recettes de billetterie encaissées le</label>${closed ? `<span>${x.receipts_cashed_at ? fmtDate(x.receipts_cashed_at) : '—'}</span>` : `<input type="date" data-prod-show="${s.id}" data-prod-path="receipts_cashed_at" value="${esc(k.r.p.receipts_cashed_at || '')}">`}</div>
    ${!k.r.promo && !x.promo ? '<p class="muted small">Aucune promotion locale.</p>' : ''}
    ${x.promo_advance ? `<p class="muted small">Dont avance de promotion locale : ${eur2(x.promo_advance)} payés par ${x.promo_payer === 'artbo' ? 'L’ArtBo' : 'le coproducteur'} pour le compte de ${x.promo_debtor === 'artbo' ? 'L’ArtBo' : 'le coproducteur'} (comptée une seule fois).</p>` : ''}
    ${k.r.promo || x.promo ? `<div class="steps prod-params">
      <label>Promotion locale (${eur2(x.promo)}) : à la charge de</label>${closed ? `<span>${esc((PROMO_DEBTORS.find(d => d[0] === x.promo_debtor) || [, '—'])[1])}</span>` : prodSel(s, 'promo_debtor', k.r.p.promo_debtor, PROMO_DEBTORS)}
      <label>Payée par</label>${closed ? `<span>${esc((PROMO_PAYERS.find(d => d[0] === x.promo_payer) || [, '—'])[1])}</span>` : prodSel(s, 'promo_payer', k.r.p.promo_payer, PROMO_PAYERS)}
      <label>Payée le</label>${closed ? `<span>${x.promo_paid_at ? fmtDate(x.promo_paid_at) : '—'}</span>` : `<input type="date" data-prod-show="${s.id}" data-prod-path="promo_paid_at" value="${esc(k.r.p.promo_paid_at || '')}">`}
    </div>` : ''}
    ${closed ? `<p>Clôturé le ${fmtDate(s.result_closed_at)}${s.result_closed_by ? ' par ' + esc(s.result_closed_by) : ''} : montants verrouillés.</p>` : ''}
    ${!closed && k.issues.length ? `<ul class="warn-txt warn-list">${k.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    ${k.warnings.length && !closed ? `<p class="muted">${k.warnings.map(esc).join(' · ')}</p>` : ''}
    <div class="tbl-wrap"><table class="budget-table prod-table"><tbody>
      ${row('<b>Résultat global réel (DL inclus)</b>', x.result, 'bill-total')}
      ${x.shared_result != null && Math.abs(x.shared_result - x.result) >= 0.005 ? row(`Résultat partagé (promotion locale à la charge ${x.promo_debtor === 'artbo' ? 'de L’ArtBo' : 'du coproducteur'}, retirée de sa part)`, x.shared_result) : ''}
      ${row(`Part de L’ArtBo (${esc(fmtPct(x.artbo_share ?? 0))})`, x.artbo_part)}
      ${row(`Part de ${esc(x.partner || 'coproducteur')} (${esc(fmtPct(100 - (x.artbo_share ?? 0)))})`, x.partner_part)}
      ${row('Recette nette gardée par la structure qui encaisse', x.net_encaisse)}
      ${x.extra_receipts ? row('Recettes complémentaires encaissées par L’ArtBo', x.cashed_artbo) + row('Recettes complémentaires encaissées par le coproducteur', x.cashed_partner) : ''}
      ${row('Dépenses payées par L’ArtBo (promotion locale comprise si elle l’a payée)', -x.paid_artbo)}
      ${row('Dépenses payées par le coproducteur', -x.paid_partner)}
      <tr class="bill-total"><td><b>Reversement</b></td><td class="num nowrap">${x.from ? `<b>${eur2(x.transfer)}</b>` : 'aucun'}</td></tr>
    </tbody></table></div>
    ${x.from ? `<p>${side(x.from)} reverse <b>${eur2(x.transfer)}</b> à ${side(x.to)}${x.to ? ` ; ${side(x.to)} facture ${side(x.from)} (facture à préparer à la main)` : ''}.</p>` : ''}
    ${closed ? `<div class="steps prod-params"><label>Reversement payé le</label>${cIn('shows', s.id, 'reversement_paid_at', s.reversement_paid_at, 'date')} <span class="muted">${s.reversement_paid_at ? '' : 'pas encore payé'}</span></div>` : ''}
    <div class="vh-actions mt-sm">${closed ? `<button class="btn sm" data-act="reopenResult" data-id="${s.id}">Rouvrir le résultat</button>`
      : `<button class="btn sm primary" data-act="closeResult" data-id="${s.id}" ${k.ok ? '' : 'disabled title="Corrige d’abord les points ci-dessus"'}>Clôturer le résultat</button>`}</div>
    <p class="muted small mt-sm">Aucune facture ni aucun paiement n’est fait automatiquement ; pas de devis Pennylane pour une coproduction.</p>
  </div>`;
}

// ─────────────── Budget de production (contrat Production / Co-Production) ───────────────

const prodSel = (s, path, v, opts) => `<select data-prod-show="${s.id}" data-prod-path="${path}"><option value="">—</option>${opts.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const pin = (s, path, v, extra = '') => `<input type="${/label/.test(path) ? 'text' : 'number'}" ${/label/.test(path) ? '' : 'step="any" inputmode="decimal"'} data-prod-show="${s.id}" data-prod-path="${path}" value="${esc(v ?? '')}" ${extra}>`;
const pct = v => v == null ? '—' : fmtPct(Math.round(v * 1000) / 10);   // taux 0–1 affiché « 87,5 % » (format officiel §2.4)
const two = (f, r, cls = '') => `<td class="num nowrap ${cls}">${eur2(f)}</td><td class="num nowrap ${cls}">${r == null ? '—' : eur2(r)}</td>`;

/** Budget d'une date produite par L'ArtBo : billetterie, droits et taxes, coûts, résultat partagé avec le coproducteur */
export function productionBudgetHTML(s){
  const proj = byId('projects', s.project_id), f = productionBudget(s), r = productionBudget(s, true), p = f.p;
  const hasReal = p.tickets.some(t => t.real_qty != null && t.real_qty !== '');
  const R = v => hasReal ? v : null;
  const lines = linesOf(s.id);
  const cats = [...PROD_CATS, ...new Set(lines.map(l => l.category).filter(c => c && !PROD_CATS.includes(c)))];
  const tickets = p.tickets.map((t, i) => `<tr>
      <td>${pin(s, `tickets.${i}.label`, t.label, 'placeholder="Tarif (ex. Prévente)"')}</td>
      <td class="num">${pin(s, `tickets.${i}.qty`, t.qty, 'class="narrow"')}</td>
      <td class="num">${pin(s, `tickets.${i}.price`, t.price, 'class="narrow" title="Prix TTC"')}</td>
      <td class="num">${pin(s, `tickets.${i}.dl_prod`, t.dl_prod, 'class="narrow" title="Droit de location producteur (par billet)"')}</td>
      <td class="num">${pin(s, `tickets.${i}.dl_net`, t.dl_net, 'class="narrow" title="Droit de location réseau (par billet)"')}</td>
      <td class="num nowrap">${eur2((Number(t.price) || 0) + (Number(t.dl_prod) || 0) + (Number(t.dl_net) || 0))}</td>
      <td class="num nowrap">${eur2(f.tickets[i].gross)}</td>
      <td class="num">${pin(s, `tickets.${i}.real_qty`, t.real_qty, 'class="narrow" placeholder="—" title="Billets vendus (réel)"')}</td>
      <td class="num nowrap">${t.real_qty == null || t.real_qty === '' ? '—' : eur2(r.tickets[i].gross)}</td>
      <td><button class="btn icon sm ghost danger" data-act="prodDelTicket" data-id="${s.id}" data-i="${i}" aria-label="Retirer ce tarif">✕</button></td></tr>`).join('');
  const taxRow = (label, key, fv, rv, help) => `<tr><td>${label}</td><td class="num">${key ? pin(s, key, p[key], `class="narrow" title="${help || '%'}"`) + ' %' : ''}</td>${two(fv, R(rv))}</tr>`;
  const locked = !!s.result_closed_at;   // résultat clôturé (coproduction) : saisies désactivées, la base refuse aussi (v1.51)
  return `<div class="prod-budget prod-production">
    <h3 class="block-title">Budget de production <span class="badge tag">${esc(s.contract_type)}</span>${locked ? ' <span class="ok-badge">résultat clôturé</span>' : ''}</h3>
    <fieldset class="lock-set" ${locked ? 'disabled' : ''}>
    <div class="stat-row budget-stats">
      <div class="stat"><b>${eur2(f.ht)}</b><span>Recette billetterie HT (prévu)${hasReal ? ` · réel ${eur2(r.ht)}` : ''}</span></div>
      <div class="stat"><b>${eur2(f.taxes)}</b><span>Droits et taxes</span></div>
      <div class="stat"><b>${eur2(f.costs + f.promo)}</b><span>Coûts${f.promo ? ' + promo locale' : ''}</span></div>
      <div class="stat"><b style="${f.resultDl < 0 ? 'color:var(--danger)' : ''}">${eur2(f.resultDl)}</b><span>Résultat DL inclus (prévu)${hasReal || lines.some(l => l.amount != null) ? ` · réel ${eur2(r.resultDl)}` : ''}</span></div>
      <div class="stat"><b>${pct(f.fill)}</b><span>Remplissage (${f.total} / ${f.capacity || '?'} places)</span></div>
    </div>

    <div class="steps prod-params">
      <label>Jauge (fiche de la date)</label>${cIn('shows', s.id, 'capacity', s.capacity, 'number', 'class="narrow"')}
      <label>Représentations</label>${pin(s, 'reps', p.reps, 'class="narrow"')}
      <label>TVA billetterie (%)</label>${pin(s, 'vat', p.vat, 'class="narrow"')}
      ${s.contract_type === 'Co-Production' || s.partner_id ? `<label>Part de L’ArtBo (%)</label><span>${pin(s, 'artbo_share', p.artbo_share, 'class="narrow"')} <span class="muted">· ${esc(f.partnerName)} : ${esc(fmtPct(100 - (Number(p.artbo_share) || 0)))}</span></span>` : ''}
    </div>

    <h4 class="block-title">Recettes : billetterie</h4>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th>Tarif</th><th class="num">Billets prévus</th><th class="num">Prix TTC</th><th class="num">DL prod</th><th class="num">DL réseau</th><th class="num">Prix public</th><th class="num">Total prévu TTC</th><th class="num">Billets vendus</th><th class="num">Total réel TTC</th><th></th></tr></thead>
      <tbody>${tickets}
        <tr><td>Invitations</td><td class="num">${pin(s, 'invitations', p.invitations, 'class="narrow"')}</td><td colspan="5"></td><td class="num">${pin(s, 'real_invitations', p.real_invitations, 'class="narrow" placeholder="—"')}</td><td colspan="2"></td></tr></tbody>
      <tfoot><tr class="bill-total"><td><b>Total</b></td><td class="num"><b>${f.paying}</b> payants</td><td colspan="4" class="muted">prix moyen ${eur2(f.avgPrice)}</td><td class="num nowrap"><b>${eur2(f.grossTtc)}</b></td><td class="num">${hasReal ? `<b>${r.paying}</b>` : '—'}</td><td class="num nowrap">${hasReal ? `<b>${eur2(r.grossTtc)}</b>` : '—'}</td><td></td></tr></tfoot></table></div>
    <div class="vh-actions mt-sm mb"><button class="btn sm" data-act="prodAddTicket" data-id="${s.id}">Ajouter un tarif</button></div>

    <h4 class="block-title">Droits et taxes</h4>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th></th><th class="num">Taux</th><th class="num">Prévu</th><th class="num">Réel</th></tr></thead><tbody>
      <tr><td>Recette TTC</td><td></td>${two(f.grossTtc, R(r.grossTtc))}</tr>
      <tr><td>TVA</td><td class="num">${esc(fmtPct(p.vat))}</td>${two(f.vatAmount, R(r.vatAmount))}</tr>
      <tr><td><b>Recette HT</b></td><td></td>${two(f.ht, R(r.ht), 'strong')}</tr>
      <tr><td>Taxe CNM <span class="muted">(totalité de la recette HT)</span>${r.cnmReal != null ? ' <span class="muted">· réel : dépense CNM saisie</span>' : ''}</td><td class="num">${cIn('shows', s.id, 'cnm_pct', s.cnm_pct, 'number', `class="narrow" placeholder="${esc(String(f.cnmRate))}" title="Taux de la date ; vide : ${esc(fmtPct(cnmPct()))} (Réglages)"`)} %</td>${two(f.cnm, R(r.cnm))}</tr>
      ${taxRow('SACEM + AGESSA' + (r.sacemReal != null ? ' <span class="muted">· réel : dépense SACEM saisie</span>' : ''), 'sacem_pct', f.sacem, r.sacem, '% de la recette HT ; AGESSA ' + p.agessa_pct + ' % des droits')}
      ${taxRow('SACD + CR + AGESSA', 'sacd_pct', f.sacd, r.sacd, '% de la recette HT (0 si pas de SACD)')}
      ${taxRow('SACD mise en scène', 'sacd_ms_pct', f.sacdMs, r.sacdMs, '% de la recette HT (0 si pas de mise en scène)')}
      <tr><td>AGESSA (sur les droits)</td><td class="num">${pin(s, 'agessa_pct', p.agessa_pct, 'class="narrow"')} %</td><td colspan="2" class="muted">compris dans les lignes SACEM / SACD</td></tr>
      <tr class="bill-total"><td><b>Recette nette de droits et taxes</b></td><td class="muted">${eur2(f.netPerTicket)} / billet</td>${two(f.net, R(r.net), 'strong')}</tr>
      <tr><td>Droits de location producteur (HT)</td><td></td>${two(f.dlHt, R(r.dlHt))}</tr>
    </tbody></table></div>

    </fieldset>
    <h4 class="block-title">Coûts de production</h4>${locked ? '<p class="muted small">Résultat clôturé : les montants sont verrouillés (la base les refuse) ; les dates de paiement restent modifiables.</p>' : ''}
    <div class="tbl-wrap"><table class="budget-table">${HEAD}<tbody>${cats.map(c => { const ls = lines.filter(l => (l.category || 'Autres') === c); return ls.length ? `<tr class="cat-row"><td colspan="9"><b>${esc(c)}</b> <span class="muted">· prévu ${eur2(f.byCat[c] || 0)} · réel ${eur2(r.byCat[c] || 0)}</span></td></tr>` + ls.map(l => lineRow(l, proj, {qtyAll: true})).join('') : ''; }).join('')}</tbody></table></div>
    <div class="vh-actions mt" ${locked ? 'hidden' : ''}>
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Salle">Ajouter une ligne salle</button>
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Promoteur">Ajouter une ligne promoteur</button>
      ${lines.length ? '' : `<button class="btn sm primary" data-act="prefillProduction" data-id="${s.id}">Préremplir (modèle du budget de production)</button>`}
      <button class="btn sm ghost" data-act="copyBudget" data-id="${s.id}">Copier les lignes d'une autre date</button>
    </div>
    ${dropZone(`data-budget-drop='${JSON.stringify({show_id:s.id})}'`, 'Glisse ici une facture ou un devis (ou sur une ligne précise) : l’IA la lit, met la ligne à jour et la range dans le Drive de la date (02_Finance).')}

    <fieldset class="lock-set" ${locked ? 'disabled' : ''}>
    <h4 class="block-title">Résultat</h4>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th></th><th class="num">Taux</th><th class="num">Prévu</th><th class="num">Réel</th></tr></thead><tbody>
      <tr><td>Recette nette de droits et taxes</td><td></td>${two(f.net, R(r.net))}</tr>
      <tr><td>Coûts de production HT</td><td></td>${two(-f.costs, -r.costs)}</tr>
      <tr><td>Promo locale (sur la recette nette)</td><td class="num">${pin(s, 'promo_net_pct', p.promo_net_pct, 'class="narrow"')} %</td><td colspan="2"></td></tr>
      <tr><td>Promo locale (sur les DL)</td><td class="num">${pin(s, 'promo_dl_pct', p.promo_dl_pct, 'class="narrow"')} %</td>${two(-f.promo, R(-r.promo))}</tr>
      ${f.extra ? `<tr><td>Recettes complémentaires de coproduction (lignes de Factures qualifiées)</td><td></td>${two(f.extra, R(r.extra))}</tr>` : ''}
      <tr><td><b>Résultat hors DL</b></td><td></td>${two(f.result, R(r.result), 'strong')}</tr>
      <tr class="bill-total"><td><b>Résultat DL inclus</b></td><td></td>${two(f.resultDl, R(r.resultDl), 'strong')}</tr>
      ${f.share < 1 ? `<tr><td>Part L’ArtBo (${esc(fmtPct(p.artbo_share))})</td><td></td>${two(f.artbo, R(r.artbo))}</tr>
      <tr><td>Part ${esc(f.partnerName)} (${esc(fmtPct(100 - p.artbo_share))})</td><td></td>${two(f.partner, R(r.partner))}</tr>` : ''}
    </tbody></table></div>
    </fieldset>
    ${s.contract_type === 'Co-Production' ? coprodBlock(s) : ''}
    <p class="muted small mt-sm">Montants HT sauf la billetterie (TTC). Le réel se remplit avec les billets vendus et les montants réels des pièces ; tant qu’aucun billet vendu n’est saisi, les recettes réelles restent vides. Une date produite par L’ArtBo n’entre pas dans le compte dédié de l’artiste.</p>
  </div>`;
}
