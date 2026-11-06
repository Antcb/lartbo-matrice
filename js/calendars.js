/**
 * 📅 Calendriers Google des artistes — LECTURE SEULE (Google → L'ArtBotrice ; rien n'est jamais écrit dans un agenda).
 * Décisions d'Anthony du 06/11/2026 :
 *   - un agenda par artiste, choisi explicitement (agendas partagés avec production@) ; suspendre / déconnecter ; dernière
 *     synchronisation et erreurs affichées ; accès perdu ou synchronisation en échec → « disponibilités plus à jour », jamais « libre » ;
 *   - booking : événements = indisponibilités, affichées à part (origine Google) ; « Disponible » ne bloque pas ; chevauchement avec une
 *     option ou une date → avertissement, poursuite possible après confirmation ; événement privé → « Indisponible » sans détail ;
 *   - carte : titre contenant « show » + lieu reconnu comme ville → repère « Date artiste — calendrier Google » ; sinon
 *     « localisation à préciser », jamais de repère approximatif ; jamais compté dans les chiffres (ce ne sont pas des dates) ;
 *   - dates « Option / Confirmée Artiste » existantes : jamais converties ; association explicite proposée (pas de double affichage).
 */
import { render } from './app.js';
import { insert, save, sb } from './data.js';
import { byId, projName } from './selectors.js';
import { S } from './state.js';
import { ask, confirmAsk, copyText } from './ui/dialog.js';
import { esc, fmtDate, toast } from './utils.js';
import { isOff } from './constants.js';

const STALE_MIN = 30;
/** Pays proposés pour les lieux sans pays écrit (France par défaut, décision du 06/11/2026) — mêmes codes que cal-sync/regles.ts */
export const CAL_COUNTRIES = [['FR', 'France'], ['BE', 'Belgique'], ['CH', 'Suisse'], ['LU', 'Luxembourg'], ['ES', 'Espagne'], ['IT', 'Italie'], ['DE', 'Allemagne'],
  ['PT', 'Portugal'], ['NL', 'Pays-Bas'], ['GB', 'Royaume-Uni'], ['CA', 'Canada'], ['US', 'États-Unis']];   // au-delà de 30 min sans synchronisation réussie (passage toutes les 5 min) : disponibilités plus à jour
export const calOf = projectId => S.db.artist_calendars.find(c => c.project_id === projectId) || null;
/** Jour (AAAA-MM-JJ) d'un instant dans un fuseau (fuseau inconnu ou invalide : Paris) */
const dayIn = (iso, tz) => { if (!iso) return null; try { return new Date(iso).toLocaleDateString('sv-SE', {timeZone: tz || 'Europe/Paris'}); } catch { return new Date(iso).toLocaleDateString('sv-SE', {timeZone: 'Europe/Paris'}); } };
/** Décalage (ms) d'un fuseau à un instant donné */
const offsetAt = (ms, tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; };
/** Minuit d'un jour dans un fuseau, en instant réel (changements d'heure compris) */
export const midnightIn = (day, tz = 'Europe/Paris') => { const [y, m, d] = day.split('-').map(Number), guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetAt(guess, tz); t = guess - offsetAt(t, tz); return t; };
const nextDay = d => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const prevDay = d => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

/** Jours couverts par une occurrence (AAAA-MM-JJ, inclus) : journée entière → fin EXCLUE chez Google ; à l'heure → jours de Paris */
export function evSpan(e){
  // journée(s) entière(s) : dates calendaires telles quelles, sans fuseau (fin exclue chez Google)
  if (e.all_day) return [e.start_date, e.end_date ? prevDay(e.end_date) : e.start_date];
  // à l'heure : jour LOCAL de l'événement (son fuseau) pour l'affichage comme date artiste et sur la carte
  const a = dayIn(e.start_at, e.time_zone), b = dayIn(e.end_at ? new Date(new Date(e.end_at).getTime() - 1).toISOString() : e.start_at, e.time_zone);
  return [a, b < a ? a : b];
}
export function calOverlaps(v){
  if (!v?.project_id || !v.date) return [];
  const a = v.date, b = v.date_end && v.date_end > v.date ? v.date_end : v.date;
  // la date de booking couvre ses journées à Paris ; un événement à l'heure se compare sur ses INSTANTS réels (fuseaux compris),
  // une journée entière sur ses dates calendaires
  const from = midnightIn(a), to = midnightIn(nextDay(b));
  return calEvents([v.project_id]).filter(e => e.busy && !e.show_id && (e.all_day
    ? (([x, y]) => x && x <= b && y >= a)(evSpan(e))
    : e.start_at && new Date(e.start_at).getTime() < to && new Date(e.end_at || e.start_at).getTime() > from));
}

