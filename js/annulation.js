/**
 * (v1.72, L3 du point 02 — décisions d'Anthony du 28/11/2026, 12 h 08) « Annuler la date » : du clic sur « Annulée » (ou « Sans
 * Suite ») d'une date ENGAGÉE jusqu'à la fiche d'annulation. Écritures uniquement par les fonctions de la base (show_annuler,
 * annulation_corriger, annulation_retablir) ; aucun document ni mouvement financier créé, rien n'est envoyé à Pennylane.
 * Règles : js/annulation-regles.js (calcul), js/calc.js (dateEngagee, etatAnnulation) ; même règle côté base (migration v1.72).
 */
import { go, render } from './app.js';
import { S } from './state.js';
import { refreshFor, sb } from './data.js';
import { byId, projName } from './selectors.js';
import { allPaymentsOf, annulationOf, avoirCouvert, commissionState, dateEngagee, depenseEngagee, encaisseHt, etatAnnulation, isInvoiced, payAmount,
  paymentsOf, resteDu, showVat, soldeeParAvoir, transfersOf, ttc } from './calc.js';
import { REGIME_LABEL, planAnnulation, regimeAnnulation, relanceImpaye } from './annulation-regles.js';
import { isOff } from './constants.js';
import { openModal } from './ui/modal.js';
import { ask, askText } from './ui/dialog.js';
import { esc, eur2, fmtDate, pct, toast, today } from './utils.js';

const KIND = {acompte: 'Acompte', solde: 'Solde', autre: 'Autre ligne', artbo: 'Commission L’ArtBo', partner: 'Commission partenaire', cnm: 'Taxe CNM'};
const nom = p => p.label || KIND[p.kind] || p.kind;
const CESSION = ['acompte', 'solde', 'autre'];
const lien = j => /^https?:\/\//i.test(String(j || '')) ? `<a href="${esc(j)}" target="_blank" rel="noopener">${esc(j)} ↗</a>` : esc(j || '—');

/** Le statut demandé impose « Annuler la date » : date engagée qui passe en « Annulée » ou « Sans Suite » (décision 1) */
export const annulationRequise = (s, statut) => !!s && isOff(statut) && !isOff(s.status) && dateEngagee(s);
/** Date annulée avec une fiche active : son statut ne change que par « Rétablir la date » (même garde côté base) */
export const statutVerrouille = s => !!s && !!annulationOf(s.id);
export const STATUT_VERROUILLE = 'Date annulée avec une fiche d’annulation : son statut ne change que par « Rétablir la date » (onglet Annulation de la date, dans Production).';

/** Lignes que l'écran montre selon le régime : booking = commission seule (décision 8) */
const lignesVues = (s, regime) => allPaymentsOf(s.id).filter(p => regime === 'booking' ? ['artbo', 'partner'].includes(p.kind) : true);

