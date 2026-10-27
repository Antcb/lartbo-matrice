/**
 * Commission L'ArtBo d'un artiste : quand on la change (fiche de l'artiste ou fenêtre du projet),
 * ses dates qui sont à un autre % suivent, après confirmation. Une commission saisie à la main sur la facture ne bouge pas.
 */
import { confirmAsk } from './ui/dialog.js';
import { render } from './app.js';
import { isInvoiced, paymentsOf } from './calc.js';
import { save } from './data.js';
import { byId, projectCommission, showsOfProject } from './selectors.js';
import { toast } from './utils.js';

export async function propagateCommission(projectId){
  const p = byId('projects', projectId); if (!p) return;
  const v = projectCommission(p);
  const list = showsOfProject(projectId).filter(s => Number(s.artbo_pct) !== v
    && !paymentsOf(s.id).some(x => x.kind === 'artbo' && ((x.pct != null && x.pct !== '') || (x.amount != null && x.amount !== '') || isInvoiced(x))));   // commission saisie à la main, facturée ou déjà versée : on n'y touche pas
  if (!list.length) return;
  const name = (p.name || '').replace(/\s*•.*$/, '');
  if (!(await confirmAsk('Changer la commission des dates ?', `Passer aussi à ${String(v).replace('.', ',')} % la commission des ${list.length} date${list.length > 1 ? 's' : ''} de ${name} qui ${list.length > 1 ? 'sont' : 'est'} à un autre % ?\nLes commissions saisies à la main, facturées ou déjà versées ne changent pas.`, `Passer ${list.length > 1 ? 'les ' + list.length + ' dates' : 'la date'} à ${String(v).replace('.', ',')} %`))) return;
  let ok = 0; for (const s of list) if (await save('shows', s.id, {artbo_pct: v}, {rerender: false})) ok++;
  render();
  if (ok === list.length) toast(`Commission à ${String(v).replace('.', ',')} % sur ${ok} date${ok > 1 ? 's' : ''} de ${name}`);
  else toast(`Commission changée sur ${ok} date${ok > 1 ? 's' : ''} sur ${list.length} : les autres n’ont pas changé (facture déjà émise, ou enregistrement impossible)`, true);
}
