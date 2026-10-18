/**
 * ⌨️ Raccourcis clavier d'écriture, partout sur le site (Cmd sur Mac, Ctrl sur PC) :
 *   Cmd+B gras · Cmd+I italique · Cmd+U souligné (éditeurs de mail) · Cmd+K lien · Cmd+Entrée enregistrer.
 * Dans les éditeurs de mail (texte mis en forme) la mise en forme est directe ;
 * dans les zones de notes et le journal, elle s'écrit en **gras**, _italique_ et [texte](lien), affichés mis en forme.
 */
function wrap(ta, before, after = before, placeholder = 'texte'){
  const {selectionStart: a, selectionEnd: z, value} = ta;
  const sel = value.slice(a, z) || placeholder;
  // déjà entouré → on retire
  if (value.slice(a - before.length, a) === before && value.slice(z, z + after.length) === after){
    ta.setRangeText(sel, a - before.length, z + after.length, 'select');
  } else {
    ta.setRangeText(before + sel + after, a, z, 'end');
    ta.setSelectionRange(a + before.length, a + before.length + sel.length);
  }
  ta.dispatchEvent(new Event('input', {bubbles: true}));
}

function askUrl(){
  const u = prompt('Adresse du lien (https://…)');
  if (!u) return null;
  return /^(https?:|mailto:)/i.test(u.trim()) ? u.trim() : 'https://' + u.trim();
}

document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const t = e.target, k = e.key.toLowerCase();
  const rich = t.isContentEditable, ta = t.tagName === 'TEXTAREA';
  if (!rich && !ta) return;
  if (k === 'enter'){   // Cmd+Entrée : enregistre le formulaire en cours (journal, fiche…)
    const form = t.closest('form'); if (form){ e.preventDefault(); form.requestSubmit(); }
    return;
  }
  if (!['b', 'i', 'u', 'k'].includes(k)) return;
  e.preventDefault();
  if (rich){
    if (k === 'k'){
      const bar = t.id && document.querySelector(`.rt-bar[data-rt-for="${CSS.escape(t.id)}"]`);
      if (bar){ bar.querySelector('[data-rt="link"]').click(); return; }
      const u = askUrl(); if (u) document.execCommand('createLink', false, u); }
    else document.execCommand({b: 'bold', i: 'italic', u: 'underline'}[k]);
    t.dispatchEvent(new Event('input', {bubbles: true}));
    return;
  }
  if (k === 'b') wrap(t, '**');
  else if (k === 'i') wrap(t, '_');
  else if (k === 'k'){
    const u = askUrl(); if (!u) return;
    const {selectionStart: a, selectionEnd: z, value} = t;
    t.setRangeText(`[${value.slice(a, z) || 'lien'}](${u})`, a, z, 'end');
    t.dispatchEvent(new Event('input', {bubbles: true}));
  }
});
