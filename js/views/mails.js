/**
 * Onglet Mails (v1.61) : boîte anthony@ — boîte de réception, non lus, « À rattacher », libellés Gmail, recherche ; lecture d'une
 * conversation, rattachement (structure, suivi, artiste, date), réponse, rangement, relance. Gmail reste la référence.
 */
import { ARCHIVED, LINK_LABEL, M, MAILBOX_ADDR, checkOwner, linkState, candidates, fmtSize, labelName, loadLabels, syncState, threadsShown, userLabels } from '../mailbox.js';
import { byId, projName, prospectTitle, structName } from '../selectors.js';
import { S } from '../state.js';
import { viewHead } from '../ui/bits.js';
import { esc, fmtDate } from '../utils.js';

const when = iso => { if (!iso) return ''; const d = new Date(iso);
  return d.toLocaleString('fr-FR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'}).replace(' ', ' à '); };
/**
 * Document du cadre de lecture : aucun script (sandbox sans allow-scripts) ET aucune ressource distante (politique de sécurité du
 * document : images, polices, feuilles de style externes bloquées — pixels de suivi compris). Images intégrées au mail (data:) seules,
 * sauf « Afficher les images » demandé explicitement pour ce message. Liens ouverts dans un nouvel onglet.
 */
export function frameDoc(html, remoteImages = false){
  const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${remoteImages ? ' https:' : ''}; form-action 'none'; base-uri 'none'`;
  const clean = String(html || '').replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, '')   // en plus du cadre sans script : retirés d'avance
    .replace(/<(a|area)(\s|>)/gi, '<$1 rel="noopener noreferrer"$2');   // liens : ni accès à la page d'origine, ni adresse de provenance
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank">${clean}`;
}
const hasRemote = html => /<img[^>]+src\s*=\s*["']?\s*(https?:)?\/\//i.test(html || '') || /url\(\s*["']?\s*(https?:)?\/\//i.test(html || '');
const HIDDEN_LABELS = /^(CATEGORY_|CHAT$|DRAFT$|UNREAD$|IMPORTANT$|STARRED$|SENT$|INBOX$|SPAM$|TRASH$)/;

/** Dernière synchronisation et erreur (toujours visibles) ; jamais « à jour » si le dernier passage a échoué */
function syncLine(){
  const st = syncState();
  if (!st) return '<span class="muted">Jamais synchronisée : « Actualiser » pour lancer la première synchronisation.</span>';
  return `<span class="muted">Dernière synchronisation réussie : ${st.last_ok_at ? esc(when(st.last_ok_at)) : 'aucune'}</span>`
    + (st.last_error ? ` <span class="mail-err" role="alert">Erreur au dernier passage (${esc(when(st.last_run_at))}) : ${esc(st.last_error)}</span>` : '');
}

const linkBadge = t => { const k = linkState(t); return `<span class="badge mail-link mail-${k}">${esc(LINK_LABEL[k] || k)}</span>`; };
const ctxText = t => [structName(t.structure_id), t.prospect_id ? 'suivi' : '', t.project_id ? projName(t.project_id) : '', t.show_id ? fmtDate(byId('shows', t.show_id)?.date) : ''].filter(Boolean).join(' · ');

function list(){
  const rows = threadsShown();
  if (!rows.length) return `<div class="empty panel">${M.filter === 'link' ? 'Aucune conversation à rattacher.' : 'Aucune conversation ici.'}${S.db.mail_threads.length ? '' : ' La messagerie se remplit à la première synchronisation.'}</div>`;
  // (v1.63) liste accessible : chaque ligne est un élément de liste qui CONTIENT un bouton (le bouton garde son rôle)
  return `<div class="panel mail-list" role="list">${rows.map(t => `<div role="listitem" class="mail-li"><button type="button" class="mail-row ${t.unread ? 'unread' : ''}" data-act="mailOpen" data-id="${t.id}">
      <span class="mail-who">${esc((t.participants || []).slice(0, 3).join(', ') || '—')}${t.message_count > 1 ? ` <span class="count">${t.message_count}</span>` : ''}</span>
      <span class="mail-subj"><b>${esc(t.subject || '(sans objet)')}</b> <span class="muted">${esc(t.snippet || '')}</span></span>
      <span class="mail-meta">${linkBadge(t)}${t.structure_id ? ` <span class="muted">${esc(ctxText(t))}</span>` : ''}
        ${(t.labels || []).filter(l => !HIDDEN_LABELS.test(l)).map(l => `<span class="badge tag">${esc(labelName(l))}</span>`).join('')}</span>
      <span class="mail-date muted">${esc(when(t.last_message_at))}</span></button></div>`).join('')}</div>`;
}

function reader(){
  const row = byId('mail_threads', M.open); if (!row) return '<div class="empty panel">Conversation introuvable.</div>';
  const th = M.thread, c = candidates(row), inInbox = (row.labels || []).includes('INBOX'), inTrash = (row.labels || []).includes('TRASH');
  const bar = `<div class="mail-actions">
    <button class="btn sm" data-act="mailBack">← Liste</button>
    <button class="btn sm primary" data-act="mailCompose" data-mode="reply">Répondre</button>
    <button class="btn sm" data-act="mailCompose" data-mode="reply_all">Répondre à tous</button>
    <button class="btn sm" data-act="mailCompose" data-mode="forward">Transférer</button>
    <span class="spacer"></span>
    <button class="btn sm" data-act="mailLabel">Libellés</button>
    ${inTrash ? '' : inInbox ? '<button class="btn sm" data-act="mailArchive">Archiver</button>' : '<button class="btn sm" data-act="mailInbox">Remettre en boîte de réception</button>'}
    <button class="btn sm" data-act="mailUnread">Marquer non lu</button>
    ${inTrash ? '<button class="btn sm" data-act="mailUntrash">Retirer de la corbeille</button>' : '<button class="btn sm ghost danger" data-act="mailTrash">Corbeille</button>'}</div>`;
  const link = `<div class="panel pad mail-linkbox">${linkBadge(row)} ${row.link_reason ? `<span class="muted">${esc(row.link_reason)}</span>` : ''}
    ${row.structure_id ? `<p>Structure : <b>${esc(structName(row.structure_id))}</b>${row.prospect_id ? ` · Suivi : <b>${esc(prospectTitle(byId('prospects', row.prospect_id) || {}))}</b>` : ''}${row.project_id ? ` · Artiste : ${esc(projName(row.project_id))}` : ''}${row.show_id ? ` · Date : ${fmtDate(byId('shows', row.show_id)?.date)}` : ''}</p>` : ''}
    ${!row.structure_id && c.structures.length > 1 ? `<p class="muted">Structures possibles : ${c.structures.map(s => esc(s.name)).join(', ')} — « Rattacher » pour choisir.</p>` : ''}
    ${inTrash ? '<p class="muted">Dans la corbeille de Gmail (récupérable 30 jours) ; le journal du suivi est gardé.</p>' : !inInbox ? '<p class="muted">Archivée : hors boîte de réception, toujours dans Gmail (« Tous les messages ») et ses libellés.</p>' : ''}
    ${!row.structure_id && c.unknown.length ? `<p class="muted">Adresse${c.unknown.length > 1 ? 's' : ''} inconnue${c.unknown.length > 1 ? 's' : ''} : ${c.unknown.map(esc).join(', ')}</p>` : ''}
    <button class="btn sm" data-act="mailLink" data-id="${row.id}">${row.structure_id ? 'Corriger le rattachement' : 'Rattacher'}</button>
    ${row.prospect_id ? '<button class="btn sm" data-act="mailRelance">Programmer une relance</button>' : ''}
    ${(row.labels || []).filter(l => !HIDDEN_LABELS.test(l)).map(l => `<span class="badge tag">${esc(labelName(l))}</span>`).join(' ')}</div>`;
  const body = M.loading ? '<div class="empty panel">Lecture de la conversation dans Gmail…</div>'
    : M.error && !th ? `<div class="empty panel mail-err" role="alert">${esc(M.error)}</div>`
    : (th?.messages || []).map(m => `<article class="panel pad mail-msg">
        <header class="mail-msg-head"><b>${esc(m.from?.name || m.from?.email || '')}</b> <span class="muted">&lt;${esc(m.from?.email || '')}&gt;</span>
          ${m.auto === 'ndr' ? '<span class="badge mail-auto-tag">Avis de non-remise</span>' : m.auto === 'auto' ? '<span class="badge mail-auto-tag">Réponse automatique · relances maintenues</span>' : ''}
          <span class="spacer"></span><span class="muted">${esc(when(m.date))}</span></header>
        <p class="muted mail-msg-to">À : ${esc((m.to || []).map(a => a.email).join(', '))}${m.cc?.length ? ` · Copie : ${esc(m.cc.map(a => a.email).join(', '))}` : ''}</p>
        ${hasRemote(m.html) ? `<p class="muted mail-img-note">Images distantes bloquées (elles peuvent signaler l’ouverture du mail à l’expéditeur).
          ${M.images.has(m.id) ? '<b>Affichées pour ce message.</b>' : `<button class="btn sm ghost" data-act="mailImages" data-msg="${esc(m.id)}">Afficher les images</button>`}</p>` : ''}
        <iframe class="mail-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="Message de ${esc(m.from?.email || '')}" srcdoc="${esc(frameDoc(m.html, M.images.has(m.id)))}"></iframe>
        ${m.attachments?.some(a => !a.inline) ? `<div class="ml-att">${m.attachments.map((a, i) => a.inline ? '' : `<span class="att-chip">📎 ${esc(a.name)} <span class="muted">${fmtSize(a.size)}</span>
          <button class="btn sm ghost" data-act="mailAttPreview" data-msg="${esc(m.id)}" data-i="${i}">Ouvrir</button>
          <button class="btn sm ghost" data-act="mailAttKeep" data-msg="${esc(m.id)}" data-i="${i}">Conserver…</button></span>`).join('')}</div>` : ''}
        <div class="mail-actions"><button class="btn sm ghost" data-act="mailCompose" data-mode="reply" data-msg="${esc(m.id)}">Répondre à ce message</button></div>
      </article>`).join('');
  return `${bar}<h2 class="mail-title">${esc(row.subject || '(sans objet)')}</h2>${link}${body}`;
}

export function viewMails(){
  // boîte réservée au compte d'Anthony (contrôle réel : serveur) ; les autres comptes voient pourquoi la liste est vide
  if (M.owner === undefined){ checkOwner().then(() => { if (S.view === 'mails') import('../app.js').then(a => a.render()); });
    return viewHead('Mails', {sub: esc(MAILBOX_ADDR())}) + '<div class="empty panel">Vérification de l’accès à la boîte…</div>'; }
  if (!M.owner) return viewHead('Mails', {sub: esc(MAILBOX_ADDR())})
    + '<div class="empty panel">La boîte anthony@ est réservée au compte d’Anthony. Les mails rattachés à un suivi restent dans le journal de ce suivi.</div>';
  if (M.labels == null) loadLabels().then(() => { if (S.view === 'mails') import('../app.js').then(a => a.render()); });
  const n = k => k === 'inbox' ? S.db.mail_threads.filter(t => (t.labels || []).includes('INBOX')).length
    : k === 'unread' ? S.db.mail_threads.filter(t => t.unread).length : S.db.mail_threads.filter(t => t.link_status === 'a_rattacher' && !(t.labels || []).includes('SPAM') && !(t.labels || []).includes('TRASH')).length;
  const tab = (k, l) => `<button class="subtab" role="tab" data-act="mailFilter" data-f="${k}" aria-selected="${M.filter === k}">${l} <span class="count">${n(k)}</span></button>`;
  const filters = `<nav class="subtabs" role="tablist">${tab('inbox', 'Boîte de réception')}${tab('unread', 'Non lus')}${tab('link', 'À rattacher')}
      ${M.filter === 'search' ? '<button class="subtab" role="tab" aria-selected="true">Résultats Gmail</button>' : ''}</nav>
    <div class="filters"><select class="sel" data-change="mailLabelPick" aria-label="Libellé Gmail"><option value="">Libellé…</option>
      ${userLabels().map(l => `<option value="${esc(l.id)}" ${M.filter === 'label' && M.label === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
      <option value="SENT" ${M.label === 'SENT' ? 'selected' : ''}>Envoyés</option><option value="${ARCHIVED}" ${M.label === ARCHIVED ? 'selected' : ''}>Archivés</option><option value="TRASH" ${M.label === 'TRASH' ? 'selected' : ''}>Corbeille</option></select>
      <input class="search" type="search" autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche-mails" placeholder="Objet, adresse, structure…" data-search="mails" value="${esc(S.search.mails || '')}">
      <button class="btn sm" data-act="mailSearchGmail" title="Recherche dans tout Gmail (mêmes mots-clés que Gmail : from:, has:attachment…)">Chercher dans Gmail</button></div>`;
  return viewHead('Mails', {sub: `${esc(MAILBOX_ADDR())} · ${syncLine()}`, actions: '<button class="btn" data-act="mailRefresh">Actualiser</button> <button class="btn primary" data-act="mailCompose" data-mode="new">Nouveau mail</button>', filters})
    + (M.open ? reader() : list());
}
