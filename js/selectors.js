/**
 * Lecture des données chargées : noms, filtres, liens contacts/structures, suivis, tâches.
 * Les recherches fréquentes passent par des index en cache (recalculés quand la table change),
 * ce qui garde l'app rapide malgré les milliers de structures et de contacts.
 */
import { DEFAULT_DEPARTMENTS, PRIORITY_LABEL, TEAM_NAMES, isOff } from './constants.js';
import { lingering } from './data.js';
import { ENV } from './config.js';
import { S } from './state.js';
import { daysUntil, fmtDate, norm } from './utils.js';

const CACHE = {};
/** Index mis en cache tant que les tables listées n'ont pas changé */
function cached(name, tables, build){
  const key = tables.map(t => S.rev[t]).join('.');
  const c = CACHE[name];
  if (c && c.key === key) return c.val;
  const val = build(); CACHE[name] = {key, val}; return val;
}
const groupBy = (rows, col) => { const m = new Map(); for (const r of rows){ const k = r[col]; if (k==null) continue; let a = m.get(k); if (!a) m.set(k, a = []); a.push(r); } return m; };

export const byId = (t,id) => id ? cached('id.'+t, [t], () => new Map(S.db[t].map(r => [r.id, r]))).get(id) : undefined;

export const projName = id => byId('projects', id)?.name || '';
/** Spectacles d'un artiste (v1.57) : actifs d'abord (sauf all=false), dans l'ordre choisi puis par nom */
export const spectaclesOf = (projectId, {all = true} = {}) => (S.db.spectacles || []).filter(x => x.project_id === projectId && (all || x.active))
  .sort((a, b) => (b.active - a.active) || ((a.sort ?? 1e9) - (b.sort ?? 1e9)) || a.name.localeCompare(b.name));
export const spectacleName = id => byId('spectacles', id)?.name || '';
/** Spectacle présélectionné pour une NOUVELLE date (v1.60.3) : le seul spectacle actif de l'artiste ; plusieurs actifs : celui défini
 *  par défaut sur l'artiste (projects.default_spectacle_id) s'il est encore actif et bien le sien ; sinon aucun (choix demandé).
 *  Jamais appliqué aux dates existantes ni aux autres chemins de création. */
export function defaultSpectacleId(projectId){
  const act = spectaclesOf(projectId, {all: false});
  if (act.length === 1) return act[0].id;
  const d = byId('projects', projectId)?.default_spectacle_id;
  return d && act.some(x => x.id === d) ? d : '';
}

export const structName = id => byId('structures', id)?.name || '';

export const teamName = email => TEAM_NAMES[email] || (email ? email.split('@')[0] : '');

export function setting(k){ const s = S.db.settings.find(x=>x.key===k); return s ? s.value : null; }
/**
 * Mode essai Brevo (réglage brevo_essai_emails ; marche supabase/operations/2026-11-09_essai_brevo_contact_test.md) : null = inactif
 * (réglage absent ou vide) ; sinon les adresses VALIDES retenues — liste vide = rempli sans adresse valide = TOUT est bloqué
 * (relecture B2 du 09/11). Même règle : supabase/functions/brevo-sync/regles.ts (listeEssai).
 */