/** Constat (lecture) : conditions initiales, ce qui est déjà facturé ou encaissé, commission, dépenses engagées */
function constatHTML(s, regime){
  const ls = lignesVues(s, regime), com = paymentsOf(s.id).find(p => p.kind === 'artbo');
  const dep = (S.db.budget_lines || []).filter(l => l.show_id === s.id && depenseEngagee(l));
  const ligne = p => { const emise = isInvoiced(p);
    return `<tr data-constat="${p.id}"><td data-label="Ligne">${esc(nom(p))}${p.invoice_number ? ` <span class="muted small">${esc(p.invoice_number)}</span>` : ''}</td>
      <td class="num" data-label="Montant HT">${eur2(payAmount(p))}</td><td data-label="État">${emise ? 'émise' : '<span class="muted">non émise</span>'}</td>
      <td class="num" data-label="Avoirs HT">${emise ? eur2(avoirCouvert(p)) : '—'}</td><td class="num" data-label="Encaissé HT">${CESSION.includes(p.kind) || regime === 'booking' ? eur2(encaisseHt(p)) : '—'}</td>
      <td class="num" data-label="Reste dû HT">${emise && !p.paid_at && !soldeeParAvoir(p) ? eur2(resteDu(p)) : '—'}</td></tr>`; };
  // fenêtre : tableaux déjà en fiches sur téléphone (classe cards et noms de colonnes, comme les tableaux des vues — js/app.js)
  return `<div class="full annul-constat">
    <h3 class="block-title">Ce qui existe (lecture seule)</h3>
    <div class="steps">
      <label>Date</label><span>${esc([fmtDate(s.date), s.venue, s.city, projName(s.project_id)].filter(Boolean).join(' · '))}</span>
      <label>Régime</label><span>${esc(REGIME_LABEL[regime])}</span>
      <label>Cachet initial HT</label><span><b>${eur2(s.fee_ht)}</b> (${eur2(ttc(Number(s.fee_ht) || 0, showVat(s)))} TTC) — gardé tel quel</span>
      <label>Contrat</label><span>${esc(s.contract_type || '—')}${s.contract_signed ? ` · signé le ${fmtDate(s.contract_signed)}` : ''}</span>
    </div>
    <div class="tbl-wrap"><table class="cards"><thead><tr><th>Ligne</th><th class="num">Montant HT</th><th>État</th><th class="num">Avoirs HT</th><th class="num">Encaissé HT</th><th class="num">Reste dû HT</th></tr></thead>
      <tbody>${ls.map(ligne).join('') || '<tr><td colspan="6" class="muted">Aucune ligne</td></tr>'}</tbody></table></div>
    ${com && regime !== 'coprod' ? `<p class="small">Commission L’ArtBo : <b>${eur2(payAmount(com))}</b>${transfersOf(com.id).length ? ` · déjà versée : ${eur2(commissionState(com).transferred)}` : ''} — <span class="warn-txt">montant gardé, à revoir</span> (recalcul dans un lot suivant).</p>` : ''}
    ${dep.length ? `<p class="small">Dépenses engagées : ${dep.map(l => `${esc(l.label || l.category || 'ligne')} ${l.amount != null && l.amount !== '' ? eur2(l.amount) : ''}${l.paid_at ? ` (payée le ${fmtDate(l.paid_at)})` : ' (pas encore payée)'}`).join(' · ')}</p>` : ''}
  </div>`;
}

