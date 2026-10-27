/**
 * ✅ Confirmer une date, dans l'ordre :
 *   1. la date passe en « Confirmée » (liste, fiche, booking…) → on propose d'envoyer la confirmation tout de suite ;
 *   2. « Envoyer la confirmation » → d'abord les conditions à valider (contrat, cachet, TVA, acomptes…) :
 *      ce sont elles que reprennent le mail, la fiche de renseignements et le contrat ;
 *   3. puis le mail de confirmation (envoi direct ou brouillon Gmail).
 * Partout pareil : la liste des statuts, la fiche de la date, la page Production.
 */
import { render } from './app.js';
import { applyTemplate } from './budget-template.js';
import { BILL_KINDS, billPct, isCoproduction, isInvoiced, payAmount, paymentsOf, soldeInvoiced } from './calc.js';
import { CONFIRMED_PROD, CONTRACTS } from './constants.js';
import { insert, refreshShowSide, remove, save } from './data.js';
import { isBookingOnly, prepareMail } from './mail.js';
import { byId, defaultAcompte, projFilterOk, showCommissionPct } from './selectors.js';
import { S, setProjects } from './state.js';
import { openModal } from './ui/modal.js';
import { esc, eur2, fmtDate, toast } from './utils.js';
import { rebalanceSolde } from './actions.js';

const r2 = n => Math.round(n * 100) / 100;
export const DUE_FIRST = 'à la signature du contrat';
export const becameConfirmed = (before, after) => CONFIRMED_PROD.includes(after) && !CONFIRMED_PROD.includes(before);