export function listeEssaiBrevo(v = setting('brevo_essai_emails')){
  if (v == null || (typeof v === 'string' && !v.trim())) return null;
  const brut = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : JSON.stringify(v);
  return [...new Set(brut.split(/[,;\s]+/).map(e => e.replace(/^[<"'(]+|[>"'),.]+$/g, '').trim().toLowerCase())
    .filter(e => /^[^\s@<>"',;()]+@[^\s@<>"',;()]+\.[a-z]{2,}$/.test(e)))];
}

/** Lien d'une page publique (fiche, artiste, salarié). En test, « &test » est ajouté : le lien ouvre la base de test (jamais
 *  la vraie fiche) et se reconnaît. Même règle pour le lien {{lien_fiche}} des mails (fonction SQL mail_vars, complété
 *  dans js/mail.js mailVars). */
export function publicLink(page, token, extra = ''){
  const base = setting('site_url') || location.origin + location.pathname.replace(/[^/]*$/, '');
  return base + page + '.html?t=' + token + extra + (ENV === 'test' ? '&test' : '');
}
/** Texte d'un message « lien copié » : précise « de test » dans l'espace de test */
export const linkLabel = what => ENV === 'test' ? `${what} (lien de TEST)` : what;

/** Dates du projet et de l'année choisis (filtres de la vue) */
/**
 * Filtre artistes commun à toutes les pages : les artistes choisis en haut (un ou plusieurs),
 * sinon tous les artistes actifs (les inactifs seulement avec « Afficher les inactifs »).
 * Une ligne sans artiste reste toujours visible.
 */
export function projFilterOk(ids){
  ids = (ids || []).filter(Boolean);
  if (S.projects.length) return ids.some(id => S.projects.includes(id));
  if (S.showInactive || !ids.length) return true;
  return ids.some(id => byId('projects', id)?.active);
}
/** Date archivée (v1.60.3) : hors des listes de TRAVAIL (Booking, Production, Billetterie, Communication, carte, suivis, relances),
 *  mais toujours dans les données et les vues FINANCIÈRES (factures, créances, dettes, paiements, comptes, commissions, exports
 *  comptables), signalée « date archivée ». Distincte d'une annulation (statut) et d'une suppression. */
export const isArchived = s => !!s?.archived_at;
/** Dates des listes de travail (artistes et année choisis) ; archived: true = dates archivées comprises (indicateurs financiers) */
export function showsFiltered({year=true, archived=false}={}){
  return S.db.shows.filter(s =>
    (archived || !isArchived(s)) && projFilterOk([s.project_id]) &&
    (!year || !s.date || Number(s.date.slice(0,4)) === S.year)
  ).sort((a,b) => (a.date||'9999').localeCompare(b.date||'9999'));
}

/** Masque annulées / sans suite, sauf pendant les 5 s qui suivent le changement */
export const visibleShow = s => S.showCancelled || !isOff(s.status) || lingering(s.id);

/**
 * Localisation d'une date sur la carte et pour les distances (décision d'Anthony du 07/11/2026) — jamais une date retirée de la carte
 * ni des listes, aucune donnée modifiée :
 *  - 'own'       : coordonnées enregistrées sur la date (lieu choisi, adresse propre, ou repère déjà enregistré : conservé tel quel) ;
 *  - 'confirmed' : sans coordonnées propres, la structure, confirmée comme lieu (« Utiliser l'adresse de la structure… » coché) ;
 *  - 'inherited' : sans coordonnées propres ni confirmation, le repère de la structure, conservé comme en v1.60.1 mais « lieu à confirmer » ;
 *                  de même pour une date dont les coordonnées enregistrées sont exactement celles de sa structure (copiées autrefois) ;
 *  - 'missing'   : aucune coordonnée exploitable (« localisation manquante ») : la date reste dans les listes.
 * Placement identique à la v1.60.1 (coordonnées de la date, sinon celles de la structure).
 */
export function showPlace(s){
  const st = byId('structures', s?.structure_id), sc = st && st.lat != null && st.lng != null ? [st.lat, st.lng] : null;
  const conf = !!s?.venue_is_structure && !!st;
  if (s?.lat != null && s?.lng != null){
    const copied = sc && !conf && !s.address && Number(s.lat) === Number(sc[0]) && Number(s.lng) === Number(sc[1]);
    return {coords: [s.lat, s.lng], state: copied ? 'inherited' : 'own'};
  }
  if (sc) return {coords: sc, state: conf ? 'confirmed' : 'inherited'};
  return {coords: null, state: 'missing'};
}
export const showCoords = s => showPlace(s).coords;
/** Mention de la localisation d'une date ('' quand le lieu est connu) */
export const PLACE_NOTE = {inherited: 'Localisation héritée de la structure — lieu à confirmer', missing: 'Localisation manquante'};
export const showPlaceNote = s => PLACE_NOTE[showPlace(s).state] || '';

/* Lieux (v1.60.2) : un suivi ou une date peut avoir son propre lieu (salle, festival, adresse), distinct de la structure suivie.
 * Un lieu = {venue, address, postal_code, city, department, lat, lng} ; repris d'une fiche structure ou d'un événement, jamais inventé. */
const isFrance = c => !c || /^\s*france\s*$/i.test(c);
/** Lieu d'une fiche structure (sa propre adresse, pas l'adresse administrative) */
export const placeOfStructure = st => st ? {venue: st.name, address: st.address || null, postal_code: st.postal_code || null, city: st.city || null,
  department: st.department_code || (!isFrance(st.country) ? st.country : null), lat: st.lat ?? null, lng: st.lng ?? null} : null;
/** Lieu d'un festival / d'une salle / d'un événement d'une structure, sélectionné : SES propres données (nom, « Lieu (si différent) »
 *  repris comme adresse, ville ; la table structure_events n'a ni code postal ni coordonnées) — jamais l'adresse, le code postal,
 *  la ville ni les coordonnées de l'organisateur (décisions du 07/11/2026). Département : celui de la structure seulement si
 *  l'événement est indiqué dans la même ville qu'elle. */
export function placeOfEvent(e){
  if (!e) return null;
  const st = byId('structures', e.structure_id), sp = placeOfStructure(st);
  const sameCity = !!sp && !!e.city && norm(e.city) === norm(st.city || '');
  return {venue: e.name, address: (e.place || '').trim() || null, postal_code: null, city: e.city || null, department: sameCity ? sp.department : null, lat: null, lng: null};
}
/** Lieu propre d'un suivi (null s'il n'en a pas : c'est alors la structure qui sert de repère) */
export const placeOfSuivi = p => p && (p.venue || p.address || p.city) ? {venue: p.venue || null, address: p.address || null, postal_code: p.postal_code || null,
  city: p.city || null, department: p.department || null, lat: p.lat ?? null, lng: p.lng ?? null} : null;
/** Point de repère d'un suivi sur la carte : son lieu s'il est localisé, sinon sa structure */
export function suiviCoords(p){
  if (p?.lat != null && p?.lng != null) return [p.lat, p.lng];
  if (placeOfSuivi(p)) return null;   // lieu propre pas encore localisé : jamais la ville de la structure à sa place
  const st = byId('structures', p?.structure_id);
  return st && st.lat != null && st.lng != null ? [st.lat, st.lng] : null;
}
/** Texte court d'un lieu : « Lieu · adresse, CP Ville » */
export const placeText = pl => pl ? [pl.venue, [pl.address, [pl.postal_code, pl.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(' · ') : '';

export const showLabel = s => s ? `${s.date ? s.date.split('-').reverse().join('/') : 'sans date'} · ${s.venue||'?'}${s.city && s.city!==s.venue ? ' ('+s.city+')' : ''}${isArchived(s) ? ' · date archivée' : ''}` : '';

export function urgency(t){
  if (['Done','Cancelled'].includes(t.status)) return null;
  // relance d'un contact lié uniquement à des structures inactives (v1.60.2) : suspendue, jamais « en retard » ni urgente
  if (relanceTaskSuspended(t)) return {cls:'low', label:'Relance suspendue (structure inactive)', suspended:true};
  const d = daysUntil(t.deadline);
  if (d==null) return t.priority ? {cls:{'D-Day':'today',Critical:'crit',High:'high',Medium:'med',Low:'low'}[t.priority]||'med', label:PRIORITY_LABEL[t.priority]||t.priority} : null;
  if (d<0) return {cls:'late', label:`En retard de ${-d} j`};
  if (d===0) return {cls:'today', label:"Aujourd'hui"};
  if (d<=2) return {cls:'crit', label:`J-${d}`};
  if (d<=7) return {cls:'high', label:`J-${d}`};
  if (d<=21) return {cls:'med', label:`J-${d}`};
  return {cls:'low', label:`J-${d}`};
}

export const isDone = t => ['Done','Cancelled'].includes(t.status);

export function taskSort(a,b){
  const done = t => isDone(t) && !lingering(t.id) ? 1 : 0;
  return done(a)-done(b) || (a.deadline||'9999').localeCompare(b.deadline||'9999');
}

// --- Index par structure / suivi / projet -----------------------------------
const byCol = (table, col) => cached(`${table}.${col}`, [table], () => groupBy(S.db[table], col));

export function logsOf(pid){ return (byCol('prospect_logs','prospect_id').get(pid)||[]).filter(l=>!l.hidden).sort((a,b)=>(b.date||'0000').localeCompare(a.date||'0000') || (b.sort||0)-(a.sort||0)); }

export function filesOf(pid){ return (byCol('prospect_files','prospect_id').get(pid)||[]).slice().sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||'')); }

export const attachmentsOf = (col, id) => (byCol('attachments', col).get(id)||[]).slice().sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));

export const prospectsOfStructure = id => byCol('prospects','structure_id').get(id) || [];
export const showsOfStructure = id => byCol('shows','structure_id').get(id) || [];
export const tasksOfStructure = id => byCol('tasks','structure_id').get(id) || [];
export const eventsOfStructure = id => (byCol('structure_events','structure_id').get(id) || []).slice().sort((a,b)=>(a.date_start||'9999').localeCompare(b.date_start||'9999'));
export const showsOfProject = id => byCol('shows','project_id').get(id) || [];
export const logsOfProject = id => (byCol('project_logs','project_id').get(id) || []).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.created_at||'').localeCompare(a.created_at||''));
export const membersOfProject = id => (byCol('project_members','project_id').get(id) || []).slice().sort((a,b)=>(a.sort||0)-(b.sort||0) || String(a.last_name).localeCompare(String(b.last_name)));
export const tasksOfShow = id => byCol('tasks','show_id').get(id) || [];

export function lastExchange(p){ const l = logsOf(p.id).find(x=>x.date); const d = [l?.date, p.last_contact].filter(Boolean).sort().pop(); return d || null; }

/** Autres contacts qui ont déjà l'un de ces mails (mail 1 ou 2, sans tenir compte des majuscules ni des espaces) — doublons (décision du 27/10) */
export function contactsWithMail(mails, exceptId = null){
  const want = new Set((mails || []).map(m => String(m || '').trim().toLowerCase()).filter(Boolean));
  if (!want.size) return [];
  return S.db.contacts.filter(c => c.id !== exceptId && [c.email, c.email_2].some(m => want.has(String(m || '').trim().toLowerCase())));
}

/** Commission L'ArtBo par défaut selon le type de suivi (Réglages › Pourcentages par défaut) : booking 15 %, production 20 % */
export const defaultCommission = mode => { const v = Number(setting(mode === 'booking' ? 'default_artbo_pct_booking' : 'default_artbo_pct_production'));
  return Number.isFinite(v) && v > 0 ? v : (mode === 'booking' ? 15 : 20); };
/** Commission d'un projet : la sienne, sinon celle par défaut de son type de suivi */
export const projectCommission = p => p?.default_artbo_pct != null && p.default_artbo_pct !== '' ? Number(p.default_artbo_pct) : defaultCommission(p?.mode);
const filled = v => v != null && String(v).trim() !== '';
/** Commission d'une date sans % sur sa ligne (§6.3, v1.46a) : % de la date > % de l'artiste > Réglages selon le mode de la DATE.
 *  Même règle côté base (default_commission_pct) et côté Pennylane (regles.ts pctCommission). */
export function showCommissionPct(s){
  if (!s) return 0;
  if (filled(s.artbo_pct)) return Number(s.artbo_pct);
  const p = byId('projects', s.project_id);
  if (filled(p?.default_artbo_pct)) return Number(p.default_artbo_pct);
  return defaultCommission(s.prod_mode || p?.mode || 'production');
}
/** Acompte par défaut (§6.4, v1.46a) : le réglage tel quel, 0 % compris (= date sans acompte) ; 50 seulement si le réglage est absent ou vide */
/** Acompte par défaut (% du cachet) : priorité date > artiste > Réglages (décision du 04/11/2026, v1.59) — ici l'artiste puis les
 *  Réglages (la date, elle, porte sa propre ligne d'acompte) ; 0 gardé tel quel (= sans acompte), 50 seulement si le réglage est vide.
 *  Même règle côté base : public.default_acompte_for. */
export const settingAcompte = () => { const v = setting('default_acompte_pct'); return filled(v) && Number.isFinite(Number(v)) ? Number(v) : 50; };
export const defaultAcompte = projectId => { const v = byId('projects', projectId)?.default_acompte_pct; return filled(v) && Number.isFinite(Number(v)) ? Number(v) : settingAcompte(); };

/** Suivi terminé : clos (Closed) ou confirmé (Confirmed) — rangé dans « suivis clos », plus de relance */
export const suiviClosed = p => p?.status === 'Closed' || p?.status === 'Confirmed';

export function projIds(p){ return (p.project_ids && p.project_ids.length) ? p.project_ids : (p.project_id ? [p.project_id] : []); }

export function projNames(p){ return projIds(p).map(projName).filter(Boolean).join(', '); }

export const prospectsOfProject = id => cached('prospects.proj', ['prospects'], () => {
  const m = new Map(); for (const p of S.db.prospects) for (const pid of projIds(p)){ let a = m.get(pid); if (!a) m.set(pid, a=[]); a.push(p); } return m; }).get(id) || [];

export const tasksOfProject = id => cached('tasks.proj', ['tasks'], () => {
  const m = new Map(); for (const t of S.db.tasks) for (const pid of projIds(t)){ let a = m.get(pid); if (!a) m.set(pid, a=[]); a.push(t); } return m; }).get(id) || [];

export function prospectTitle(p){ return [structName(p.structure_id), projNames(p)].filter(Boolean).join(' — ') || p.name; }

/** Les mails d'un contact (mail 1, mail 2), séparés par une virgule : prêts pour « À » d'un mail */
export const contactMails = c => [c?.email, c?.email_2].map(e => String(e || '').trim()).filter(Boolean).filter((e, i, a) => a.findIndex(x => x.toLowerCase() === e.toLowerCase()) === i).join(', ');

export function linksOfContact(id){ return (byCol('contact_structures','contact_id').get(id)||[]).map(l=>byId('structures',l.structure_id)).filter(Boolean); }

/** Structure fermée / inactive (v1.54) : gardée avec tout son historique, plus proposée par défaut */
export const isInactive = st => !!st?.inactive_at;
/**
 * Contact rattaché UNIQUEMENT à des structures inactives (au moins une, aucune active) — demande d'Anthony (v1.60.2) : ses relances
 * sont suspendues et il est tenu hors de la prospection, sans suppression ni désabonnement. Un contact lié à au moins une structure
 * active reste prospectable ; un contact sans structure n'est pas concerné. Réactiver la structure rétablit tout (rien n'est enregistré).
 */
export const onlyInactive = c => { const l = c?.id ? linksOfContact(c.id) : []; return l.length > 0 && l.every(isInactive); };
/**
 * Hors prospection (et hors Brevo) : lié uniquement à des structures inactives (v1.60.2), OU sans structure et marqué
 * contacts.hors_prospection_at — décision d'Anthony du 08/11/2026 (option B) : un contact qui a perdu un rattachement alors qu'il
 * n'était lié qu'à des structures inactives ne revient pas en prospection en devenant « sans structure » ; un contact créé sans
 * structure n'est pas marqué. Le marqueur est posé et effacé par la base seulement (rattachement à une structure active,
 * réactivation). Exclusion MANUELLE (contacts.prospection_exclue_at, décision du 09/11) : hors prospection quelles que soient ses
 * structures. Même règle : supabase/functions/brevo-sync/regles.ts (horsProspection). Relances (relancesSuspended) : inchangées.
 */
export const horsProspection = c => !!c?.prospection_exclue_at || onlyInactive(c) || (!!c?.hors_prospection_at && !(c?.id && linksOfContact(c.id).length));
/**
 * État de prospection d'un contact pour sa fiche (décisions du 09/11/2026) : {hors, manuel, auto, inactives, derniere} — derniere = dernière
 * entrée MANUELLE du journal contacts.prospection_history ({at, action, origine, par, motif}). Exclusion manuelle : levée seulement par
 * « Remettre en prospection » (fonction serveur set_prospection, motif, tracé) ; jamais par un rattachement.
 */
export function prospectionState(c){
  const hist = Array.isArray(c?.prospection_history) ? c.prospection_history : [];
  const auto = !!c?.hors_prospection_at && !(c?.id && linksOfContact(c.id).length);
  return {hors: horsProspection(c), manuel: !!c?.prospection_exclue_at, auto, inactives: onlyInactive(c), markers: !!(c?.prospection_exclue_at || c?.hors_prospection_at),
    derniere: [...hist].reverse().find(e => e?.origine === 'manuelle') || null, autoEntree: [...hist].reverse().find(e => e?.origine === 'structure') || null};
}
/** Adresses d'un champ « À » (nom <adresse>, virgules, points-virgules) */
const addrsIn = v => (String(v || '').match(/[^\s<>,;"]+@[^\s<>,;"]+/g) || []).map(m => m.toLowerCase());
/**
 * Relances automatiques d'un suivi suspendues (v1.60.2) : tous ses destinataires reconnus (contacts retrouvés par l'une de leurs
 * adresses dans le « À » du mail de prospection, sinon le contact du suivi) ne sont liés qu'à des structures inactives ; destinataire
 * non reconnu (adresse libre, contact sans structure) : la structure du suivi est inactive. Calculé à l'affichage : réactiver la
 * structure rétablit les relances, aucune tâche n'est modifiée ni supprimée.
 */
export function relancesSuspended(p){
  if (!p || suiviClosed(p)) return false;
  let who = contactsWithMail(addrsIn(p.mail_to));
  if (!who.length && p.contact_id) who = [byId('contacts', p.contact_id)].filter(Boolean);
  who = who.filter(c => linksOfContact(c.id).length);
  return who.length ? who.every(onlyInactive) : isInactive(byId('structures', p.structure_id));
}
/** Tâche de relance automatique (mail J+10 ou téléphone) d'un suivi dont les relances sont suspendues */
export const relanceTaskSuspended = t => !!t?.prospect_id && ['relance_mail', 'relance_tel'].includes(t.auto_kind) && !isDone(t)
  && relancesSuspended(byId('prospects', t.prospect_id));
/** Fonction d'un contact dans une structure donnée (contact_structures.role, v1.54) — à côté de ses fonctions générales */
export const linkRole = (contactId, structureId) => (S.db.contact_structures.find(l => l.contact_id === contactId && l.structure_id === structureId)?.role) || '';
export function linksOfStructure(id){ return (byCol('contact_structures','structure_id').get(id)||[]).map(l=>byId('contacts',l.contact_id)).filter(Boolean); }

export const optsOf = (t, label='name') => S.db[t].slice().sort((a,b)=>String(a[label]).localeCompare(String(b[label]))).map(r=>[r.id, r[label]]);

/** Utilisation de chaque artiste (dates + tâches + suivis) : les plus utilisés apparaissent en premier dans les choix */
export const projUsage = () => cached('proj.usage', ['shows', 'tasks', 'prospects'], () => {
  const m = new Map();
  for (const t of ['shows', 'tasks', 'prospects']) for (const r of S.db[t] || []) for (const id of projIds(r)) m.set(id, (m.get(id) || 0) + 1);
  return m;
});
/** Tri des artistes : les plus utilisés d'abord, puis par nom */
export const byUsage = (a, b) => { const u = projUsage(); return ((u.get(b.id) || 0) - (u.get(a.id) || 0)) || a.name.localeCompare(b.name); };

/** Projets triés : actifs d'abord, puis les plus utilisés. onlyActive : seulement les actifs (+ ceux déjà choisis) */
export function projectOptions(onlyActive=false, keep=[]){
  return S.db.projects.slice().filter(p => !onlyActive || p.active || keep.includes(p.id))
    .sort((a,b)=>(b.active-a.active)||byUsage(a, b));
}

/** Nombre de notifications non lues pour l'utilisateur connecté */
/** Notifications actives : sans celles retirées (date archivée ou restaurée, v1.60.3), gardées en base pour l'historique */
export const activeNotifs = () => S.db.notifications.filter(n => !n.withdrawn_at);
export const unreadNotifs = () => activeNotifs().filter(n => !(n.read_by||[]).includes(S.user?.email));

/** Pôles des tâches (Réglages) : [{name, color}] */
export const departments = () => { const d = setting('departments'); return Array.isArray(d) && d.length ? d : DEFAULT_DEPARTMENTS; };
export const deptNames = () => departments().map(d => d.name);
export const deptColor = n => departments().find(d => d.name === n)?.color || '#8A94A6';
