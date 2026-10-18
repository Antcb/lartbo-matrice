/**
 * Budget dans l'onglet Production : le budget de chaque date (prévu / réel, pièces, qui paie)
 * et la vue d'ensemble d'un artiste (compte dédié, toutes les dates, frais hors date).
 */
import { accountOf, commissionAmount, commissionOf, isFree, lineForecast, lineStatus, linesOf, offLinesOf, payerLabel, payslipCost, prodShowsOf, showBudget } from '../budget.js';
import { BUDGET_CATS, PAYERS } from '../constants.js';
import { byId } from '../selectors.js';
import { S } from '../state.js';
import { cIn, cSel } from '../ui/cells.js';
import { esc, eur2, fmtDate } from '../utils.js';
import { PROD_CATS, productionBudget } from '../production-budget.js';

const STATUS = {paid:['Payé','ok-badge'], doc:['Pièce reçue','warn-badge'], planned:['Prévu','badge']};
const badge = l => { const [t,c] = STATUS[lineStatus(l)]; return `<span class="${c}">${t}</span>`; };
const money = (v, cls='') => `<span class="num nowrap ${cls}">${eur2(v)}</span>`;

function lineRow(l, project, {qtyAll = false} = {}){
  const fc = lineForecast(l), staff = l.category === 'Staff' || (qtyAll && !l.auto), auto = !!l.auto;
  const payers = PAYERS.map(c => [c, payerLabel(c, project)]);
  return `<tr data-budget-line="${l.id}" class="${lineStatus(l)==='paid'?'is-paid':''}">
    <td>${cSel('budget_lines', l.id, 'category', l.category, BUDGET_CATS)}</td>
    <td>${cIn('budget_lines', l.id, 'label', l.label, 'text', 'placeholder="Libellé"')}${auto?`<div class="muted" style="font-size:11px">${l.auto==='movinmotion'?'Calcul : bulletins × coût Movinmotion':l.auto==='cnm'?'Calcul : % du cachet si entrée gratuite':'Calcul : ce qui reste du cachet'}</div>`:''}</td>
    <td>${cIn('budget_lines', l.id, 'supplier', l.supplier, 'text', `placeholder="${staff?'Salarié':'Fournisseur / bénéficiaire'}"`)}</td>
    <td>${cSel('budget_lines', l.id, 'payer', l.payer || 'compte', payers, false)}</td>
    <td class="num">${staff ? `<span class="nowrap">${cIn('budget_lines', l.id, 'qty', l.qty, 'number', `class="narrow" title="${qtyAll ? 'Quantité' : 'Nombre de bulletins'}" placeholder="${qtyAll ? 'qté' : 'nb'}"`)} × ${cIn('budget_lines', l.id, 'unit_cost', l.unit_cost, 'number', `class="narrow" title="${qtyAll ? 'Prix unitaire HT' : 'Coût employeur d’un bulletin'}" placeholder="${qtyAll ? 'P.U.' : 'coût'}"`)}</span>` : ''}
      <input type="number" step="any" data-t="budget_lines" data-id="${l.id}" data-f="forecast" value="${l.forecast??''}" placeholder="${fc==null?'à saisir':fc}" class="${l.forecast!=null?'override':''}" title="${auto||staff?'Vide = calcul automatique':'Montant prévu HT'}"></td>
    <td class="num"><input type="number" step="any" data-t="budget_lines" data-id="${l.id}" data-f="amount" value="${l.amount??''}" placeholder="—" title="${staff?'Coût total (bulletin)':'Montant réel HT (pièce)'}"></td>
    <td class="nowrap">${l.file_path ? `<button class="btn icon sm" data-act="openBudgetFile" data-id="${l.id}" title="${esc(l.file_name||'Pièce')}" aria-label="Ouvrir la pièce">📎</button>` : ''}${l.drive_file_id ? `<a class="btn icon sm" href="https://drive.google.com/file/d/${esc(l.drive_file_id)}/view" target="_blank" rel="noopener" title="Rangée dans le Drive de la date" aria-label="Ouvrir dans le Drive">▲</a>` : ''}${cIn('budget_lines', l.id, 'doc_number', l.doc_number, 'text', 'placeholder="N° pièce" style="min-width:80px"')}</td>
    <td class="${l.paid_at?'done-cell':''}">${cIn('budget_lines', l.id, 'paid_at', l.paid_at, 'date')}${(l.payer || 'compte') !== 'compte' && l.paid_at ? `<div class="reimb ${l.reimbursed_at?'done-cell':''}" title="Déduit de ${esc(payerLabel('compte', project))}"><span class="muted">Déduit du compte le</span>${cIn('budget_lines', l.id, 'reimbursed_at', l.reimbursed_at, 'date')}</div>` : ''}</td>
    <td>${badge(l)}</td>
    <td><button class="btn icon sm ghost danger" data-act="delBudgetLine" data-id="${l.id}" aria-label="Supprimer la ligne">✕</button></td>
  </tr>`;
}

