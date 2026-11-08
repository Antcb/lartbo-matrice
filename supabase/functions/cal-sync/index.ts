// Calendriers Google des artistes — LECTURE SEULE (Google → L'ArtBotrice), par le script « Calendrier » du compte production@
// (projet Apps Script distinct, accès calendar.readonly : il ne peut rien écrire dans un agenda).
//   - équipe connectée (is_team) : { mode: 'calendars' } (agendas partagés avec production@, pour le choix explicite dans la fiche artiste)
//     ou { mode: 'sync', project_id? } (« Actualiser ») ;
//   - tâche planifiée (toutes les 5 min, en-tête x-hook-secret = secret serveur dédié « cal_sync_hook ») : { mode: 'sync' }.
// Fenêtre lue : 30 jours en arrière → 18 mois en avant, relue en entier à chaque passage (récurrences et exceptions développées par
// Google, créations, modifications, suppressions) ; une ligne par occurrence (aucun doublon). Une occurrence disparue de Google est
// marquée supprimée (gardée, plus affichée). Événements privés ou agenda « disponibilités seulement » : ni titre ni lieu enregistrés.
// « Show » (titre, sans casse) + lieu qui désigne une ville → repère de carte ; sinon « localisation à préciser », jamais approximatif.
// Aucune ligne financière, aucune date de booking créée ou modifiée.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { chooseCity, planSync, replyProblem, SYNC_COLS } from './regles.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hook-secret' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const scriptUrlOk = (u: string) => /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(u);
const DAY = 86_400_000;

/** Erreur expliquée à l'utilisateur (message rédigé ici) ; toute autre erreur n'est montrée que sous une forme générique
 *  (détail technique seulement dans le journal du serveur — CodeQL « stack trace exposure ») */
class Explique extends Error {}
const shown = (e: unknown) => e instanceof Explique ? e.message.slice(0, 500) : 'Erreur interne de la synchronisation (détail dans le journal du serveur).';
function same(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function script(url: string, secret: string, action: string, payload: Record<string, unknown> = {}, wait = 110_000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), Math.max(5_000, wait));
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, action, secret }), signal: ctl.signal });
    let j: any; try { j = JSON.parse(await r.text()); } catch { throw new Explique('Réponse illisible du script des calendriers'); }
    if (!j?.ok) throw new Explique(String(j?.error || '').slice(0, 300) || 'Le script des calendriers a refusé la demande');
    return j;
  } catch (e) {
    if (ctl.signal.aborted) throw new Explique('Le script des calendriers met trop de temps : reprise au prochain passage.');
    throw e;
  } finally { clearTimeout(timer); }
}

