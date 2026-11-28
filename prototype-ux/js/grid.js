// MATRICE — prototype : colonnes de tableau personnalisables, composant commun (Booking, Suivi…).
// Largeur (poignée, flèches du clavier), ordre (menu, glisser-déposer des en-têtes), visibilité, épinglage à gauche, tri par en-tête (optionnel).
// Préférences personnelles : P[pref] = { order, w, hidden, pin }. Un tableau porte data-grid="<p>" ; les actions sont préfixées (<p>Cols, <p>ColMenu…).
(() => {
  'use strict';
  const X = () => window.MX;
  function make({ p, cols, pref, locked = [], defPin = [], onSort = null, sortable = [] }){
    const colDef = k => cols.find(c => c.k === k);
    const def = () => ({ order: cols.map(c => c.k), w: {}, hidden: cols.filter(c => c.hidden).map(c => c.k), pin: [...defPin] });
    const lay = () => { const L = X().P[pref] && Array.isArray(X().P[pref].order) ? X().P[pref] : def();
      const order = [...L.order.filter(colDef), ...cols.map(c => c.k).filter(k => !L.order.includes(k))];
      return { order, w: L.w || {}, hidden: (L.hidden || []).filter(colDef), pin: (L.pin || []).filter(colDef) }; };
    const setLay = L => { X().P[pref] = L; X().save(); };
    const isDefault = () => X().same(lay(), def());
    const shown = () => { const L = lay(); const vis = L.order.filter(k => !L.hidden.includes(k)); return [...vis.filter(k => L.pin.includes(k)), ...vis.filter(k => !L.pin.includes(k))]; };
    const widthOf = k => lay().w[k] || colDef(k).w;
    const cls = k => `c-${k} ${colDef(k).num ? 'num' : ''} ${lay().pin.includes(k) ? 'pin' : ''}`;
    const sel = `.bkt[data-grid="${p}"]`;
    const rr = f => { X().renderMain(); if (f) X().$(f)?.focus(); };

    // En-tête : libellé (bouton de tri si la colonne est triable), menu de la colonne, poignée de largeur
    function head({ sort = null } = {}){
      const { esc, icon } = X(), L = lay(), ks = shown();
      return `<colgroup>${ks.map(k => `<col data-col="${k}">`).join('')}</colgroup><thead><tr>${ks.map(k => { const c = colDef(k), pin = L.pin.includes(k), s = sort && sort.key === k ? sort.dir : null, can = sortable.includes(k);
        const label = `${pin ? icon('pin', 'sm') : ''}${esc(c.l)}`;
        return `<th scope="col" class="${cls(k)}" data-col="${k}" draggable="true" ${can ? `aria-sort="${s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : 'none'}"` : ''} aria-label="${esc(c.l)}${pin ? ' (épinglée)' : ''}">
          <span class="th-in">${can ? `<button class="th-l th-sort ${s ? 'on' : ''}" type="button" data-act="${p}Sort" data-col="${k}" title="Trier par ${esc(c.l.toLowerCase())}">${label}<span class="th-dir" aria-hidden="true">${icon(s === 'asc' ? 'arrow-up' : 'arrow-down', 'sm')}</span></button>` : `<span class="th-l">${label}</span>`}
          <button class="th-m" type="button" data-act="${p}ColMenu" data-col="${k}" aria-label="Options de la colonne ${esc(c.l)}">${icon('ellipsis', 'sm')}</button></span>
          <span class="rs" role="separator" aria-orientation="vertical" tabindex="0" data-rs="${k}" aria-label="Largeur de la colonne ${esc(c.l)}" aria-valuenow="${widthOf(k)}" aria-valuemin="64" aria-valuemax="480"></span></th>`; }).join('')}</tr></thead>`;
    }
    const colsBtn = () => `<button class="btn sm" type="button" data-act="${p}Cols" aria-haspopup="dialog">${X().icon('table-2', 'sm')}Colonnes${isDefault() ? '' : '<span class="dot" aria-label="personnalisées"></span>'}</button>`;
    function colsPop(btn){
      const { esc, icon, openPop, defTag } = X(), L = lay();
      openPop(btn, `<div class="pop-head"><b>Colonnes</b>${defTag(isDefault())}</div><ul class="col-list">${L.order.map((k, i) => { const c = colDef(k), on = !L.hidden.includes(k), pin = L.pin.includes(k);
        return `<li><label class="chk"><input type="checkbox" data-${p}col="${k}" ${on ? 'checked' : ''} ${locked.includes(k) ? 'disabled' : ''}><span>${esc(c.l)}</span></label>
          <button class="btn ghost sm icon" type="button" data-act="${p}ColMove" data-col="${k}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Déplacer ${esc(c.l)} vers la gauche">${icon('arrow-up', 'sm')}</button>
          <button class="btn ghost sm icon" type="button" data-act="${p}ColMove" data-col="${k}" data-d="1" ${i === L.order.length - 1 ? 'disabled' : ''} aria-label="Déplacer ${esc(c.l)} vers la droite">${icon('arrow-down', 'sm')}</button>
          <button class="btn ghost sm icon ${pin ? 'on' : ''}" type="button" data-act="${p}ColPin" data-col="${k}" aria-pressed="${pin}" aria-label="${pin ? 'Désépingler' : 'Épingler'} ${esc(c.l)}">${icon('pin', 'sm')}</button></li>`; }).join('')}</ul>
        <p class="hint">Glisser un en-tête pour le déplacer, tirer son bord pour la largeur (flèches au clavier).</p>
        <div class="pop-foot"><button class="btn sm" type="button" data-act="${p}ColReset" ${isDefault() ? 'disabled' : ''}>${icon('rotate-ccw', 'sm')}Colonnes par défaut</button></div>`, { label: 'Colonnes', cls: `bk-pop bk-colpop ${p}-colpop` });
    }
    function colMenu(btn, k){
      const { esc, icon, openPop } = X(), L = lay(), i = shown().indexOf(k), c = colDef(k), pin = L.pin.includes(k);
      openPop(btn, `<p class="eyebrow">${esc(c.l)}</p><div class="menu">
        ${sortable.includes(k) ? `<button type="button" data-act="${p}Sort" data-col="${k}" data-dir="asc">${icon('arrow-up', 'sm')}Trier ${esc(c.asc || 'croissant')}</button><button type="button" data-act="${p}Sort" data-col="${k}" data-dir="desc">${icon('arrow-down', 'sm')}Trier ${esc(c.desc || 'décroissant')}</button>` : ''}
        <button type="button" data-act="${p}ColPin" data-col="${k}">${icon('pin', 'sm')}${pin ? 'Désépingler' : 'Épingler à gauche'}</button>
        <button type="button" data-act="${p}ColShift" data-col="${k}" data-d="-1" ${i <= 0 ? 'disabled' : ''}>${icon('arrow-left', 'sm')}Déplacer à gauche</button>
        <button type="button" data-act="${p}ColShift" data-col="${k}" data-d="1" ${i >= shown().length - 1 ? 'disabled' : ''}>${icon('arrow-right', 'sm')}Déplacer à droite</button>
        <button type="button" data-act="${p}ColWidth" data-col="${k}">${icon('rotate-ccw', 'sm')}Largeur par défaut</button>
        ${locked.includes(k) ? '' : `<button type="button" data-act="${p}ColHide" data-col="${k}">${icon('eye-off', 'sm')}Masquer la colonne</button>`}</div>`, { label: `Colonne ${c.l}`, cls: 'bk-pop' });
    }
    const moveCol = (k, d) => { const L = lay(), vis = shown(), j = vis.indexOf(k) + d; if (j < 0 || j >= vis.length) return;
      const other = vis[j], o = L.order.filter(x => x !== k); o.splice(o.indexOf(other) + (d > 0 ? 1 : 0), 0, k); L.order = o; setLay(L); };
    // la fenêtre « Colonnes » reste ouverte après un réglage (focus conservé sur la commande utilisée)
    function reopen(b, k){
      const inCols = !!b.closest(`.${p}-colpop`); X().closePop(); X().renderMain();
      if (inCols){ colsPop(X().$(`[data-act="${p}Cols"]`)); X().$(`.${p}-colpop [data-act="${b.dataset.act}"][data-col="${k}"]${b.dataset.d ? `[data-d="${b.dataset.d}"]` : ''}`)?.focus(); }
      else X().$(`${sel} th[data-col="${k}"] .th-m`)?.focus();
    }
    const toggle = b => X().$('.pop')?._from === b;
    const acts = {
      [p + 'Cols']: b => { if (toggle(b)){ X().closePop(); return; } colsPop(b); },
      [p + 'ColMenu']: b => { if (toggle(b)){ X().closePop(); return; } colMenu(b, b.dataset.col); },
      [p + 'ColPin']: b => { const k = b.dataset.col, L = lay(); L.pin = L.pin.includes(k) ? L.pin.filter(x => x !== k) : [...L.pin, k]; setLay(L); reopen(b, k); },
      [p + 'ColMove']: b => { const L = lay(), k = b.dataset.col, i = L.order.indexOf(k), j = i + Number(b.dataset.d); if (j < 0 || j >= L.order.length) return; [L.order[i], L.order[j]] = [L.order[j], L.order[i]]; setLay(L); reopen(b, k); },
      [p + 'ColShift']: b => { moveCol(b.dataset.col, Number(b.dataset.d)); X().closePop(); rr(`${sel} th[data-col="${b.dataset.col}"] .th-m`); },
      [p + 'ColHide']: b => { const L = lay(); L.hidden = [...L.hidden, b.dataset.col]; setLay(L); X().closePop(); rr(`[data-act="${p}Cols"]`); X().toast(`Colonne « ${colDef(b.dataset.col).l} » masquée — Colonnes pour la réafficher`); },
      [p + 'ColWidth']: b => { const L = lay(); delete L.w[b.dataset.col]; setLay(L); X().closePop(); rr(`${sel} th[data-col="${b.dataset.col}"] .th-m`); },
      [p + 'ColReset']: () => { X().P[pref] = null; X().save(); X().closePop(); rr(`[data-act="${p}Cols"]`); X().toast('Colonnes par défaut rétablies'); },
      [p + 'Sort']: b => { X().closePop(); onSort?.(b.dataset.col, b.dataset.dir || null); rr(`${sel} th[data-col="${b.dataset.col}"] .th-sort`); },
    };
    function change(t){
      const k = t.dataset?.[p + 'col']; if (!k) return false;
      const L = lay(); L.hidden = t.checked ? L.hidden.filter(x => x !== k) : [...L.hidden, k]; setLay(L);
      X().closePop(); X().renderMain(); colsPop(X().$(`[data-act="${p}Cols"]`)); X().$(`.${p}-colpop [data-${p}col="${k}"]`)?.focus(); return true;
    }
    function keydown(e){
      const t = e.target; if (!t.dataset?.rs || !t.closest(sel) || !['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return false;
      e.preventDefault(); const k = t.dataset.rs, L = lay();
      if (e.key === 'Home') delete L.w[k]; else L.w[k] = Math.max(64, Math.min(480, widthOf(k) + (e.key === 'ArrowRight' ? 16 : -16)));
      setLay(L); rr(`${sel} [data-rs="${k}"]`); return true;
    }
    // largeurs, colonnes épinglées (décalage, ombre au défilement) : JS, aucune valeur de style dans le HTML
    function after(main){
      const tbl = X().$(sel, main); if (!tbl) return; const L = lay(), ks = shown();
      X().$$('col[data-col]', tbl).forEach(c => { c.style.width = widthOf(c.dataset.col) + 'px'; });
      tbl.style.width = ks.reduce((a, k) => a + widthOf(k), 0) + 'px';
      let left = 0; ks.filter(k => L.pin.includes(k)).forEach((k, i, arr) => { X().$$(`.c-${k}.pin`, tbl).forEach(el => { el.style.left = left + 'px'; el.classList.toggle('pin-last', i === arr.length - 1); }); left += widthOf(k); });
      const tw = tbl.closest('.bk-tw'); if (tw){ const upd = () => tw.classList.toggle('scrolled', tw.scrollLeft > 0); tw.addEventListener('scroll', upd, { passive: true }); upd(); }
    }
    // redimensionnement à la souris / au doigt
    document.addEventListener('pointerdown', e => {
      const h = e.target.closest?.(`${sel} .rs`); if (!h || e.button !== 0) return; e.preventDefault();
      const k = h.dataset.rs, x0 = e.clientX, w0 = widthOf(k), tbl = h.closest(sel), col = X().$(`col[data-col="${k}"]`, tbl), tw0 = tbl.offsetWidth;
      h.setPointerCapture(e.pointerId); h.classList.add('drag');
      const mv = ev => { const w = Math.max(64, Math.min(480, w0 + ev.clientX - x0)); col.style.width = w + 'px'; tbl.style.width = (tw0 + w - w0) + 'px'; h.setAttribute('aria-valuenow', w); };
      const up = ev => { h.removeEventListener('pointermove', mv); h.classList.remove('drag'); const L = lay(); L.w[k] = Math.max(64, Math.min(480, w0 + ev.clientX - x0)); setLay(L); rr(`${sel} [data-rs="${k}"]`); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up, { once: true });
    });
    // réorganisation par glisser-déposer des en-têtes (même groupe : épinglées / non épinglées)
    let dragK = null;
    document.addEventListener('dragstart', e => { const th = e.target.closest?.(`${sel} th[data-col]`); if (!th) return; dragK = th.dataset.col; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragK); th.classList.add('dragging'); });
    document.addEventListener('dragover', e => { const th = e.target.closest?.(`${sel} th[data-col]`); if (!th || !dragK) return; e.preventDefault();
      const r = th.getBoundingClientRect(), right = e.clientX > r.left + r.width / 2; X().$$(`${sel} th`).forEach(x => x.classList.remove('drop-l', 'drop-r')); if (th.dataset.col !== dragK) th.classList.add(right ? 'drop-r' : 'drop-l'); });
    document.addEventListener('drop', e => { const th = e.target.closest?.(`${sel} th[data-col]`); if (!th || !dragK) return; e.preventDefault();
      const k = th.dataset.col, L = lay(); if (k !== dragK && L.pin.includes(k) === L.pin.includes(dragK)){ const right = th.classList.contains('drop-r'); const o = L.order.filter(x => x !== dragK); o.splice(o.indexOf(k) + (right ? 1 : 0), 0, dragK); L.order = o; setLay(L); }
      dragK = null; X().renderMain(); });
    document.addEventListener('dragend', () => { dragK = null; X()?.$$?.(`${sel} th`).forEach(x => x.classList.remove('dragging', 'drop-l', 'drop-r')); });
    return { lay, setLay, isDefault, shown, widthOf, colDef, cls, head, colsBtn, colsPop, acts, change, keydown, after };
  }
  window.MX_GRID = { make };
})();
