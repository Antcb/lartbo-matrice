/**
 * 📎 Choix de fichier présentable sur les pages publiques (fiche artiste, fiche salarié) :
 * le bouton natif « Choose Files / No file chosen » (en anglais, mal aligné) est remplacé par
 * un bouton « Choisir un fichier » et le nom du fichier choisi, bien centrés. Le glisser-déposer marche toujours.
 */
const plural = (n, multi) => n ? (n === 1 ? null : `${n} fichiers`) : (multi ? 'Aucun fichier' : 'Aucun fichier');

function enhance(input){
  if (input.dataset.fp) return; input.dataset.fp = '1';
  const multi = input.multiple;
  const box = document.createElement('span'); box.className = 'fp';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fp-btn'; // dans une case étroite (Titre 1, Logo 2…) : bouton court, le nom du fichier garde la place
  btn.textContent = input.closest('.doc-slot') ? 'Choisir' : multi ? 'Choisir des fichiers' : 'Choisir un fichier';
  const name = document.createElement('span'); name.className = 'fp-name'; name.textContent = 'Aucun fichier';
  input.parentNode.insertBefore(box, input);
  box.append(input, btn, name);
  input.classList.add('fp-input');
  btn.addEventListener('click', e => { e.preventDefault(); input.click(); });
  const show = () => { const f = [...input.files]; name.textContent = plural(f.length, multi) || f[0].name; name.title = f.map(x => x.name).join('\n');
    box.classList.toggle('has', f.length > 0); };
  input.addEventListener('change', show);
}
const scan = root => root.querySelectorAll?.('input[type=file]').forEach(enhance);
scan(document);
new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && (n.matches?.('input[type=file]') ? enhance(n) : scan(n)))))
  .observe(document.body, {childList: true, subtree: true});
