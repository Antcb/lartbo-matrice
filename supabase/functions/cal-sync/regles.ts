// Règles des agendas des artistes (décisions d'Anthony du 06/11/2026), sans réseau ni base : testées par
// tests/static/agendas-regles.mjs (fausses réponses du service de lieux).

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** « Show » : le MOT entier, sans tenir compte de la casse, y compris entre crochets ou suivi d'une ponctuation ;
 *  jamais « Showroom », « Slideshow », « Showcase »… */
export const isShowTitle = (title: string | null | undefined) => !!title && /(^|[^\p{L}\p{N}])show(?![\p{L}\p{N}])/iu.test(title);

export const COUNTRIES: Record<string, string> = { france: 'FR', belgique: 'BE', suisse: 'CH', espagne: 'ES', italie: 'IT', allemagne: 'DE',
  'royaume uni': 'GB', angleterre: 'GB', portugal: 'PT', 'pays bas': 'NL', luxembourg: 'LU', canada: 'CA', 'etats unis': 'US', usa: 'US' };
const km = (a: number[], b: number[]) => { const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos((a[1] + b[1]) / 2 * r), y = (b[1] - a[1]) * r; return Math.sqrt(x * x + y * y) * 6371; };

export type Place = { city: string; lat: number; lng: number; country: string };
export type Photon = (q: string) => Promise<any[]>;   // résultats « ville » du service de lieux (features GeoJSON)

/**
 * Ville d'un lieu d'agenda (jamais de repère approximatif) :
 *  - pays : celui écrit dans le lieu, sinon le PAYS PAR DÉFAUT de l'agenda de l'artiste (France par défaut, réglable) ;
 *  - on essaie chaque élément du lieu, du dernier au premier (salle, adresse, ville…) ; une ville n'est retenue que si son nom
 *    est EXACTEMENT cet élément, dans ce pays ; un code postal présent doit concorder (même département / début de code) ;
 *  - homonymes éloignés (> 30 km) restants, ou éléments qui désignent des villes différentes → null : « localisation à préciser ».
 */