/** Juste après le passage en « Confirmée » : envoyer la confirmation maintenant ? */
export async function askConfirmation(showId){
  const s = byId('shows', showId); if (!s) return;
  await refreshShowSide(showId);   // acompte, solde et commission créés par la base au passage en confirmée
  await applyTemplate(byId('shows', showId), {quiet: true});   // budget prévisionnel : le budget type de l'artiste
  const ok = await openModal({title: 'Date confirmée', fields: [], saveLabel: 'Oui, envoyer la confirmation',
    extra: `<p class="mb-sm"><b>${esc(s.venue || '')}</b>${s.city ? ` · ${esc(s.city)}` : ''} · ${fmtDate(s.date)}</p>
      <p class="muted m0">Tu veux envoyer la confirmation à l’organisateur maintenant ? Tu valideras d’abord les conditions (cachet, acomptes…), puis le mail.
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
  const locked = isInvoiced;                       // facture émise : envoyée, payée, numérotée ou dans Pennylane (§6.4)
  const soldeLock = !booking && soldeInvoiced(showId);   // solde facturé : plus aucun acompte ne change (§6.4)
  const def = defaultAcompte();   // 0 % gardé tel quel (= sans acompte) ; 50 seulement si le réglage est vide (§6.4)
  // coproduction (décision du 27/10/2026) : aucun acompte proposé par défaut — seulement ceux qui existent réellement
  const pcts = acs.length ? acs.map(p => ({v: r2(billPct(p) ?? 0), due: p.due_label || ''})) : isCoproduction(s) || def === 0 ? [] : [{v: def, due: ''}];   // réglage à 0 % : date sans acompte
  // chaque acompte : son % et son échéance (le 1er : à la signature du contrat, sauf autre choix)
  const acRows = (list) => list.map(({v, due}, i) => `<div class="terms-ac"><span>Acompte ${list.length > 1 ? i + 1 : ''}</span>
      <input type="number" step="any" inputmode="decimal" class="narrow" data-terms-ac="${i}" value="${v}" ${soldeLock ? 'disabled title="Solde déjà facturé : les acomptes ne changent plus"' : acs[i] && locked(acs[i]) ? 'disabled title="Facture déjà émise : elle ne se modifie plus"' : ''} aria-label="% de l’acompte ${i + 1}"> %
      <input type="text" class="terms-due" data-terms-due="${i}" value="${esc(due || (i === 0 ? DUE_FIRST : ''))}" placeholder="${i === 0 ? DUE_FIRST : 'ex. le 15 janvier 2027'}" aria-label="Échéance de l’acompte ${i + 1}">
      <span class="muted terms-eur" data-terms-eur="${i}"></span></div>`).join('');
  const extra = booking ? `<p class="mode-note">Booking uniquement : pas d’acompte ni de solde, seulement la facture de commission. L’organisateur et l’artiste font leur contrat entre eux.</p>`
    : `<div class="field full"><label>Acomptes</label>
      <div class="terms-acs">
        ${soldeLock ? '<p class="mode-note">Le solde est déjà facturé : les acomptes ne peuvent plus changer (seules les échéances se modifient).</p>' : ''}
        <label class="terms-n">Nombre d’acomptes <select id="terms-n" ${soldeLock ? 'disabled' : ''}>${[0, 1, 2, 3].map(n => `<option ${n === (acs.length || (isCoproduction(s) || def === 0 ? 0 : 1)) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <div id="terms-list">${acRows(pcts)}</div>
        <div class="terms-solde" id="terms-solde"></div>
      </div>
      <div class="help">Le solde prend ce qui reste. Dans le mail de confirmation, chaque acompte a sa ligne avec son % et son échéance ; ces % partent aussi dans la fiche de renseignements et le contrat, et créent les lignes de facturation.</div></div>`;
  const p = openModal({title: `Conditions à valider · ${s.venue || ''}`, saveLabel: 'Valider et préparer le mail',
    values: {id: s.id, contract_type: s.contract_type, fee_ht: s.fee_ht, vat_rate: s.vat_rate, show_time: s.show_time, set_length: s.set_length, invitations: s.invitations, artbo_pct: s.artbo_pct},
    extraTop: `<p class="muted mb">${fmtDate(s.date)} · ${esc(byId('projects', s.project_id)?.name || '')}${s.terms_validated_at ? ` · déjà validées le ${fmtDate(s.terms_validated_at.slice(0, 10))}` : ''}</p>`,
    fields: [
      {k: 'contract_type', label: 'Type de contrat', type: 'select', options: CONTRACTS, blank: false},
      {k: 'fee_ht', label: 'Cachet HT (€)', type: 'number'},
      {k: 'vat_rate', label: 'TVA du cachet (%)', type: 'number', placeholder: '5.5'},
      {k: 'artbo_pct', label: 'Commission L’ArtBo (%)', type: 'number', placeholder: String(showCommissionPct({...s, artbo_pct: null}))},   // vide : % de l'artiste, sinon Réglages selon le mode de la date (§6.3)
      {k: 'show_time', label: 'Heure de passage', placeholder: 'ex. 22h30'},
      {k: 'set_length', label: 'Durée du set', placeholder: 'ex. 1h15'},
      ...(booking ? [] : [{k: 'invitations', label: 'Invitations producteur', type: 'number', placeholder: '10'}]),
    ], extra,
    onSave: async v => {
      if (v.fee_ht == null){ toast('Indique le cachet HT', true); return false; }
      if (!v.contract_type || v.contract_type === 'N.C'){ toast('Choisis le type de contrat', true); return false; }
      const rows = booking ? [] : [...document.querySelectorAll('#modal [data-terms-ac]')].map((inp, i) => ({pct: Number(String(inp.value).replace(',', '.')) || 0,
        due: (document.querySelector(`#modal [data-terms-due="${i}"]`)?.value || '').trim(),
        shown: acs[i] ? pcts[i]?.v : null}));   // % affiché à l'ouverture : sert à savoir si l'utilisateur l'a changé
      const noDue = rows.findIndex((r, i) => i > 0 && !r.due);
      if (noDue >= 0){ toast(`Indique l’échéance de l’acompte ${noDue + 1} (ex. « le 15 janvier 2027 »)`, true); return false; }
      const list = rows.map(r => r.pct);
      // total : acomptes proposés + factures déjà parties (acomptes au-delà du nombre choisi, solde envoyé ou payé)
      const pays = paymentsOf(s.id), now = acomptesOf(s.id);
      const lockedExtra = now.slice(list.length).filter(locked).reduce((a, p) => a + (billPct(p) || 0), 0);
      const solde = pays.find(p => p.kind === 'solde'), soldeLocked = solde && locked(solde) ? (billPct(solde) || 0) : 0;
      const sum = list.reduce((a, b) => a + b, 0) + lockedExtra + soldeLocked;
      if (sum > 100.001){ toast(`Les factures dépasseraient 100 % du cachet (${String(r2(sum)).replace('.', ',')} % avec celles déjà envoyées)`, true); return false; }
      const oldFee = s.fee_ht;
      if (!(await save('shows', s.id, {...v, terms_validated_at: new Date().toISOString()}, {rerender: false}))) return false;
      if (!booking && !(await syncAcomptes(s.id, rows, {duesOnly: soldeLock, coproduction: v.contract_type === 'Co-Production'}))){ toast('Les acomptes n’ont pas pu être enregistrés : vérifie l’onglet Factures', true); return false; }
      if (!booking && Number(v.fee_ht) !== Number(oldFee)) await afterFeeChange(s.id, {level: 2});   // montants saisis : on demande (Q5)
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
      const n = Number(e.target.value), cur = [...document.querySelectorAll('#modal [data-terms-ac]')].map((x, i) => ({v: x.value, due: document.querySelector(`#modal [data-terms-due="${i}"]`)?.value || ''}));
      const next = Array.from({length: n}, (_, i) => cur[i] ?? {v: r2(Math.max(0, 100 - cur.slice(0, i).reduce((a, b) => a + (Number(b.v) || 0), 0)) / Math.max(1, n - i) / 2), due: ''});
      document.querySelector('#modal #terms-list').innerHTML = acRows(next); draw();
    });
    document.querySelector('#modal')?.addEventListener('input', e => { if (e.target.matches('[data-terms-ac], [name=fee_ht]')) draw(); });
    draw();
  }
  return !!(await p);
}

/**
 * Après un changement de cachet (tableau, fiche de la date, « Valider les conditions ») — §6.5, Q5 :
 * les lignes non émises en % suivent ; un montant saisi à la main n'est remplacé que si l'utilisateur le choisit ;
 * une facture émise ne bouge jamais (garde-fou de data.save) ; le solde non émis reprend ce qui reste,
 * sauf un montant de solde que l'utilisateur vient de choisir de conserver.
 */
export async function afterFeeChange(showId, {level = 1} = {}){
  const fee = Number(byId('shows', showId)?.fee_ht) || 0;
  if (!fee) return;
  const has = v => v != null && v !== '';
  const manual = paymentsOf(showId).filter(p => BILL_KINDS.includes(p.kind) && has(p.amount) && has(p.pct) && !isInvoiced(p));
  let recalc = false;
  if (manual.length){
    const rows = manual.map(p => `<li>${esc(p.label || p.kind)} : <b>${eur2(payAmount(p))}</b> saisi à la main → ${eur2(Math.round(fee * Number(p.pct)) / 100)} sur le nouveau cachet</li>`).join('');
    recalc = !!(await openModal({level, title: 'Cachet modifié', fields: [], saveLabel: 'Recalculer sur le nouveau cachet',
      footExtra: `<button type="button" class="btn" data-act="closeModal" data-level="${level}">Conserver les montants saisis</button>`,
      extra: `<p>Le nouveau cachet (${eur2(fee)} HT) est enregistré. Des montants ont été saisis à la main sur des factures pas encore émises :</p><ul>${rows}</ul>
        <p class="muted">Rien n’est remplacé sans ton choix. En les conservant, vérifie ensuite que les factures font bien 100 % du cachet (onglet Factures).</p>`,
      onSave: () => true}));
    if (recalc) for (const p of manual) if (!(await save('show_payments', p.id, {amount: null}, {rerender: false}))) return;
  }
  const solde = paymentsOf(showId).find(p => p.kind === 'solde');
  if (!(solde && !recalc && manual.includes(solde))) await rebalanceSolde(showId);
}

/** Lignes d'acompte = la liste validée (une facture émise n'est jamais touchée, §6.4), solde = le reste.
 *  Un montant saisi en euros est conservé tant que son % n'a pas été changé (Q22 : la précision n'est jamais perdue).
 *  duesOnly : solde déjà facturé, seules les échéances changent. */
async function syncAcomptes(showId, rows, {duesOnly = false, coproduction = false} = {}){
  const acs = acomptesOf(showId), list = rows.map(r => r.pct), dues = rows.map(r => r.due || null);
  if (duesOnly){
    for (let i = 0; i < Math.min(acs.length, dues.length); i++)
      if ((acs[i].due_label || null) !== dues[i] && !(await save('show_payments', acs[i].id, {due_label: dues[i]}, {rerender: false}))) return false;
    render();
    return true;
  }
  let sort = Math.max(0, ...paymentsOf(showId).filter(p => p.kind !== 'solde').map(p => p.sort || 0));
  for (let i = 0; i < Math.max(list.length, acs.length); i++){
    const p = acs[i];
    const label = list.length > 1 ? `Acompte ${i + 1}` : 'Acompte';
    if (i < list.length){
      if (!p){ if (!(await insert('show_payments', {show_id: showId, kind: 'acompte', label, pct: list[i], due_label: dues[i], sort: ++sort}))) return false; }
      else if (!isInvoiced(p)){
        // le nom suit le nombre d'acomptes (Acompte / Acompte 1, 2…), sauf un nom choisi à la main
        const patch = {};
        // % changé dans la fenêtre : il remplace l'ancienne valeur. % inchangé : rien ne bouge (un montant en euros reste tel quel ;
        // si le cachet a changé, afterFeeChange demande ensuite conserver / recalculer)
        if (rows[i].shown == null || r2(rows[i].shown) !== r2(list[i])) Object.assign(patch, {pct: list[i], amount: null});
        if ((p.due_label || null) !== dues[i]) patch.due_label = dues[i];
        if (!p.label || /^acompte( \d+)?$/i.test(p.label.trim())) if (p.label !== label) patch.label = label;
        if (Object.keys(patch).length && !(await save('show_payments', p.id, patch, {rerender: false}))) return false;
      } else if ((p.due_label || null) !== dues[i] && !(await save('show_payments', p.id, {due_label: dues[i]}, {rerender: false}))) return false;   // facture partie : seule l'échéance change
    } else if (p && !isInvoiced(p) && !(await remove('show_payments', p.id))) return false;
  }
  // coproduction : jamais de solde créé d'office (aucune facture de cession) — une opération réelle s'ajoute à la main
  if (!paymentsOf(showId).some(p => p.kind === 'solde') && !coproduction && !(await insert('show_payments', {show_id: showId, kind: 'solde', label: 'Solde', pct: 100, sort: 100}))) return false;
  await rebalanceSolde(showId);
  render();
  return true;
}