/** Aperçu du calcul (cession) pour un montant dû saisi : ce que deviennent les lignes, sans rien enregistrer */
export function apercuHTML(s, du, origine = new Map()){
  const bill = paymentsOf(s.id).filter(p => CESSION.includes(p.kind));
  if (du == null || !Number.isFinite(du) || du < 0) return '<p class="muted small" data-apercu="vide">Saisis le montant total dû après annulation pour voir ce que deviennent les lignes.</p>';
  // correction : les lignes encore non émises repartent de leur montant d'avant l'annulation (même calcul que la base)
  const montant = p => !isInvoiced(p) && origine.has(p.id) ? Number(origine.get(p.id).montant_initial) || 0 : payAmount(p) || 0;
  const pl = planAnnulation({du, lignes: bill.map(p => ({id: p.id, kind: p.kind, sort: p.sort, emise: isInvoiced(p), montant: montant(p), avoir: avoirCouvert(p)}))});
  const enc = Math.round(bill.reduce((t, p) => t + encaisseHt(p), 0) * 100) / 100;
  const relancees = bill.filter(p => isInvoiced(p) && p.sent_at && !p.paid_at && !p.reminders_paused && !soldeeParAvoir(p));
  const rel = relanceImpaye({regime: 'cession', du, encaisseHt: enc, reclameHt: relancees.reduce((t, p) => t + resteDu(p), 0)});
  const etat = p => { if (isInvoiced(p)) return '<span>Émise — conservée telle quelle</span>';
    const x = pl.plan.find(y => y.id === p.id);
    return x.etat === 'recalculee' ? `<b>À émettre : ${eur2(x.nouveau)} HT</b> <span class="muted small">(initialement ${eur2(x.initial)})</span>` : `<span class="warn-txt">Ne doit plus être émise</span> <span class="muted small">(initialement ${eur2(x.initial)})</span>`; };
  const regul = [pl.depassement > 0 && `Facturé au-delà du montant dû : ${eur2(pl.depassement)} HT — avoir à émettre dans Pennylane (rien n’est créé ici).`,
    enc - du > 0.005 && `Encaissé au-delà du montant dû : ${eur2(enc - du)} HT — remboursement à décider (rien n’est créé ici).`,
    pl.resteSansLigne > 0 && `${eur2(pl.resteSansLigne)} HT restent à facturer sans ligne non émise pour les porter.`,
    relancees.length && !rel.garde && `Relance d’impayé suspendue : ${eur2(relancees.reduce((t, p) => t + resteDu(p), 0))} réclamés pour ${eur2(rel.encore)} encore dus.`].filter(Boolean);
  return `<div data-apercu="${pl.du}"><div class="tbl-wrap"><table class="cards"><thead><tr><th>Ligne</th><th>Après l’annulation</th></tr></thead>
    <tbody>${bill.map(p => `<tr data-apercu-ligne="${p.id}"><td data-label="Ligne">${esc(nom(p))}</td><td data-label="Après l’annulation">${etat(p)}</td></tr>`).join('')}</tbody></table></div>
    <p class="small">Montant dû ${eur2(pl.du)} HT · facturé net ${eur2(pl.factureNet)} · encaissé ${eur2(enc)} · <b>reste à facturer ${eur2(pl.resteAFacturer)} HT</b></p>
    ${regul.length ? `<div class="warn-txt small" data-a-regulariser><b>À régulariser</b> (aucun avoir ni remboursement automatique) :<ul>${regul.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}</div>`;
}

const champs = (regime, v = {}) => [
  ...(regime === 'cession' ? [{k: 'montant', label: 'Montant total dû après annulation (HT, acompte compris ; 0 = sans frais)', type: 'number', full: true}] : []),
  {k: 'motif', label: 'Motif', type: 'textarea', rows: 2, full: true},
  {k: 'decide_le', label: 'Date de la décision', type: 'date'},
  {k: 'justificatif', label: 'Justificatif (lien ou référence)', placeholder: 'ex. lien du mail, clause 7 du contrat'},
  ...(v.correction ? [{k: 'motif_correction', label: 'Motif de la correction', type: 'textarea', rows: 2, full: true}] : []),
];
const lire = (v, regime) => ({du: regime === 'cession' ? v.montant : null, motif: String(v.motif || '').trim(), decide: v.decide_le, j: v.justificatif || null});
const verifier = (x, regime) => {
  if (regime === 'cession' && (x.du == null || !Number.isFinite(x.du) || x.du < 0)) return 'Indique le montant total dû après annulation (HT ; 0 = sans frais)';
  if (!x.motif) return 'Indique le motif de l’annulation';
  if (!x.decide) return 'Indique la date de la décision';
  return '';
};
/** Aperçu tenu à jour pendant la saisie du montant (fenêtre ouverte) */
function suivreMontant(s, origine){
  const dlg = document.querySelector('#modal'), f = dlg?.querySelector('form'), out = dlg?.querySelector('#annul-apercu');
  if (!f || !out || !f.elements.montant) return;
  const maj = () => { const raw = String(f.elements.montant.value || '').replace(',', '.').trim(); out.innerHTML = apercuHTML(s, raw === '' ? null : Number(raw), origine); };
  f.elements.montant.addEventListener('input', maj); maj();
}
async function recharger(showId){
  for (const [t, c] of [['shows', 'id'], ['show_payments', 'show_id'], ['annulations', 'show_id'], ['annulations_journal', 'show_id']]) await refreshFor(t, c, [showId]);
}
/** Montre la fiche d'annulation de la date (Production › Annulées à régulariser › onglet Annulation) */
function montrerFiche(s){
  S.openProd.add(s.id); S.tab['prod:' + s.id] = 'annulation';
  if (s.date) S.year = Number(String(s.date).slice(0, 4)) || S.year;
  go('production');
  setTimeout(() => document.getElementById('prod-' + s.id)?.scrollIntoView({block: 'start'}), 60);
}

/**
 * « Annuler la date » : constat, montant dû (cession), motif, date, justificatif, aperçu, confirmation avant → après, puis fiche.
 * Fermer la fenêtre (ou « Revenir ») n'enregistre rien. statut : « Annulée » ou « Sans Suite » demandé (refusé pour une date engagée).
 */
export async function annulerDate(id, statut = 'Annulée'){
  const s = byId('shows', id); if (!s) return;
  if (statutVerrouille(s)) return toast(STATUT_VERROUILLE, true);
  if (!dateEngagee(s)) return;   // date non engagée : changement direct, comme avant (appelant)
  const regime = regimeAnnulation(s);
  const intro = `<p class="help full">${statut === 'Sans Suite' ? '<b>« Sans Suite » n’est pas possible pour une date engagée</b> (contrat signé, facture émise, encaissement, commission versée ou dépense engagée) : elle passe par l’annulation. ' : ''}La date passera en « Annulée » avec une fiche d’annulation. Factures émises et paiements restent intacts ; <b>aucun avoir, aucun remboursement ni aucun document</b> n’est créé ou envoyé. Fermer cette fenêtre n’enregistre rien.</p>
    ${constatHTML(s, regime)}
    ${regime === 'cession' ? '' : `<p class="help full">${regime === 'booking' ? 'Booking : L’ArtBo ne suit que sa commission — écran limité à la commission (gardée, à revoir).' : 'Coproduction / coréalisation : motif, documents et mouvements enregistrés, sans calcul automatique de résultat (lot suivant).'}</p>`}`;
  const fen = openModal({title: 'Annuler la date', wide: true, saveLabel: 'Vérifier et annuler la date', cancelLabel: 'Fermer', values: {id: 'annuler:' + s.id, decide_le: today()},
    extraTop: intro, fields: champs(regime), extra: regime === 'cession' ? '<div class="full" id="annul-apercu"></div>' : '',
    onSave: async v => {
      const x = lire(v, regime), err = verifier(x, regime);
      if (err){ toast(err, true); return false; }
      const plan = regime === 'cession' ? planAnnulation({du: x.du, lignes: paymentsOf(s.id).filter(p => CESSION.includes(p.kind)).map(p => ({id: p.id, kind: p.kind, sort: p.sort, emise: isInvoiced(p), montant: payAmount(p) || 0, avoir: avoirCouvert(p)}))}) : null;
      const apres = regime === 'cession'
        ? `Montant dû ${eur2(plan.du)} HT (cachet initial ${eur2(s.fee_ht)} gardé) · reste à facturer ${eur2(plan.resteAFacturer)} HT${plan.plan.length ? ` · ${plan.plan.map(l => `${nom(byId('show_payments', l.id))} : ${l.etat === 'recalculee' ? eur2(l.nouveau) + ' à émettre' : 'ne doit plus être émise'}`).join(' · ')}` : ''}${plan.depassement > 0 ? ` · facturé au-delà : ${eur2(plan.depassement)} (à régulariser)` : ''}.`
        : 'Lignes inchangées ; commission gardée, à revoir.';
      // deux boutons sans ambiguïté : « Annuler la date » / « Revenir » (Échap ou clic dehors : rien n'est enregistré)
      if ((await ask({title: 'Annuler la date ?', text: `Avant : « ${s.status} ». Après : « Annulée », avec sa fiche d’annulation. ${apres} Factures émises et paiements inchangés ; aucun avoir ni remboursement créé.`,
        actions: [{value: true, label: 'Annuler la date', danger: true}], cancel: 'Revenir'})) !== true) return false;
      const {error} = await sb.rpc('show_annuler', {p_show: s.id, p_montant: x.du, p_motif: x.motif, p_decide_le: x.decide, p_justificatif: x.j});
      if (error){ toast(error.message, true); return false; }
      await recharger(s.id);
      toast('Date annulée : fiche d’annulation enregistrée');
      setTimeout(() => montrerFiche(byId('shows', s.id) || s), 0);
      return true;
    }});
  suivreMontant(s);   // fenêtre ouverte : aperçu tenu à jour pendant la saisie
  return fen;
}

/** Corriger la fiche : mêmes champs, motif de correction obligatoire, trace avant / après (base : annulation_corriger) */
export async function corrigerAnnulation(annulId){
  const a = (S.db.annulations || []).find(x => x.id === annulId && !x.retablie_at); if (!a) return;
  const s = byId('shows', a.show_id); if (!s) return;
  const fen = openModal({title: 'Corriger l’annulation', wide: true, saveLabel: 'Corriger', cancelLabel: 'Fermer', values: {id: 'corriger:' + a.id, montant: a.montant_du_ht, motif: a.motif, decide_le: a.decide_le, justificatif: a.justificatif},
    extraTop: `<p class="help full">Les factures émises depuis l’annulation restent telles quelles ; les lignes encore non émises sont recalculées. Le motif de la correction est obligatoire ; l’ancienne version reste dans l’historique.</p>`,
    fields: champs(a.regime, {correction: true}), extra: a.regime === 'cession' ? '<div class="full" id="annul-apercu"></div>' : '',
    onSave: async v => {
      const x = lire(v, a.regime), err = verifier(x, a.regime), mc = String(v.motif_correction || '').trim();
      if (err){ toast(err, true); return false; }
      if (!mc){ toast('Indique le motif de la correction', true); return false; }
      const {error} = await sb.rpc('annulation_corriger', {p_id: a.id, p_montant: x.du, p_motif: x.motif, p_decide_le: x.decide, p_justificatif: x.j, p_motif_correction: mc});
      if (error){ toast(error.message, true); return false; }
      await recharger(a.show_id); toast('Annulation corrigée'); return true;
    }});
  // aperçu : lignes encore non émises reprises à leur montant d'avant l'annulation (le serveur recalcule de même)
  if (a.regime === 'cession') suivreMontant(s, new Map((a.lignes || []).map(l => [l.payment_id, l])));
  return fen;
}

/** Rétablir : seulement si rien n'a été ajouté ni modifié depuis l'annulation (contrôle de la base) ; motif obligatoire */
export async function retablirDate(annulId){
  const a = (S.db.annulations || []).find(x => x.id === annulId && !x.retablie_at); if (!a) return;
  const motif = await askText({title: 'Rétablir la date ?', text: `La date reprend le statut « ${a.statut_avant} » et ses lignes non émises leur état d’avant l’annulation. Refusé si une facture, un avoir, un paiement ou un remboursement a été ajouté ou modifié depuis : la date reste alors à régulariser. La fiche reste dans l’historique.`,
    label: 'Motif', ok: 'Rétablir la date', check: v => String(v || '').trim() ? '' : 'Motif obligatoire'});
  if (motif == null) return;
  const {error} = await sb.rpc('annulation_retablir', {p_id: a.id, p_motif: motif});
  if (error) return toast(error.message, true);
  await recharger(a.show_id); toast(`Date rétablie en « ${a.statut_avant} »`); render();
}

/** Fiche d'annulation (onglet « Annulation » de la date, dans Production) */
export function ficheAnnulationHTML(s){
  const a = annulationOf(s.id); if (!a) return '';
  const e = etatAnnulation(s), ini = a.initial || {}, sh = ini.show || {};
  const avant = new Map((a.lignes || []).map(l => [l.payment_id, l]));
  const vues = lignesVues(s, a.regime);
  const apres = p => { const x = avant.get(p.id);
    if (p.annulation === 'abandonnee') return `<span class="warn-txt" data-ne-plus-emettre>Ne doit plus être émise</span>${x ? ` <span class="muted small">(initialement ${eur2(x.montant_initial)})</span>` : ''}`;
    if (p.annulation === 'recalculee' && !isInvoiced(p)) return `<b>À émettre : ${eur2(payAmount(p))} HT</b>${x ? ` <span class="muted small">(initialement ${eur2(x.montant_initial)})</span>` : ''}`;
    if (['artbo', 'partner'].includes(p.kind)) return '<span class="warn-txt">Montant gardé — à revoir</span>';
    return isInvoiced(p) ? `Émise — conservée telle quelle${p.annulation === 'recalculee' && x ? ` <span class="muted small">(recalculée à l’annulation, initialement ${eur2(x.montant_initial)})</span>` : ''}` : '<span class="muted">Non émise</span>'; };
  const regul = !e ? [] : [e.depassement > 0 && `Facturé au-delà du montant dû : ${eur2(e.depassement)} HT — avoir à émettre dans Pennylane.`,
    e.encaisseAuDela > 0.005 && `Encaissé au-delà du montant dû : ${eur2(e.encaisseAuDela)} HT — remboursement à décider.`,
    e.resteSansLigne > 0.005 && `${eur2(e.resteSansLigne)} HT restent à facturer sans ligne non émise pour les porter.`,
    e.relancees.length && !e.relanceGardee && (e.regime === 'cession' ? `Relance d’impayé suspendue : ${eur2(e.reclame)} réclamés pour ${eur2(e.encore)} encore dus (affectation à vérifier).` : 'Relance de la facture de commission suspendue : commission à revoir.'),
    'Commission : montant existant gardé, à revoir (recalcul dans un lot suivant).'].filter(Boolean);
  const journal = (S.db.annulations_journal || []).filter(j => j.annulation_id === a.id).sort((x, y) => String(x.at).localeCompare(String(y.at)));
  const ACT = {annuler: 'Annulée', corriger: 'Corrigée', retablir: 'Rétablie'};
  return `<div class="annul-fiche" data-fiche-annulation="${a.id}">
    <p class="tab-intro"><b>Date annulée</b> le ${fmtDate(a.created_at)}${a.created_by ? ` par ${esc(a.created_by)}` : ''} · décision du ${fmtDate(a.decide_le)} · ${esc(REGIME_LABEL[a.regime])}${a.corrige_at ? ` · corrigée le ${fmtDate(a.corrige_at)}` : ''}
      <button class="btn sm" data-act="annulationCorriger" data-id="${a.id}">Corriger l’annulation…</button>
      <button class="btn sm ghost" data-act="annulationRetablir" data-id="${a.id}">Rétablir la date…</button></p>
    <div class="prod-cols">
      <div><h3 class="block-title">Conditions initiales (figées)</h3>
        <div class="steps"><label>Statut</label><span>${esc(a.statut_avant)}</span>
          <label>Cachet HT</label><span>${eur2(sh.fee_ht)}${sh.vat_rate != null ? ` · TVA ${pct(sh.vat_rate)}` : ''}</span>
          <label>Contrat</label><span>${esc(sh.contract_type || '—')}${sh.contract_signed ? ` · signé le ${fmtDate(sh.contract_signed)}` : ''}</span>
          <label>Commission</label><span>${sh.artbo_pct != null ? pct(sh.artbo_pct) : '—'}</span></div>
        <ul class="small">${(ini.lignes || []).filter(l => a.regime !== 'booking' || ['artbo', 'partner'].includes(l.kind)).map(l => `<li>${esc(l.label || KIND[l.kind] || l.kind)} : ${eur2(l.montant_ht)} HT${l.emise ? ` · émise${l.invoice_number ? ' ' + esc(l.invoice_number) : ''}` : ' · non émise'}${l.paid_at ? ` · payée le ${fmtDate(l.paid_at)}` : ''}</li>`).join('')}</ul></div>
      <div><h3 class="block-title">Conditions retenues</h3>
        <div class="steps">${a.regime === 'cession' ? `<label>Montant total dû</label><b data-montant-du>${eur2(a.montant_du_ht)} HT</b>` : `<label>Calcul</label><span>${a.regime === 'booking' ? 'Commission seule (à revoir)' : 'Sans calcul automatique (lot suivant)'}</span>`}
          <label>Motif</label><span>${esc(a.motif)}</span><label>Justificatif</label><span>${lien(a.justificatif)}</span></div>
        ${e && e.du != null ? `<p class="small" data-montants-annulation>Facturé net ${eur2(e.factureNet)} HT · encaissé ${eur2(e.encaisse)} HT · reste à facturer <b>${eur2(e.resteAFacturer)} HT</b> · encore dû ${eur2(e.encore)} HT</p>` : ''}</div>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Ligne</th><th class="num">Montant HT</th><th>Après l’annulation</th></tr></thead>
      <tbody>${vues.map(p => `<tr data-ligne-annulation="${p.id}"><td>${esc(nom(p))}${p.invoice_number ? ` <span class="muted small">${esc(p.invoice_number)}</span>` : ''}</td><td class="num">${eur2(payAmount(p))}</td><td>${apres(p)}</td></tr>`).join('')}</tbody></table></div>
    ${regul.length ? `<div class="mt small" data-a-regulariser><b class="warn-txt">À régulariser</b> — rien n’est fait automatiquement :<ul>${regul.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
    ${journal.length ? `<details class="mt"><summary>Historique (${journal.length})</summary><ul class="small">${journal.map(j => `<li>${fmtDate(j.at)} · ${esc(ACT[j.action] || j.action)}${j.auteur ? ` par ${esc(j.auteur)}` : ''}${j.motif ? ` — ${esc(j.motif)}` : ''}${j.action === 'corriger' ? ` (montant dû : ${eur2(j.avant?.montant_du_ht)} → ${eur2(j.apres?.montant_du_ht)})` : ''}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

export const ANNUL_ACTIONS = {
  annulerDate: t => annulerDate(t.dataset.id, t.dataset.statut || 'Annulée'),
  annulationCorriger: t => corrigerAnnulation(t.dataset.id),
  annulationRetablir: t => retablirDate(t.dataset.id),
};