export async function chooseCity(location: string, defaultCountry: string | null, photon: Photon): Promise<Place | null> {
  const raw = String(location || '');
  const postcode = (raw.match(/\b\d{5}\b/) || raw.match(/\b\d{4}\b/) || [])[0] || null;
  let parts = raw.split(/[,\n;–—]| - /).map((x) => x.replace(/\b\d{4,5}\b/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  let country = (defaultCountry || '').toUpperCase() || null;
  const written = parts.map((p) => COUNTRIES[norm(p)]).filter(Boolean);
  if (written.length) { country = written[written.length - 1]; parts = parts.filter((p) => !COUNTRIES[norm(p)]); }
  const found: Place[] = [];
  for (const seg of [...parts].reverse()) {
    if (norm(seg).length < 2) continue;
    let c = (await photon(seg)).filter((f: any) => norm(f.properties?.name || '') === norm(seg));
    if (country) c = c.filter((f: any) => String(f.properties?.countrycode || '').toUpperCase() === country);
    if (postcode) {
      const withPc = c.filter((f: any) => f.properties?.postcode);
      const ok = withPc.filter((f: any) => String(f.properties.postcode).split(/[;,]/).some((pc: string) => pc.trim().slice(0, 2) === postcode.slice(0, 2)));
      if (withPc.length) c = ok;
    }
    if (!c.length) continue;
    const p0 = c[0].geometry.coordinates;
    if (c.some((f: any) => km(p0, f.geometry.coordinates) > 30)) return null;   // homonymes : à préciser
    found.push({ city: c[0].properties.name, lat: p0[1], lng: p0[0], country: String(c[0].properties.countrycode || country || '').toUpperCase() });
  }
  if (!found.length) return null;
  // deux éléments qui désignent des villes éloignées (« Salle Paris, Lille ») : incohérent → à préciser
  if (found.some((f) => km([found[0].lng, found[0].lat], [f.lng, f.lat]) > 30)) return null;
  return found[0];
}

/** Événement renvoyé par le script « Agendas » (apps-script/calendrier/Calendrier.gs, events_) */
export type Ev = { id: string; time_zone?: string | null; recurring_id?: string | null; title?: string | null; location?: string | null; start?: string | null;
  end?: string | null; start_date?: string | null; end_date?: string | null; transparency?: string; visibility?: string; type?: string };
/** Ligne déjà enregistrée (artist_calendar_events) utile au calcul */
export type Old = { gcal_event_id: string; city?: string | null; lat?: number | null; lng?: number | null; geo_status?: string | null; geo_key?: string | null;
  start_at?: string | null; end_at?: string | null; start_date?: string | null; end_date?: string | null; deleted_at?: string | null; [k: string]: unknown };
/** Colonnes écrites par la synchronisation : une ligne n'est réécrite que si l'une d'elles change (relecture de 976ea64, B2) */
export const SYNC_COLS = ['project_id', 'recurring_id', 'all_day', 'start_at', 'end_at', 'start_date', 'end_date', 'time_zone', 'busy', 'private',
  'title', 'location', 'is_show', 'city', 'lat', 'lng', 'geo_status', 'geo_key', 'deleted_at'] as const;
const INSTANTS = new Set(['start_at', 'end_at', 'deleted_at']);
/** Même valeur ? (instants comparés en temps réel : « +01:00 » de Google = « +00:00 » relu en base ; dates : AAAA-MM-JJ) */
const sameVal = (k: string, a: unknown, b: unknown) => {
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null);
  if (INSTANTS.has(k)) return Date.parse(String(a)) === Date.parse(String(b));
  if (k === 'start_date' || k === 'end_date') return String(a).slice(0, 10) === String(b).slice(0, 10);
  if (k === 'lat' || k === 'lng') return Number(a) === Number(b);
  return a === b;
};
export const changed = (row: Record<string, unknown>, old: Old | undefined) => !old || SYNC_COLS.some((k) => !sameVal(k, row[k], old[k]));

/**
 * Passage de synchronisation, SANS réseau ni base (testé par tests/static/agendas-regles.mjs) — décisions d'Anthony du 06/11/2026 :
 *  - une ligne par OCCURRENCE (identifiant d'occurrence Google : récurrences développées, exception = même identifiant mis à jour),
 *    dédoublonnée (la dernière lue l'emporte) : aucune ligne en double, même si Google renvoie deux fois la même occurrence ;
 *  - privé / confidentiel, ou agenda partagé en « disponibilités seulement » : ni titre ni lieu (jamais enregistrés) ;
 *  - « Disponible » dans Google (transparent) : busy = false (jamais bloquant) ;
 *  - journée entière : dates calendaires telles quelles (fin exclue, règle Google), sans fuseau ni heure ;
 *  - « Show » (mot entier) + lieu : ville reconnue (chooseCity) ou « à préciser » ; repris tel quel si lieu ET pays inchangés ;
 *  - SEULES les lignes nouvelles ou réellement modifiées sont renvoyées (updated_at posé sur elles seules) : deux passages sans
 *    changement dans Google = aucune écriture, donc aucun message temps réel (relecture de 976ea64, B2) ;
 *  - localisation non tentée (service de lieux indisponible, délai ou budget du passage dépassé : city() renvoie undefined) : pas de
 *    clé de localisation gardée → réessayée au passage suivant ; null = ville vraiment ambiguë ou inconnue → « à préciser » gardé ;
 *  - disparues : occurrences enregistrées non supprimées, absentes de la réponse, qui CHEVAUCHENT la fenêtre lue (fin après time_min,
 *    début avant time_max) → marquées supprimées (jamais effacées) ; une occurrence passée hors fenêtre reste telle quelle.
 */
export async function planSync(j: { mode?: string; events?: Ev[] }, cal: { id: string; project_id: string; default_country?: string | null },
  old: Old[], tmin: string, tmax: string, city: (loc: string, cc: string | null) => Promise<Place | null | undefined>, nowIso: string) {
  const fb = j.mode === 'disponibilites';
  const country = String(cal.default_country || 'FR').toUpperCase();
  const prev = new Map(old.map((o) => [o.gcal_event_id, o]));
  const byId = new Map<string, Record<string, unknown>>();
  for (const e of j.events || []) {
    if (!e || !e.id) continue;
    const priv = fb || e.visibility === 'private' || e.visibility === 'confidential';
    const title = priv ? null : (e.title || null), location = priv ? null : (e.location || null);
    const isShow = isShowTitle(title);
    let geo: Record<string, unknown> = { city: null, lat: null, lng: null, geo_key: null, geo_status: location ? 'a_preciser' : 'sans_lieu' };
    if (isShow && location) {
      const p = prev.get(e.id);
      if (p && p.geo_key === country + '|' + location && p.geo_status && p.geo_status !== 'sans_lieu') geo = { city: p.city ?? null, lat: p.lat ?? null, lng: p.lng ?? null, geo_status: p.geo_status };
      else {
        const c = await city(location, country);
        if (c) geo = { city: c.city, lat: c.lat, lng: c.lng, geo_status: 'ok' };
        if (c === undefined) { geo.geo_key = null; }   // non tentée : réessayée au prochain passage
        else geo.geo_key = country + '|' + location;
      }
      if (geo.geo_key === undefined) geo.geo_key = country + '|' + location;
    }
    const allDay = !!e.start_date;
    byId.set(e.id, { calendar_ref: cal.id, project_id: cal.project_id, gcal_event_id: e.id, recurring_id: e.recurring_id || null,
      all_day: allDay, start_at: allDay ? null : (e.start || null), end_at: allDay ? null : (e.end || e.start || null),
      start_date: allDay ? e.start_date : null, end_date: allDay ? (e.end_date || null) : null,
      time_zone: allDay ? null : (e.time_zone || null),   // jour local de l'événement (affichage) ; conflits comparés sur les instants
      busy: e.transparency !== 'transparent', private: priv, title, location, is_show: isShow, ...geo, deleted_at: null, updated_at: nowIso });
  }
  const rows = [...byId.values()].filter((r) => changed(r, prev.get(String(r.gcal_event_id))));
  const seen = new Set(byId.keys());
  const t0 = Date.parse(tmin), t1 = Date.parse(tmax), d0 = tmin.slice(0, 10), d1 = tmax.slice(0, 10);
  const inWindow = (o: Old) => o.start_date
    ? (o.end_date || o.start_date) > d0 && o.start_date <= d1
    : !!o.start_at && Date.parse(o.end_at || o.start_at) > t0 && Date.parse(o.start_at) < t1;
  const gone = old.filter((o) => !o.deleted_at && !seen.has(o.gcal_event_id) && inWindow(o)).map((o) => o.gcal_event_id);
  return { rows, gone, mode: fb ? 'disponibilites' : 'details', scrub: fb };
}

/** Réponse du script inacceptable ? Un script sans numéro de version (antérieur à la relecture de 976ea64, B1) prenait une limite d'usage
 *  (403 rateLimitExceeded…) pour un partage « disponibilités » : sa réponse « disponibilités » ferait effacer les détails → refusée. */
export const replyProblem = (j: { mode?: string; version?: string | null }) =>
  j.mode === 'disponibilites' && !j.version ? 'Le script des agendas n’est pas à jour : Réglages › Agendas des artistes › copier le code, coller, nouvelle version de déploiement.' : null;

/**
 * Localisations d'un passage (relecture de 023edf4, F4) : au plus `perPass` tentatives, et aucune après l'échéance du passage (budget de
 * 120 s, moins une marge d'un appel) ; chaque appel est lui-même borné par le délai du service de lieux. Au-delà → undefined : réessayé
 * au passage suivant (planSync), jamais placé au hasard. Erreur ou délai du service → undefined aussi.
 */
export function cityFinder(choose: (loc: string, cc: string | null) => Promise<Place | null>,
  { perPass = 20, deadline = Infinity, callMs = 8_000, clock = () => Date.now() }: { perPass?: number; deadline?: number; callMs?: number; clock?: () => number } = {}) {
  let left = perPass;
  return async (location: string, country: string | null): Promise<Place | null | undefined> => {
    if (left <= 0 || clock() + callMs > deadline) return undefined;
    left--;
    try { return await choose(location, country); } catch { return undefined; }
  };
}

/**
 * Passage complet sur plusieurs agendas (relecture de 023edf4, F4) : agendas lus du moins récemment commencé au plus récent ;
 * last_run_at écrit AU DÉBUT de la lecture de chacun (markStart), si bien qu'un agenda interrompu (délai, arrêt de la fonction) passe en
 * fin de file au passage suivant au lieu de bloquer les autres ; durée totale bornée (budgetMs) : un agenda n'est commencé que s'il
 * reste au moins `minLeft` ; les autres sont reportés (skipped).
 */
export async function runPass<C extends { last_run_at?: string | null }, R>(cals: C[],
  { budgetMs = 120_000, minLeft = 15_000, clock = () => Date.now(), markStart, syncOne }:
  { budgetMs?: number; minLeft?: number; clock?: () => number; markStart: (c: C, at: string) => Promise<void>; syncOne: (c: C, wait: number, deadline: number) => Promise<R> }) {
  const started = clock(), deadline = started + budgetMs;
  const order = [...cals].sort((a, b) => (a.last_run_at ? Date.parse(a.last_run_at) : -Infinity) - (b.last_run_at ? Date.parse(b.last_run_at) : -Infinity));
  const results: R[] = []; let skipped = 0;
  for (const c of order) {
    const left = deadline - clock();
    if (left < minLeft) { skipped++; continue; }
    await markStart(c, new Date(clock()).toISOString());
    results.push(await syncOne(c, Math.min(110_000, left - 5_000), deadline));
  }
  return { results, skipped };
}