/** Avant d'enregistrer une option / une date : avertissement si l'agenda de l'artiste est occupé (ou plus à jour) ; true = poursuivre */
/** Engagement d'une date : 0 annulée / sans suite, 1 intérêt, 2 option ou confirmée */
const level = st => isOff(st) ? 0 : /^Intérêt/.test(st || '') ? 1 : 2;
export async function calCheckBeforeSave(v, before = null){
  if (!v.project_id || !v.date || isOff(v.status)) return true;
  // même règle sur tous les chemins (fenêtre de date, prospection, statut changé dans la liste) : on avertit quand une date est créée,
  // déplacée, change d'artiste, ou s'engage davantage (annulée → active, intérêt → option / confirmée) ; sinon rien à redemander
  if (before && before.date === v.date && (before.date_end || null) === (v.date_end || null) && before.project_id === v.project_id
      && level(v.status) <= level(before.status)) return true;
  const cal = calOf(v.project_id); if (!cal || cal.status === 'deconnecte') return true;
  const hits = calOverlaps(v), stale = !calFresh(cal);
  if (!hits.length && !stale) return true;
  const lines = hits.slice(0, 6).map(e => { const [x, y] = evSpan(e); return `• ${fmtDate(x)}${y !== x ? ' → ' + fmtDate(y) : ''} : ${evLabel(e)}`; }).join('\n');
  return confirmAsk(hits.length ? 'Artiste indisponible ?' : 'Agenda pas à jour',
    `${hits.length ? `L’agenda Google de ${projName(v.project_id)} indique :\n${lines}\n\n` : ''}${stale ? `Disponibilités plus à jour (${calStatusText(cal)}).\n\n` : ''}Enregistrer quand même ?`, 'Enregistrer quand même');
}

export function calStatusText(cal){
  if (!cal) return 'aucun agenda relié';
  if (cal.status === 'deconnecte') return 'agenda déconnecté';
  if (cal.status === 'pause') return 'synchronisation suspendue';
  if (cal.last_error) return 'erreur : ' + cal.last_error;
  if (!cal.last_ok_at) return 'jamais synchronisé';
  return calFresh(cal) ? 'à jour' : 'dernière synchronisation trop ancienne';
}

/** Cadre « Agenda Google » de la fiche artiste */
export function calPanelHTML(projectId){
  const cal = calOf(projectId);
  if (!cal) return `<div class="cal-panel"><p class="help m0">Aucun agenda relié. L’artiste partage son agenda Google avec production@ (lecture seule), puis tu le choisis ici.</p>
    <button type="button" class="btn sm" data-act="calConnect" data-id="${projectId}">Relier son agenda Google</button></div>`;
  const n = calEvents([projectId]).length, fresh = calFresh(cal);
  return `<div class="cal-panel">
    <p class="m0"><b>${esc(cal.calendar_name || cal.calendar_id)}</b> ${cal.mode === 'disponibilites' ? '<span class="badge">disponibilités seulement</span>' : ''}
      <span class="${fresh ? 'ok-txt' : 'warn-txt'}">${cal.status === 'deconnecte' ? 'déconnecté (événements non affichés)' : fresh ? '✓ à jour' : '⚠︎ disponibilités plus à jour'}</span></p>
    <p class="help m0">Dernière synchronisation réussie : ${cal.last_ok_at ? esc(new Date(cal.last_ok_at).toLocaleString('fr-FR', {timeZone: 'Europe/Paris'})) : 'aucune'} · ${n} événement${n > 1 ? 's' : ''}
      ${cal.last_error ? `<br><span class="warn-txt">Erreur : ${esc(cal.last_error)}</span>` : ''}${cal.status === 'pause' ? '<br>Synchronisation suspendue.' : ''}</p>
    <p class="help m0"><label for="cal-cc-${esc(cal.id)}">Pays des lieux sans pays écrit</label>
      <select id="cal-cc-${esc(cal.id)}" class="sel" data-t="artist_calendars" data-id="${esc(cal.id)}" data-f="default_country">
        ${CAL_COUNTRIES.map(([cc, l]) => `<option value="${cc}" ${cc === (cal.default_country || 'FR') ? 'selected' : ''}>${l}</option>`).join('')}</select>
      — sert à placer les « Show » sur la carte (appliqué à la synchronisation suivante).</p>
    <div class="cal-actions">
      ${cal.status === 'actif' ? `<button type="button" class="btn sm" data-act="calRefresh" data-id="${projectId}">Actualiser</button><button type="button" class="btn sm" data-act="calPause" data-id="${projectId}">Suspendre</button>`
        : `<button type="button" class="btn sm" data-act="calResume" data-id="${projectId}">${cal.status === 'deconnecte' ? 'Reconnecter' : 'Reprendre'}</button>`}
      <button type="button" class="btn sm" data-act="calConnect" data-id="${projectId}">Changer d’agenda</button>
      ${cal.status !== 'deconnecte' ? `<button type="button" class="btn sm ghost danger" data-act="calDisconnect" data-id="${projectId}">Déconnecter</button>` : ''}</div></div>`;
}

