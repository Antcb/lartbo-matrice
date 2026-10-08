/**
 * Onglet Production : suivi admin, facturation, commissions, dossier Drive.
 */
import { netArtbo, payAmount, payPct, paymentsOf } from '../calc.js';
import { CONFIRMED_PROD, PROD_STEPS, stClass } from '../constants.js';
import { projName, showsFiltered } from '../selectors.js';
import { S } from '../state.js';
import { cIn, cSel } from '../ui/cells.js';
import { esc, eur } from '../utils.js';

export function viewProduction(){
  const shows = showsFiltered().filter(s => CONFIRMED_PROD.includes(s.status));
  if (!shows.length) return `<div class="view-head"><h1>Production ${S.year}</h1></div><div class="empty panel">Aucune date confirmée en ${S.year}. Une date apparaît ici dès qu'elle passe en « Confirmée Salle » ou « Confirmée Festival ».</div>`;
  let artbo=0, partner=0, toCollect=0;
  shows.forEach(s => paymentsOf(s.id).forEach(p => {
    const a = payAmount(p)||0;
    if (p.kind==='artbo') artbo+=a; if (p.kind==='partner') partner+=a;
    if ((p.kind==='acompte'||p.kind==='solde') && !p.paid_at) toCollect+=a;
  }));
  return `<div class="view-head"><h1>Production ${S.year}</h1>
    <span class="sub">${shows.length} dates · Commissions ${eur(artbo)} · dont partenaires ${eur(partner)} · Net L'ArtBo ${eur(artbo-partner)} · Reste à encaisser ${eur(toCollect)}</span>
    <span class="spacer"></span>
    <button class="btn" data-act="expandAll">Tout déplier</button></div>
    ${shows.map(prodCard).join('')}`;
}

export function prodCard(s){
  const d = s.date ? new Date(s.date+'T12:00:00') : null;
  const pays = paymentsOf(s.id);
  const checks = PROD_STEPS.map(([k])=>!!s[k]).concat(pays.filter(p=>p.kind!=='cnm').map(p=>!!p.paid_at));
  const open = S.openProd.has(s.id);
  const partners = S.db.partners.map(p=>[p.id,p.name]);
  return `<div class="prod-card">
    <div class="prod-head" data-act="toggleProd" data-id="${s.id}" aria-expanded="${open}">
      <div class="day"><b>${d?String(d.getDate()).padStart(2,'0'):'—'}</b><span>${d?d.toLocaleDateString('fr-FR',{month:'short'}):''}</span></div>
      <div><b>${esc(s.venue)}</b> <span class="muted">${esc(s.city||'')} ${s.department?'('+esc(s.department)+')':''}${!S.project?' — '+esc(projName(s.project_id)):''}</span><br>
        <span class="muted">${esc(s.contract_type||'Contrat ?')} · ${eur(s.fee_ht)}</span></div>
      <div class="progress" title="${checks.filter(Boolean).length}/${checks.length} étapes faites">${checks.map(c=>`<i class="${c?'ok':''}"></i>`).join('')}</div>
      <span class="st ${stClass(s.status)}">${esc(s.status)}</span>
    </div>
    ${open ? `<div class="prod-body">
      <div>
        <h4>Suivi admin</h4>
        <div class="steps">${PROD_STEPS.map(([k,l])=>`<label for="${k}-${s.id}">${l}</label><input id="${k}-${s.id}" type="date" data-t="shows" data-id="${s.id}" data-f="${k}" value="${s[k]||''}">`).join('')}</div>
        <h4 style="margin-top:16px">Commissions</h4>
        <div class="steps">
          <label>Cachet HT</label>${cIn('shows',s.id,'fee_ht',s.fee_ht,'number','step="any"')}
          <label>% L'ArtBo</label>${cIn('shows',s.id,'artbo_pct',s.artbo_pct,'number','step="any"')}
          <label>Partenaire</label>${cSel('shows',s.id,'partner_id',s.partner_id,partners)}
          <label>% partenaire</label>${cIn('shows',s.id,'partner_pct',s.partner_pct,'number','step="any"')}
        </div>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Le % partenaire s'applique à la commission L'ArtBo. Net L'ArtBo : <b>${eur(netArtbo(s))}</b></p>
        <div class="drive">${driveHTML(s)}</div>
      </div>
      <div>
        <h4>Facturation</h4>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Ligne</th><th class="num">%</th><th class="num">Montant</th><th>N° facture</th><th>Envoyée</th><th>Payée</th><th></th></tr></thead>
          <tbody>${pays.map(p=>{ const a=payAmount(p), ov=p.amount!=null;
            return `<tr>
            <td>${cIn('show_payments',p.id,'label',p.label,'text','style="min-width:170px"')}</td>
            <td class="num">${p.kind==='cnm'||p.kind==='autre'||p.kind==='acompte'||p.kind==='solde' ? cIn('show_payments',p.id,'pct',p.pct,'number','step="any" style="min-width:60px"') : `<span class="muted">${payPct(p)??'—'}</span>`}</td>
            <td class="num"><input type="number" step="any" data-t="show_payments" data-id="${p.id}" data-f="amount" value="${ov?p.amount:''}" placeholder="${a==null?'à saisir':a}" title="Laisse vide pour le calcul automatique" class="${ov?'override':''}"></td>
            <td>${cIn('show_payments',p.id,'invoice_number',p.invoice_number)}</td>
            <td>${cIn('show_payments',p.id,'sent_at',p.sent_at,'date')}</td>
            <td class="${p.paid_at?'done-cell':''}">${cIn('show_payments',p.id,'paid_at',p.paid_at,'date')}</td>
            <td><button class="btn small ghost danger" data-act="delPay" data-id="${p.id}" aria-label="Supprimer la ligne">✕</button></td></tr>`;}).join('')}
          </tbody></table></div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          <button class="btn small" data-act="addPay" data-kind="acompte" data-id="${s.id}">Ajouter un acompte</button>
          <button class="btn small" data-act="addPay" data-kind="cnm" data-id="${s.id}">Ajouter la taxe CNM</button>
          <button class="btn small" data-act="addPay" data-kind="autre" data-id="${s.id}">Autre ligne</button>
          <button class="btn small" data-act="editShow" data-id="${s.id}">Fiche complète</button>
        </div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Montant vide = calcul automatique sur le cachet HT. Un montant saisi à la main apparaît en orange.</p>
      </div>
    </div>` : ''}
  </div>`;
}

export function driveHTML(s){
  if (s.drive_folder_id) return `📁 <a href="https://drive.google.com/drive/folders/${esc(s.drive_folder_id)}" target="_blank" rel="noopener">Ouvrir le dossier Drive</a>`;
  if (s.drive_folder_error) return `<span class="err">Dossier Drive non créé : ${esc(s.drive_folder_error)}</span> <button class="btn small" data-act="retryDrive" data-id="${s.id}">Réessayer</button>`;
  if (s.drive_folder_requested_at) return `<span class="muted">Dossier Drive en cours de création…</span> <button class="btn small" data-act="reloadShow" data-id="${s.id}">Actualiser</button>`;
  return `<span class="muted">Pas de dossier Drive.</span> <button class="btn small" data-act="retryDrive" data-id="${s.id}">Créer le dossier</button>`;
}