/** Ville d'un lieu : règles dans regles.ts (pays écrit, sinon pays par défaut de l'agenda ; élément exact ; code postal) */
// délai maximal de chaque appel au service de lieux (8 s) et nombre de localisations tentées par passage (20) : le reste est réessayé
// au passage suivant (city() → undefined, regles.ts planSync), jamais placé au hasard
const PHOTON_MS = 8_000, GEO_PER_PASS = 20;
async function photon(q: string): Promise<any[]> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), PHOTON_MS);
  try {
    const r = await fetch(`https://photon.komoot.io/api/?limit=10&lang=fr&layer=city&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
    if (!r.ok) throw new Error('service de lieux indisponible');
    return (await r.json()).features || [];
  } finally { clearTimeout(timer); }
}
function cityFinder() {
  let left = GEO_PER_PASS;
  return async (location: string, country: string | null) => {
    if (left <= 0) return undefined;   // budget du passage épuisé : réessayé plus tard
    left--;
    try { return await chooseCity(location, country, photon); } catch { return undefined; }   // indisponible / délai : réessayé plus tard
  };
}

async function syncOne(cal: any, url: string, secret: string, wait: number, city: ReturnType<typeof cityFinder>) {
  const now = Date.now(), tmin = new Date(now - 30 * DAY).toISOString(), tmax = new Date(now + 548 * DAY).toISOString();
  const runAt = new Date().toISOString();   // écrit avec le résultat : une seule écriture de l'agenda par passage (temps réel)
  try {
    const j = await script(url, secret, 'events', { calendar_id: cal.calendar_id, time_min: tmin, time_max: tmax }, wait);
    // un script sans numéro de version (antérieur à la relecture B1) prenait une limite d'usage pour un partage « disponibilités » et
    // ferait effacer les détails : sa réponse « disponibilités » est refusée tant qu'il n'est pas mis à jour
    const bad = replyProblem(j); if (bad) throw new Explique(bad);
    const { data: old, error: oe } = await admin.from('artist_calendar_events').select('gcal_event_id, ' + SYNC_COLS.join(', ')).eq('calendar_ref', cal.id);
    if (oe) { console.error('Lecture des événements', oe.message); throw new Explique('Lecture des événements enregistrés impossible pour le moment.'); }
    // règles (une ligne par occurrence, privé, disponibilités, journée entière, « Show », disparues) : regles.ts planSync, testées
    const plan = await planSync(j, cal, (old || []) as any[], tmin, tmax, city, new Date().toISOString());
    // partage passé en « disponibilités seulement » : plus aucun titre ni lieu gardé pour cet agenda, lignes anciennes comprises
    if (plan.scrub) {
      const { error } = await admin.from('artist_calendar_events').update({ title: null, location: null, city: null, lat: null, lng: null, is_show: false,
        geo_status: 'sans_lieu', geo_key: null, private: true }).eq('calendar_ref', cal.id).eq('private', false);
      if (error) { console.error('Masquage des détails', error.message); throw new Explique('Masquage des détails impossible pour le moment.'); }
    }
    for (let i = 0; i < plan.rows.length; i += 500) {
      const { error } = await admin.from('artist_calendar_events').upsert(plan.rows.slice(i, i + 500), { onConflict: 'calendar_ref,gcal_event_id' });
      if (error) { console.error('Enregistrement des événements', error.message); throw new Explique('Enregistrement des événements impossible pour le moment.'); }
    }
    // occurrences de la fenêtre absentes de Google : supprimées dans l'agenda → marquées, jamais effacées
    for (let i = 0; i < plan.gone.length; i += 200) {
      const { error } = await admin.from('artist_calendar_events').update({ deleted_at: new Date().toISOString() }).eq('calendar_ref', cal.id)
        .in('gcal_event_id', plan.gone.slice(i, i + 200)).is('deleted_at', null);
      if (error) { console.error('Suppressions', error.message); throw new Explique('Enregistrement des suppressions impossible pour le moment.'); }
    }
    await admin.from('artist_calendars').update({ last_run_at: runAt, last_ok_at: new Date().toISOString(), last_error: null, mode: plan.mode }).eq('id', cal.id);
    return { project_id: cal.project_id, ok: true, events: plan.rows.length, removed: plan.gone.length };
  } catch (e) {
    if (!(e instanceof Explique)) console.error(e);
    const msg = shown(e);
    await admin.from('artist_calendars').update({ last_run_at: runAt, last_error: msg }).eq('id', cal.id);
    return { project_id: cal.project_id, ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Demande refusée' }, 405);
  const { data: st, error: se } = await admin.from('settings').select('key, value').in('key', ['calendar_script_url']);
  if (se) return json({ ok: false, error: 'Réglages illisibles pour le moment.' }, 500);
  const val = (k: string) => String(st?.find((r: any) => r.key === k)?.value ?? '').trim();
  const url = val('calendar_script_url');
  // appel automatique : secret serveur DÉDIÉ (« cal_sync_hook », créé par la migration dans le schéma privé, jamais affiché, jamais
  // dans le navigateur, une adresse ou un journal) ; sinon compte de l'équipe. Sans justificatif ou justificatif faux : 403.
  const hook = req.headers.get('x-hook-secret') || '';
  const { data: hookSecret } = hook ? await admin.rpc('import_secret', { k: 'cal_sync_hook' }) : { data: null };
  let team = false, allowed = !!hook && !!hookSecret && same(hook, String(hookSecret));
  if (!allowed) {
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
    const { data } = await user.rpc('is_team'); team = allowed = data === true;
  }
  if (!allowed) return json({ ok: false, error: 'Accès refusé : connecte-toi avec un compte de l’équipe.' }, 403);
  const body = await req.json().catch(() => ({}));
  // secret DÉDIÉ du script des agendas (« cal_script_secret », schéma privé, tiré au hasard par la migration v1.62) : distinct du code
  // des autres scripts Google (drive_webhook_secret) — le projet « Matrice Agendas » ne détient aucun moyen d'appeler le script principal
  const { data: scriptSecret } = await admin.rpc('import_secret', { k: 'cal_script_secret' });
  const secret = String(scriptSecret || '');
  if (!secret) return json({ ok: false, error: 'Secret du script des agendas absent : appliquer la migration v1.62 des agendas.' });
  if (!url) return json({ ok: false, error: 'Le script des calendriers n’est pas encore installé : Réglages › Google.' });
  if (!scriptUrlOk(url)) return json({ ok: false, error: 'L’adresse du script des calendriers n’est pas une adresse de script publiée (…/exec).' });
  try {
    if (body?.mode === 'calendars') {
      if (!team) return json({ ok: false, error: 'Réservé à l’équipe' }, 403);
      const j = await script(url, secret, 'calendars');
      return json({ ok: true, calendars: j.calendars || [], version: j.version || null });
    }
    // rotation : les agendas lus il y a le plus longtemps d'abord ; durée totale bornée (≈ 120 s, sous la limite d'une fonction
    // serveur) : ceux qui restent passent au prochain passage (5 min) et s'affichent « disponibilités plus à jour » s'ils tardent
    let q = admin.from('artist_calendars').select('*').eq('status', 'actif').order('last_run_at', { ascending: true, nullsFirst: true });
    if (team && body?.project_id) q = q.eq('project_id', String(body.project_id));
    const { data: cals, error } = await q;
    if (error) { console.error('Lecture des agendas', error.message); throw new Explique('Lecture des agendas impossible pour le moment.'); }
    const results = [];
    const started = Date.now(), BUDGET = 120_000, city = cityFinder();
    let skipped = 0;
    for (const c of cals || []) {
      const left = BUDGET - (Date.now() - started);
      if (left < 15_000) { skipped++; continue; }   // reporté : prochain passage (rotation par last_run_at)
      results.push(await syncOne(c, url, secret, Math.min(110_000, left - 5_000), city));
    }
    return json({ ok: results.every((r) => r.ok), results, skipped, error: results.find((r) => !r.ok)?.error });
  } catch (e) {
    if (!(e instanceof Explique)) console.error(e);
    return json({ ok: false, error: shown(e) });
  }
});
