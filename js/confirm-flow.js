/**
 * ✅ Confirmer une date, dans l'ordre :
 *   1. la date passe en « Confirmée » (liste, fiche, booking…) → on propose d'envoyer la confirmation tout de suite ;
 *   2. « Envoyer la confirmation » → d'abord les conditions à valider (contrat, cachet, TVA, acomptes…) :
 *      ce sont elles que reprennent le mail, la fiche de renseignements et le contrat ;
 *   3. puis le mail de confirmation (envoi direct ou brouillon Gmail).
 * Partout pareil : la liste des statuts, la fiche de la date, la page Production.
 */
import { render } from './app.js';
import { billPct, paymentsOf } from './calc.js';
import { CONFIRMED_PROD, CONTRACTS } from './constants.js';
import { insert, refreshShowSide, remove, save } from './data.js';
import { isBookingOnly, prepareMail } from './mail.js';
import { byId, projFilterOk, setting } from './selectors.js';
import { S, setProjects } from './state.js';
import { openModal } from './ui/modal.js';
import { esc, eur2, fmtDate, toast } from './utils.js';
import { rebalanceSolde } from './actions.js';

const r2 = n => Math.round(n * 100) / 100;
export const becameConfirmed = (before, after) => CONFIRMED_PROD.includes(after) && !CONFIRMED_PROD.includes(before);

/** Juste après le passage en « Confirmée » : envoyer la confirmation maintenant ? */
export async function askConfirmation(showId){
  const s = byId('shows', showId); if (!s) return;
  await refreshShowSide(showId);   // acompte, solde et commission créés par la base au passage en confirmée
  const ok = await openModal({title: 'Date confirmée', fields: [], saveLabel: 'Oui, envoyer la confirmation',
    extra: `<p style="margin:0 0 6px"><b>${esc(s.venue || '')}</b>${s.city ? ` · ${esc(s.city)}` : ''} · ${fmtDate(s.date)}</p>
      <p class="muted" style="margin:0">Tu veux envoyer la confirmation à l’organisateur maintenant ? Tu valideras d’abord les conditions (cachet, acomptes…), puis le mail.
      Sinon, le bouton « Envoyer la confirmation » t’attend en haut de la date, dans Production.</p>`,
    onSave: () => true});
  if (ok) openConfirmation(showId);
}

/** Va sur la date dans Production (dépliée) puis lance la confirmation */
export async function openConfirmation(showId){
  const s = byId('shows', showId); if (!s) return;
  S.view = 'production'; S.projectPage = null; S.structurePage = null; S.suiviPage = null;
  if (s.date) S.year = Number(s.date.slice(0, 4));
  if (!projFilterOk([s.project_id])) setProjects([s.project_id]);   // la date doit être visible
  S.openProd.add(showId);
  render();
  document.getElementById('prod-' + showId)?.scrollIntoView({block: 'start'});
  await sendConfirmation(showId);
}

/** « Envoyer la confirmation » : conditions à valider, puis le mail */
export async function sendConfirmation(showId){
  const ok = await validateTerms(showId);
  if (ok) await prepareMail(showId, 'confirmation');
}

/** Acomptes d'une date (hors solde), dans l'ordre */
const acomptesOf = id => paymentsOf(id).filter(p => p.kind === 'acompte').sort((a, b) => (a.sort || 0) - (b.sort || 0));