async function invoke(body){
  const {data, error} = await sb.functions.invoke('cal-sync', {body});
  const out = data || await error?.context?.json?.().catch(() => null) || {ok: false, error: 'Synchronisation des agendas injoignable pour le moment.'};
  return out;
}
async function reload(){
  const {fetchAll} = await import('./data.js'), {touch} = await import('./state.js');
  for (const t of ['artist_calendars', 'artist_calendar_events']){ S.db[t] = await fetchAll(t); touch(t); }
}

export const CAL_ACTIONS = {
  copyCalendarScript: async () => { try { await copyText(await (await fetch('apps-script/calendrier/Calendrier.gs?v=' + Date.now())).text(), 'Code copié : colle-le dans Code.gs du projet « Matrice Agendas »'); } catch (err) { toast('Copie impossible : ' + err.message, true); } },
  copyCalendarManifest: async () => { try { await copyText(await (await fetch('apps-script/calendrier/appsscript.json?v=' + Date.now())).text(), 'appsscript.json copié : remplace le contenu du manifeste du projet « Matrice Agendas »'); } catch (err) { toast('Copie impossible : ' + err.message, true); } },
  testCalendarScript: async () => { const out = await invoke({mode: 'calendars'}); toast(out.ok ? `Script des agendas OK : ${out.calendars.length} agenda${out.calendars.length > 1 ? 's' : ''} visible${out.calendars.length > 1 ? 's' : ''} par production@` : out.error, !out.ok); },
  /** Choix explicite de l'agenda parmi ceux partagés avec production@ */
  calConnect: async t => {
    const pid = t.dataset.id, out = await invoke({mode: 'calendars'});
    if (!out.ok) return toast(out.error || 'Agendas illisibles', true);
    const taken = new Map(S.db.artist_calendars.filter(c => c.project_id !== pid && c.status !== 'deconnecte').map(c => [c.calendar_id, c.project_id]));
    const list = (out.calendars || []).filter(c => !c.primary);
    if (!list.length) return toast('Aucun agenda partagé avec production@ pour le moment', true);
    const choice = await ask({title: `Agenda de ${projName(pid)}`, text: 'Agendas partagés avec production@ (lecture seule). Choisis celui de cet artiste.',
      actions: list.map(c => ({value: c.id, label: `${c.name}${c.access === 'freeBusyReader' ? ' (disponibilités seulement)' : ''}${taken.has(c.id) ? ` — déjà relié à ${projName(taken.get(c.id))}` : ''}`}))});
    if (choice == null) return;
    if (taken.has(choice)) return toast('Cet agenda est déjà relié à un autre artiste', true);
    const c = list.find(x => x.id === choice), cur = calOf(pid);
    const row = {project_id: pid, calendar_id: c.id, calendar_name: c.name, access: c.access, status: 'actif', last_error: null};
    if (cur){
      if (cur.calendar_id !== c.id && !(await confirmAsk('Changer d’agenda ?', 'Les événements de l’ancien agenda ne seront plus affichés (rien n’est modifié dans Google).', 'Changer'))) return;
      await save('artist_calendars', cur.id, row, {rerender: false});
      if (cur.calendar_id !== c.id){ const {error} = await sb.from('artist_calendar_events').update({deleted_at: new Date().toISOString()}).eq('calendar_ref', cur.id).is('deleted_at', null); if (error) toast(error.message, true); }
    } else if (!(await insert('artist_calendars', row))) return;
    await reload(); render();
    await CAL_ACTIONS.calRefresh({dataset: {id: pid}});
  },
  calRefresh: async t => {
    toast('Lecture de l’agenda dans Google…');
    const out = await invoke({mode: 'sync', project_id: t.dataset.id});
    await reload(); render();
    toast(out.ok ? 'Agenda à jour' : 'Synchronisation : ' + (out.error || 'échec'), !out.ok);
  },
  calPause: async t => { const c = calOf(t.dataset.id); if (c){ await save('artist_calendars', c.id, {status: 'pause'}); toast('Synchronisation suspendue : disponibilités plus à jour'); } },
  calResume: async t => { const c = calOf(t.dataset.id); if (c){ await save('artist_calendars', c.id, {status: 'actif'}); await CAL_ACTIONS.calRefresh(t); } },
  calDisconnect: async t => { const c = calOf(t.dataset.id); if (!c) return;
    if (!(await confirmAsk('Déconnecter l’agenda ?', 'Ses événements ne sont plus lus ni affichés. Rien n’est modifié dans Google ; tu pourras le relier à nouveau.', 'Déconnecter', {danger: true}))) return;
    await save('artist_calendars', c.id, {status: 'deconnecte'}); toast('Agenda déconnecté'); },
  /** Association explicite d'un événement « Show » avec une date « Option / Confirmée Artiste » existante (aucune conversion) */
  calAssociate: async t => {
    const e = byId('artist_calendar_events', t.dataset.id); if (!e) return;
    const [a, b] = evSpan(e);
    const lo = prevDay(a), hi = nextDay(b);   // à un jour près (fin de soirée, fuseau)
    const cands = S.db.shows.filter(s => s.project_id === e.project_id && /Artiste$/.test(s.status || '') && s.date && s.date >= lo && s.date <= hi);
    if (e.show_id){
      if (!(await confirmAsk('Dissocier ?', 'L’événement Google et la date redeviennent indépendants (rien n’est supprimé).', 'Dissocier'))) return;
      await save('artist_calendar_events', e.id, {show_id: null}); return;
    }
    if (!cands.length) return toast('Aucune date « Option / Confirmée Artiste » de cet artiste à ces jours-là', true);
    const choice = await ask({title: 'Associer à une date existante', text: `« ${evLabel(e)} » (${fmtDate(a)}) : la date choisie reste telle quelle ; l’événement n’est plus affiché en double.`,
      actions: cands.map(s => ({value: s.id, label: `${fmtDate(s.date)} · ${s.venue || ''} · ${s.status}`}))});
    if (choice) await save('artist_calendar_events', e.id, {show_id: choice});
  },
};

