/**
 * Commission L'ArtBo d'un artiste : quand on la change (fiche de l'artiste ou fenêtre du projet),
 * ses dates qui sont à un autre % suivent, après confirmation. Une commission saisie à la main sur la facture ne bouge pas.
 */
import { render } from './app.js';
import { paymentsOf } from './calc.js';
import { save } from './data.js';
import { byId, projectCommission, showsOfProject } from './selectors.js';
import { toast } from './utils.js';

export async function propagateCommission(projectId){
  const p = byId('projects', projectId); if (!p) return;
  const v = projectCommission(p);
  const list = showsOfProject(projectId).filter(s => Number(s.artbo_pct) !== v
    && !paymentsOf(s.id).some(x => x.kind === 'artbo' && ((x.pct != null && x.pct !== '') || (x.amount != null && x.amount !== ''))));
  if (!list.length) return;
  const name = (p.name || '').replace(/\s*•.*$/, '');
  if (!confirm(`Passer aussi à ${String(v).replace('.', ',')} % la commission des ${list.length} date${list.length > 1 ? 's' : ''} de ${name} qui ${list.length > 1 ? 'sont' : 'est'} à un autre % ?`)) return;
  for (const s of list) await save('shows', s.id, {artbo_pct: v}, {rerender: false});
  render();
  toast(`Commission à ${String(v).replace('.', ',')} % sur ${list.length} date${list.length > 1 ? 's' : ''} de ${name}`);
}