/** Étape 1 : les conditions reprises par le mail, la fiche et le contrat */
export async function validateTerms(showId){
  const s = byId('shows', showId); if (!s) return false;
  await refreshShowSide(showId);
  const booking = isBookingOnly(s);
  const acs = acomptesOf(showId);
  const locked = p => !!(p.sent_at || p.paid_at);
  const def = Number(setting('default_acompte_pct') ?? 20) || 20;
  const pcts = acs.length ? acs.map(p => r2(billPct(p) ?? 0)) : [def];
  const acRows = (list) => list.map((v, i) => `<div class="terms-ac"><span>Acompte ${list.length > 1 ? i + 1 : ''}</span>
      <input type="number" step="any" inputmode="decimal" class="narrow" data-terms-ac="${i}" value="${v}" ${acs[i] && locked(acs[i]) ? 'disabled title="Facture déjà envoyée"' : ''} aria-label="% de l’acompte ${i + 1}"> %
      <span class="muted terms-eur" data-terms-eur="${i}"></span></div>`).join('');
  const extra = booking ? `<p class="mode-note">Booking uniquement : pas d’acompte ni de solde, seulement la facture de commission. L’organisateur et l’artiste font leur contrat entre eux.</p>`
    : `<div class="field full"><label>Acomptes</label>
      <div class="terms-acs">
        <label class="terms-n">Nombre d’acomptes <select id="terms-n">${[0, 1, 2, 3].map(n => `<option ${n === (acs.length || 1) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <div id="terms-list">${acRows(pcts)}</div>
        <div class="terms-solde" id="terms-solde"></div>
      </div>
      <div class="help">Le solde prend ce qui reste. Ces % partent dans le mail ({{acompte_pct}}), la fiche de renseignements et le contrat, et créent les lignes de facturation.</div></div>`;
  const p = openModal({title: `Conditions à valider · ${s.venue || ''}`, saveLabel: 'Valider et préparer le mail',
    values: {id: s.id, contract_type: s.contract_type, fee_ht: s.fee_ht, vat_rate: s.vat_rate, show_time: s.show_time, set_length: s.set_length, invitations: s.invitations, artbo_pct: s.artbo_pct},
    extraTop: `<p class="muted" style="margin:0 0 10px">${fmtDate(s.date)} · ${esc(byId('projects', s.project_id)?.name || '')}${s.terms_validated_at ? ` · déjà validées le ${fmtDate(s.terms_validated_at.slice(0, 10))}` : ''}</p>`,
    fields: [
      {k: 'contract_type', label: 'Type de contrat', type: 'select', options: CONTRACTS, blank: false},
      {k: 'fee_ht', label: 'Cachet HT (€)', type: 'number'},
      {k: 'vat_rate', label: 'TVA du cachet (%)', type: 'number', placeholder: '5.5'},
      {k: 'artbo_pct', label: 'Commission L’ArtBo (%)', type: 'number', placeholder: '15'},
      {k: 'show_time', label: 'Heure de passage', placeholder: 'ex. 22h30'},
      {k: 'set_length', label: 'Durée du set', placeholder: 'ex. 1h15'},
      ...(booking ? [] : [{k: 'invitations', label: 'Invitations producteur', type: 'number', placeholder: '10'}]),
    ], extra,
    onSave: async v => {
      if (v.fee_ht == null){ toast('Indique le cachet HT', true); return false; }
      if (!v.contract_type || v.contract_type === 'N.C'){ toast('Choisis le type de contrat', true); return false; }
      const list = booking ? [] : [...document.querySelectorAll('#modal [data-terms-ac]')].map(i => Number(String(i.value).replace(',', '.')) || 0);
      // total : acomptes proposés + factures déjà parties (acomptes au-delà du nombre choisi, solde envoyé ou payé)
      const pays = paymentsOf(s.id), now = acomptesOf(s.id);
      const lockedExtra = now.slice(list.length).filter(locked).reduce((a, p) => a + (billPct(p) || 0), 0);
      const solde = pays.find(p => p.kind === 'solde'), soldeLocked = solde && locked(solde) ? (billPct(solde) || 0) : 0;
      const sum = list.reduce((a, b) => a + b, 0) + lockedExtra + soldeLocked;
      if (sum > 100.001){ toast(`Les factures dépasseraient 100 % du cachet (${String(r2(sum)).replace('.', ',')} % avec celles déjà envoyées)`, true); return false; }
      if (!(await save('shows', s.id, {...v, terms_validated_at: new Date().toISOString()}, {rerender: false}))) return false;
      if (!booking && !(await syncAcomptes(s.id, list))){ toast('Les acomptes n’ont pas pu être enregistrés : vérifie l’onglet Factures', true); return false; }
      toast('Conditions validées');
      return true;
    }});
  if (!booking){
    const draw = () => {
      const fee = Number(document.querySelector('#modal [name=fee_ht]')?.value.replace(',', '.')) || 0;
      const vals = [...document.querySelectorAll('#modal [data-terms-ac]')].map(i => Number(String(i.value).replace(',', '.')) || 0);
      vals.forEach((v, i) => { const e = document.querySelector(`#modal [data-terms-eur="${i}"]`); if (e) e.textContent = fee ? `= ${eur2(fee * v / 100)} HT` : ''; });
      const rest = r2(100 - vals.reduce((a, b) => a + b, 0));
      const box = document.querySelector('#modal #terms-solde');
      if (box) box.innerHTML = rest < 0 ? `<span class="err">Les acomptes dépassent 100 % du cachet</span>` : `Solde : <b>${String(rest).replace('.', ',')} %</b>${fee ? ` = ${eur2(fee * rest / 100)} HT` : ''}`;
    };
    document.querySelector('#modal #terms-n')?.addEventListener('change', e => {
      const n = Number(e.target.value), cur = [...document.querySelectorAll('#modal [data-terms-ac]')].map(i => i.value);
      const next = Array.from({length: n}, (_, i) => cur[i] ?? (n ? r2(Math.max(0, 100 - cur.slice(0, i).reduce((a, b) => a + (Number(b) || 0), 0)) / Math.max(1, n - i) / 2) : 0));
      document.querySelector('#modal #terms-list').innerHTML = acRows(next); draw();
    });
    document.querySelector('#modal')?.addEventListener('input', e => { if (e.target.matches('[data-terms-ac], [name=fee_ht]')) draw(); });
    draw();
  }
  return !!(await p);
}

/** Lignes d'acompte = la liste validée (une facture déjà envoyée ou payée n'est jamais touchée), solde = le reste */
async function syncAcomptes(showId, list){
  const acs = acomptesOf(showId);
  let sort = Math.max(0, ...paymentsOf(showId).filter(p => p.kind !== 'solde').map(p => p.sort || 0));
  for (let i = 0; i < Math.max(list.length, acs.length); i++){
    const p = acs[i];
    const label = list.length > 1 ? `Acompte ${i + 1}` : 'Acompte';
    if (i < list.length){
      if (!p){ if (!(await insert('show_payments', {show_id: showId, kind: 'acompte', label, pct: list[i], sort: ++sort}))) return false; }
      else if (!p.sent_at && !p.paid_at){
        // le nom suit le nombre d'acomptes (Acompte / Acompte 1, 2…), sauf un nom choisi à la main
        const patch = {};
        if (Number(p.pct) !== list[i] || p.amount != null) Object.assign(patch, {pct: list[i], amount: null});
        if (!p.label || /^acompte( \d+)?$/i.test(p.label.trim())) if (p.label !== label) patch.label = label;
        if (Object.keys(patch).length && !(await save('show_payments', p.id, patch, {rerender: false}))) return false;
      }
    } else if (p && !p.sent_at && !p.paid_at && !(await remove('show_payments', p.id))) return false;
  }
  if (!paymentsOf(showId).some(p => p.kind === 'solde') && !(await insert('show_payments', {show_id: showId, kind: 'solde', label: 'Solde', pct: 100, sort: 100}))) return false;
  await rebalanceSolde(showId);
  render();
  return true;
}