/** Heure locale de l'événement (son fuseau), avec le fuseau s'il n'est pas celui de Paris */
const localTime = e => { const tz = e.time_zone || 'Europe/Paris'; let h;
  try { h = new Date(e.start_at).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', timeZone: tz}); } catch { h = new Date(e.start_at).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'}); }
  return tz === 'Europe/Paris' ? h : `${h} (heure locale, ${tz.split('/').pop().replace(/_/g, ' ')})`; };

/** Lignes d'indisponibilité pour la liste Booking (affichées à part, origine Google) */
export function calBookingRows(projectIds, year){
  return calEvents(projectIds).filter(e => e.busy && !e.show_id).map(e => ({e, span: evSpan(e)})).filter(x => x.span[0] && x.span[0].slice(0, 4) <= String(year) && x.span[1].slice(0, 4) >= String(year))
    .sort((x, y) => x.span[0].localeCompare(y.span[0]));
}
export function calRowHTML({e, span: [a, b]}, showArtist){
  const cal = byId('artist_calendars', e.calendar_ref), stale = !calFresh(cal);
  return `<div class="gig cal-unav" title="Indisponibilité lue dans l’agenda Google de l’artiste (lecture seule)">
    <div class="day"><b>${a.slice(8)}</b><span>${new Date(a + 'T12:00:00').toLocaleDateString('fr-FR', {weekday: 'short'})}</span></div>
    <div class="what"><b>${esc(evLabel(e))}</b><small>Agenda Google${showArtist ? ' · ' + esc(projName(e.project_id)) : ''}${b !== a ? ' · jusqu’au ' + fmtDate(b) : ''}${e.all_day ? '' : ' · ' + localTime(e)}${stale ? ' · <span class="warn-txt">disponibilités plus à jour</span>' : ''}</small></div>
    <div class="right">${e.is_show ? `<button type="button" class="btn sm ghost" data-act="calAssociate" data-id="${e.id}">${e.show_id ? 'Dissocier' : 'Associer à une date'}</button>` : ''}<span class="badge cal-badge">📅 Google</span></div></div>`;
}

/** Repères de carte des « Show » d'agenda (ville reconnue) et liste « localisation à préciser » */
export function calMapPoints(projectIds, year){
  const ev = calEvents(projectIds || S.db.projects.filter(p => p.active || S.showInactive).map(p => p.id)).filter(e => e.is_show && !e.show_id && (evSpan(e)[0] || '').startsWith(String(year)));
  return {points: ev.filter(e => e.geo_status === 'ok' && e.lat != null).map(e => ({lat: e.lat, lng: e.lng, color: '#FFFFFF', gcal: true, hover: true,
    label: `<b>Date artiste — calendrier Google</b><br>${esc(e.title || '')}<br>${fmtDate(evSpan(e)[0])} — ${esc(e.city || '')} · ${esc(projName(e.project_id))}`})),
    toLocate: ev.filter(e => e.geo_status !== 'ok')};
}
