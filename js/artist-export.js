/**
 * Export du budget d'une date pour l'artiste (ex. Pipi pour The Locos) : une page claire, prête à imprimer
 * ou à enregistrer en PDF — cachet, commission, chaque dépense, ce qui reste pour l'artiste et ce qui lui a été versé.
 */
import { commissionAmount, commissionOf, isSolde, lineValue, showBudget } from './budget.js';
import { artistResult } from './views/budget.js';
import { byId, showCommissionPct } from './selectors.js';
import { commissionState } from './calc.js';
import { esc, eur2, fmtDate, toast } from './utils.js';

export function exportArtistBudget(showId){
  const s = byId('shows', showId); if (!s) return;
  const p = byId('projects', s.project_id), b = showBudget(s), r = artistResult(s, b), com = commissionOf(s);
  // commission (lot D1) : total, versements réels et reste ; le % n'est affiché que s'il correspond au total (sinon total fixé à part)
  const cst = com ? commissionState(com) : null, pctN = com?.pct != null && String(com.pct).trim() !== '' ? Number(com.pct) : showCommissionPct(s);
  const comPct = Math.abs(Math.round((Number(s.fee_ht) || 0) * pctN) / 100 - commissionAmount(s)) < 0.005 ? String(pctN) : '';
  const artist = (p?.name || '').replace(/\s*•.*$/, ''), who = p?.artist_payee || artist;
  const exp = b.lines.filter(l => !isSolde(l) && Math.abs(lineValue(l)) >= 0.005);
  const CAT = {Staff: 'Salaires', Movinmotion: 'Frais de paie (Movinmotion)', Taxes: 'Taxes'};
  const row = l => `<tr><td>${esc(CAT[l.category] || l.category || '')}</td><td>${esc(l.label || '')}${l.supplier ? ` <span class="m">· ${esc(l.supplier)}</span>` : ''}</td>
    <td class="n">${eur2(lineValue(l))}${l.amount == null ? ' <span class="m">(prévu)</span>' : ''}</td></tr>`;
  const paid = r.lines.filter(l => l.amount != null && l.paid_at), todo = r.lines.filter(l => l.amount != null && !l.paid_at);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(artist)} — budget du ${esc(fmtDate(s.date))}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  :root{--b:#283c63;--m:#6b7280;--l:#e5e7eb}
  *{box-sizing:border-box} body{font-family:Geist,system-ui,sans-serif;color:#111;margin:0;padding:32px 16px;background:#fff}
  main{max-width:760px;margin:0 auto}
  h1{color:var(--b);font-size:26px;margin:0 0 4px} .sub{color:var(--m);margin:0 0 24px}
  table{width:100%;border-collapse:collapse;margin:0 0 18px} td,th{padding:8px 10px;border-bottom:1px solid var(--l);text-align:left;vertical-align:top}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--m)} .n{text-align:right;white-space:nowrap} .m{color:var(--m);font-size:12px}
  tr.t td{font-weight:800;border-top:2px solid var(--b);border-bottom:0} tr.big td{font-size:18px;color:var(--b)}
  h2{font-size:15px;color:var(--b);margin:22px 0 6px}
  .bar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:16px} button{font:600 14px Geist,sans-serif;padding:8px 14px;border-radius:8px;border:1px solid var(--b);background:var(--b);color:#fff;cursor:pointer}
  footer{color:var(--m);font-size:12px;margin-top:28px}
  @media print{.bar{display:none} body{padding:0}}
</style></head><body><main>
  <div class="bar"><button type="button" id="print-btn">Imprimer / enregistrer en PDF</button></div>
  <h1>${esc(artist)} — ${esc(s.venue || '')}</h1>
  <p class="sub">${esc(fmtDate(s.date))}${s.city ? ' · ' + esc(s.city) : ''} · montants HT</p>

  <h2>Le cachet</h2>
  <table><tbody>
    <tr><td>Cachet HT</td><td class="n">${eur2(b.fee)}</td></tr>
    <tr><td>Commission L’ArtBoristerie${comPct ? ` (${esc(comPct)} %)` : ''}</td><td class="n">− ${eur2(commissionAmount(s))}</td></tr>
    ${cst ? cst.transfers.map(t => `<tr><td class="m">dont transféré le ${esc(fmtDate(t.transferred_at))}${t.note ? ' · ' + esc(t.note) : ''}</td><td class="n m">${eur2(Number(t.amount))}</td></tr>`).join('')
      + (cst.legacy ? `<tr><td class="m">transférée le ${esc(fmtDate(com.paid_at))}</td><td class="n m">${eur2(cst.total)}</td></tr>` : '')
      + (cst.remaining >= 0.005 && !cst.legacy ? `<tr><td class="m">reste à transférer (pas encore prélevé sur ton compte)</td><td class="n m">${eur2(cst.remaining)}</td></tr>` : '') : ''}
  </tbody></table>

  <h2>Les dépenses de la date</h2>
  <table><thead><tr><th>Catégorie</th><th>Détail</th><th class="n">Montant</th></tr></thead><tbody>
    ${exp.map(row).join('') || '<tr><td colspan="3" class="m">Aucune dépense.</td></tr>'}
    <tr class="t"><td colspan="2">Total des dépenses</td><td class="n">− ${eur2(b.expenses)}</td></tr>
  </tbody></table>

  <h2>Le résultat</h2>
  <table><tbody>
    <tr class="big"><td><b>Reste pour ${esc(who)}</b><div class="m">cachet − commission − dépenses</div></td><td class="n"><b>${eur2(r.reste)}</b></td></tr>
    ${paid.map(l => `<tr><td>Versé${l.paid_at ? ' le ' + esc(fmtDate(l.paid_at)) : ''}${l.supplier ? ' à ' + esc(l.supplier) : ''}</td><td class="n">${eur2(l.amount)}</td></tr>`).join('')
      || (todo.length ? '' : `<tr><td class="m" colspan="2">Versement pas encore effectué.</td></tr>`)}
    ${todo.map(l => `<tr><td>À verser${l.supplier ? ' à ' + esc(l.supplier) : ''}</td><td class="n">${eur2(l.amount)}</td></tr>`).join('')}
  </tbody></table>
  ${exp.some(l => l.amount == null) ? '<p class="m">« (prévu) » : montant estimé, la pièce n’est pas encore arrivée.</p>' : ''}
  <footer>L’ArtBoristerie Productions · établi le ${esc(fmtDate(new Date().toLocaleDateString('sv-SE')))}</footer>
</main></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Autorise les fenêtres pop-up pour exporter le budget (icône dans la barre d’adresse), puis recommence.', true);
  w.document.open(); w.document.write(html); w.document.close();
  w.document.getElementById?.('print-btn')?.addEventListener('click', () => w.print());   // pas de gestionnaire en ligne (politique de sécurité, v1.47)
}
