/**
 * 📎 Glisser-déposer partout : un fichier lâché à côté d'un bouton « Ajouter un fichier »
 * (dans le même bloc, champ, fenêtre…) est envoyé à ce bouton, comme si on l'avait choisi.
 * Les zones qui ont déjà leur propre glisser-déposer (pièces jointes des suivis, photo, import) ne sont pas touchées.
 */
const OWN = '[data-drop],[data-drop-form],[data-members-drop],[data-photo-drop]';
// on remonte jusqu'au premier de ces blocs au plus : le fichier va au bouton le plus proche
const STOP = 'dialog, .panel, section, form, .suivi-block';

// Une pièce jointe glissée depuis Mail (Mac) n'annonce pas toujours « Files » pendant le glisser :
// dans la fenêtre de préparation d'un mail, on accepte tout ce qui est lâché et on regarde au moment du dépôt
const MAILBOX = '.mail-wrap';
const hasFiles = e => e.dataTransfer?.types?.includes('Files') || !!e.target?.closest?.(MAILBOX) && [...(e.dataTransfer?.types || [])].some(t => !/^text\/(plain|html)$/.test(t));
const droppedFiles = e => { const f = [...(e.dataTransfer?.files || [])]; if (f.length) return f;
  return [...(e.dataTransfer?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean); };

function inputFor(target){
  if (!target?.closest || target.closest(OWN)) return null;
  for (let el = target; el && el !== document.body; el = el.parentElement){
    const inp = el.matches?.('input[type=file]') ? el : el.querySelector?.('input[type=file]:not([disabled])');
    if (inp) return {inp, zone: el};
    if (el.matches?.(STOP)) break;
  }
  return null;
}

let lit = null;
const light = z => { if (lit === z) return; lit?.classList.remove('drop-over'); lit = z; z?.classList.add('drop-over'); };

document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  const f = inputFor(e.target);
  light(f?.zone || null);
  if (f){ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
});
document.addEventListener('dragleave', e => { if (lit && !lit.contains(e.relatedTarget)) light(null); });
document.addEventListener('drop', e => {
  light(null);
  if (!hasFiles(e)) return;
  const f = inputFor(e.target); if (!f) return;
  e.preventDefault();
  const files = droppedFiles(e);
  if (!files.length){ if (e.target.closest?.(MAILBOX)) import('../utils.js').then(u => u.toast('Rien à joindre : glisse la pièce jointe elle-même (son icône) depuis Mail', true)); return; }
  const dt = new DataTransfer();
  (f.inp.multiple ? files : files.slice(0, 1)).forEach(x => dt.items.add(x));
  f.inp.files = dt.files;
  f.inp.dispatchEvent(new Event('change', {bubbles: true}));
});
// Un fichier lâché ailleurs ne doit pas ouvrir le fichier dans l'onglet
document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', e => { if (hasFiles(e) && !e.defaultPrevented) e.preventDefault(); });