const HEAD = '<thead><tr><th>Catégorie</th><th>Libellé</th><th>Fournisseur / bénéficiaire</th><th>Payé par</th><th class="num">Prévu HT</th><th class="num">Réel HT</th><th>Pièce</th><th>Payé le</th><th>État</th><th></th></tr></thead>';

function dropZone(attrs, text){
  return `<div class="dropzone budget-drop" ${attrs}>
    <label class="btn sm file-btn">Ajouter une pièce<input class="file-input" type="file" multiple accept="application/pdf,image/*" ${attrs.replace('data-budget-drop','data-budget-pick')}></label>
    <span class="drop-hint">${text}</span></div>`;
}

/** Budget d'une date (dans la date dépliée) */
export function showBudgetHTML(s){
  const p = byId('projects', s.project_id), b = showBudget(s), com = commissionOf(s);
  const comRow = `<tr class="${com?.paid_at?'is-paid':''}"><td><b>Commission</b></td><td>Commission L'ArtBo (${esc(String(com?.pct ?? s.artbo_pct ?? 15))} %)</td><td>L'ArtBoristerie</td><td>${esc(payerLabel('compte', p))}</td>
    <td class="num">${money(commissionAmount(s))}</td><td class="num">—</td><td>${esc(com?.invoice_number||'')}</td>
    <td class="${com?.paid_at?'done-cell':''}">${com ? cIn('show_payments', com.id, 'paid_at', com.paid_at, 'date', 'title="Commission virée à L’ArtBo le"') : '<span class="muted">—</span>'}</td>
    <td>${com?.paid_at ? '<span class="ok-badge">Payée</span>' : '<span class="warn-badge">À virer</span>'}</td><td></td></tr>`;
  return `<div class="prod-budget">
    <h3 class="block-title">Budget de la date</h3>
    <div class="stat-row budget-stats">
      <div class="stat"><b>${eur2(b.fee)}</b><span>Cachet HT${isFree(s)?' · entrée gratuite':''}</span></div>
      <div class="stat"><b>${eur2(b.com + b.expenses)}</b><span>Commission + dépenses</span></div>
      <div class="stat"><b>${eur2(b.available)}</b><span>Reste pour l'artiste</span></div>
      <div class="stat"><b>${eur2(b.solde)}</b><span>Solde artiste${p?.artist_payee ? ' ('+esc(p.artist_payee)+')' : ''}</span></div>
      <div class="stat"><b style="${Math.abs(b.result)>=1?'color:var(--warn)':''}">${eur2(b.result)}</b><span>Écart (doit tomber à 0)</span></div>
      <div class="stat"><b>${b.docsIn}/${b.docsAll}</b><span>Pièces reçues · ${b.paid} payées</span></div>
    </div>
    <div class="tbl-wrap"><table class="budget-table">${HEAD}<tbody>${comRow}${b.lines.map(l => lineRow(l, p)).join('')}</tbody></table></div>
    <div class="vh-actions" style="margin-top:10px">
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}">Ajouter une dépense</button>
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Staff">Ajouter un salarié</button>
      ${b.lines.length ? '' : `<button class="btn sm primary" data-act="prefillBudget" data-id="${s.id}">Préremplir le budget</button>`}
      <button class="btn sm ghost" data-act="copyBudget" data-id="${s.id}">Copier les lignes d'une autre date</button>
    </div>
    ${dropZone(`data-budget-drop='${JSON.stringify({show_id:s.id})}'`, 'Glisse ici une facture, un bulletin ou une note de frais (ou sur une ligne précise) : l’IA la lit, met la ligne à jour, la marque payée et la range dans le Drive de la date (02_Finance).')}
    <p class="muted" style="font-size:12px;margin:8px 0 0">Montants HT ; salaires : coût total. Le prévu vide se calcule seul (bulletins × coût, Movinmotion ${eur2(payslipCost())} par bulletin, CNM si gratuit, solde artiste = reste du cachet). Une ligne compte dans le solde du compte quand « Payé par » est le compte dédié, ou quand une avance (L’ArtBo, une personne) est remboursée par le compte.</p>
  </div>`;
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
  const rows = shows.map(s => { const b = showBudget(s); const today = new Date().toISOString().slice(0,10);
    const missing = s.date && s.date < today && b.docsIn < b.docsAll;
    return `<tr><td class="nowrap"><a href="#" data-act="openProdShow" data-id="${s.id}">${fmtDate(s.date)}</a></td><td>${esc(s.venue||'')}${s.city?` <span class="muted">(${esc(s.city)})</span>`:''}</td>
      <td class="num">${eur2(b.fee)}</td><td class="num">${eur2(b.com)}</td><td class="num">${eur2(b.expenses)}</td><td class="num"><b>${eur2(b.available)}</b></td><td class="num">${eur2(b.solde)}</td>
      ${b.lines.length ? `<td class="num" style="${Math.abs(b.result)>=1?'color:var(--warn);font-weight:700':''}">${eur2(b.result)}</td>
      <td class="${missing?'late-cell':''}">${b.docsIn}/${b.docsAll}${missing?' ⚠︎':''}</td>` : '<td class="num muted">—</td><td><span class="warn-badge">Budget à faire</span></td>'}</tr>`; }).join('');
  const tot = shows.reduce((t,s) => { const b = showBudget(s); ['fee','com','expenses','available','solde','result'].forEach(k => t[k] += b[k]); return t; }, {fee:0,com:0,expenses:0,available:0,solde:0,result:0});
  const off = offLinesOf(projectId);
  const cats = Object.entries(a.byCat).filter(([,v]) => Math.abs(v) >= 0.01).sort((x,y) => y[1]-x[1]);
  return `<div class="proj-budget panel">
    <div class="proj-budget-bar">${head}</div>
    <div class="stat-row">
      <div class="stat"><b>${eur2(a.real)}</b><span>${esc(p.account_name || 'Compte dédié')} : solde réel</span></div>
      <div class="stat"><b>${eur2(a.inTodo)}</b><span>Cachets encore à recevoir (HT)</span></div>
      <div class="stat"><b>${eur2(a.outTodo)}</b><span>Encore à payer par le compte</span></div>
      <div class="stat"><b>${eur2(a.end)}</b><span>Solde prévu en fin de tournée</span></div>
      ${a.artboAdvance ? `<div class="stat"><b style="color:var(--warn)">${eur2(a.artboAdvance)}</b><span>Avancé par L'ArtBo, pas encore remboursé par le compte</span></div>` : ''}
    </div>
    <div class="steps" style="max-width:640px;margin-bottom:12px">
      <label>Nom du compte dédié</label>${cIn('projects', p.id, 'account_name', p.account_name, 'text', 'placeholder="ex. Compte The Locos L’ArtBo (vide = pas de compte dédié)"')}
      <label>Solde de départ du compte</label>${cIn('projects', p.id, 'account_opening', p.account_opening, 'number', 'class="narrow" placeholder="0"')}
      <label>Le solde artiste est versé à</label>${cIn('projects', p.id, 'artist_payee', p.artist_payee, 'text', 'placeholder="ex. Pipi"')}
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th class="num">Cachet HT</th><th class="num">Commission</th><th class="num">Dépenses</th><th class="num">Reste artiste</th><th class="num">Solde versé</th><th class="num">Écart</th><th>Pièces</th></tr></thead>
      <tbody>${rows}<tr class="total-row"><td colspan="2"><b>Total (${shows.length} dates)</b></td><td class="num"><b>${eur2(tot.fee)}</b></td><td class="num"><b>${eur2(tot.com)}</b></td><td class="num"><b>${eur2(tot.expenses)}</b></td><td class="num"><b>${eur2(tot.available)}</b></td><td class="num"><b>${eur2(tot.solde)}</b></td><td class="num"><b>${eur2(tot.result)}</b></td><td></td></tr></tbody></table></div>
    <p class="muted" style="font-size:13px;margin:6px 0 14px">Dépenses par catégorie : ${cats.map(([k,v]) => `${esc(k)} <b>${eur2(v)}</b>`).join(' · ') || '—'} · coût moyen par date : <b>${eur2(shows.length ? (tot.com + tot.expenses) / shows.length : 0)}</b></p>
    <h3 class="block-title">Frais hors date (affiches, avances…)</h3>
    <div class="tbl-wrap"><table class="budget-table">${HEAD}<tbody>${off.map(l => lineRow(l, p)).join('') || '<tr><td colspan="10" class="muted">Aucun frais hors date.</td></tr>'}</tbody></table></div>
    <div class="vh-actions" style="margin-top:10px"><button class="btn sm" data-act="addBudgetLine" data-project="${p.id}">Ajouter un frais hors date</button></div>
    ${dropZone(`data-budget-drop='${JSON.stringify({project_id:p.id})}'`, 'Glisse ici une pièce hors date : l’IA la lit et l’ajoute.')}
  </div>`;
}


// ─────────────── Budget de production (contrat Production / Co-Production) ───────────────

const pin = (s, path, v, extra = '') => `<input type="${/label/.test(path) ? 'text' : 'number'}" ${/label/.test(path) ? '' : 'step="any" inputmode="decimal"'} data-prod-show="${s.id}" data-prod-path="${path}" value="${esc(v ?? '')}" ${extra}>`;
const pct = v => v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('fr-FR') + ' %';
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
  return `<div class="prod-budget prod-production">
    <h3 class="block-title">Budget de production <span class="badge tag">${esc(s.contract_type)}</span></h3>
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
      ${s.contract_type === 'Co-Production' || s.partner_id ? `<label>Part de L’ArtBo (%)</label><span>${pin(s, 'artbo_share', p.artbo_share, 'class="narrow"')} <span class="muted">· ${esc(f.partnerName)} : ${esc(String(100 - (Number(p.artbo_share) || 0)))} %</span></span>` : ''}
    </div>

    <h4 class="block-title">Recettes : billetterie</h4>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th>Tarif</th><th class="num">Billets prévus</th><th class="num">Prix TTC</th><th class="num">DL prod</th><th class="num">DL réseau</th><th class="num">Prix public</th><th class="num">Total prévu TTC</th><th class="num">Billets vendus</th><th class="num">Total réel TTC</th><th></th></tr></thead>
      <tbody>${tickets}
        <tr><td>Invitations</td><td class="num">${pin(s, 'invitations', p.invitations, 'class="narrow"')}</td><td colspan="5"></td><td class="num">${pin(s, 'real_invitations', p.real_invitations, 'class="narrow" placeholder="—"')}</td><td colspan="2"></td></tr></tbody>
      <tfoot><tr class="bill-total"><td><b>Total</b></td><td class="num"><b>${f.paying}</b> payants</td><td colspan="4" class="muted">prix moyen ${eur2(f.avgPrice)}</td><td class="num nowrap"><b>${eur2(f.grossTtc)}</b></td><td class="num">${hasReal ? `<b>${r.paying}</b>` : '—'}</td><td class="num nowrap">${hasReal ? `<b>${eur2(r.grossTtc)}</b>` : '—'}</td><td></td></tr></tfoot></table></div>
    <div class="vh-actions" style="margin:8px 0 14px"><button class="btn sm" data-act="prodAddTicket" data-id="${s.id}">Ajouter un tarif</button></div>

    <h4 class="block-title">Droits et taxes</h4>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th></th><th class="num">Taux</th><th class="num">Prévu</th><th class="num">Réel</th></tr></thead><tbody>
      <tr><td>Recette TTC</td><td></td>${two(f.grossTtc, R(r.grossTtc))}</tr>
      <tr><td>TVA</td><td class="num">${esc(String(p.vat))} %</td>${two(f.vatAmount, R(r.vatAmount))}</tr>
      <tr><td><b>Recette HT</b></td><td></td>${two(f.ht, R(r.ht), 'strong')}</tr>
      ${taxRow('Taxe CNM', 'cnm_pct', f.cnm, r.cnm, '% de la recette HT')}
      ${taxRow('SACEM + AGESSA', 'sacem_pct', f.sacem, r.sacem, '% de la recette HT ; AGESSA ' + p.agessa_pct + ' % des droits')}
      ${taxRow('SACD + CR + AGESSA', 'sacd_pct', f.sacd, r.sacd, '% de la recette HT (0 si pas de SACD)')}
      ${taxRow('SACD mise en scène', 'sacd_ms_pct', f.sacdMs, r.sacdMs, '% de la recette HT (0 si pas de mise en scène)')}
      <tr><td>AGESSA (sur les droits)</td><td class="num">${pin(s, 'agessa_pct', p.agessa_pct, 'class="narrow"')} %</td><td colspan="2" class="muted">compris dans les lignes SACEM / SACD</td></tr>
      <tr class="bill-total"><td><b>Recette nette de droits et taxes</b></td><td class="muted">${eur2(f.netPerTicket)} / billet</td>${two(f.net, R(r.net), 'strong')}</tr>
      <tr><td>Droits de location producteur (HT)</td><td></td>${two(f.dlHt, R(r.dlHt))}</tr>
    </tbody></table></div>

    <h4 class="block-title">Coûts de production</h4>
    <div class="tbl-wrap"><table class="budget-table">${HEAD}<tbody>${cats.map(c => { const ls = lines.filter(l => (l.category || 'Autres') === c); return ls.length ? `<tr class="cat-row"><td colspan="10"><b>${esc(c)}</b> <span class="muted">· prévu ${eur2(f.byCat[c] || 0)} · réel ${eur2(r.byCat[c] || 0)}</span></td></tr>` + ls.map(l => lineRow(l, proj, {qtyAll: true})).join('') : ''; }).join('')}</tbody></table></div>
    <div class="vh-actions" style="margin-top:10px">
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Salle">Ajouter une ligne salle</button>
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Promoteur">Ajouter une ligne promoteur</button>
      ${lines.length ? '' : `<button class="btn sm primary" data-act="prefillProduction" data-id="${s.id}">Préremplir (modèle du budget de production)</button>`}
      <button class="btn sm ghost" data-act="copyBudget" data-id="${s.id}">Copier les lignes d'une autre date</button>
    </div>
    ${dropZone(`data-budget-drop='${JSON.stringify({show_id:s.id})}'`, 'Glisse ici une facture ou un devis (ou sur une ligne précise) : l’IA la lit, met la ligne à jour et la range dans le Drive de la date (02_Finance).')}

    <h4 class="block-title">Résultat</h4>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th></th><th class="num">Taux</th><th class="num">Prévu</th><th class="num">Réel</th></tr></thead><tbody>
      <tr><td>Recette nette de droits et taxes</td><td></td>${two(f.net, R(r.net))}</tr>
      <tr><td>Coûts de production HT</td><td></td>${two(-f.costs, -r.costs)}</tr>
      <tr><td>Promo locale (sur la recette nette)</td><td class="num">${pin(s, 'promo_net_pct', p.promo_net_pct, 'class="narrow"')} %</td><td colspan="2"></td></tr>
      <tr><td>Promo locale (sur les DL)</td><td class="num">${pin(s, 'promo_dl_pct', p.promo_dl_pct, 'class="narrow"')} %</td>${two(-f.promo, R(-r.promo))}</tr>
      <tr><td><b>Résultat hors DL</b></td><td></td>${two(f.result, R(r.result), 'strong')}</tr>
      <tr class="bill-total"><td><b>Résultat DL inclus</b></td><td></td>${two(f.resultDl, R(r.resultDl), 'strong')}</tr>
      ${f.share < 1 ? `<tr><td>Part L’ArtBo (${esc(String(p.artbo_share))} %)</td><td></td>${two(f.artbo, R(r.artbo))}</tr>
      <tr><td>Part ${esc(f.partnerName)} (${esc(String(100 - p.artbo_share))} %)</td><td></td>${two(f.partner, R(r.partner))}</tr>` : ''}
    </tbody></table></div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">Montants HT sauf la billetterie (TTC). Le réel se remplit avec les billets vendus et les montants réels des pièces ; tant qu’aucun billet vendu n’est saisi, les recettes réelles restent vides. Une date produite par L’ArtBo n’entre pas dans le compte dédié de l’artiste.</p>
  </div>`;
}
