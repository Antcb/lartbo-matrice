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
import { chooseCity, isShowTitle } from './regles.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hook-secret' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const scriptUrlOk = (u: string) => /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(u);
const DAY = 86_400_000;

function same(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function script(url: string, secret: string, action: string, payload: Record<string, unknown> = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 110_000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, action, secret }), signal: ctl.signal });
    let j: any; try { j = JSON.parse(await r.text()); } catch { throw new Error('Réponse illisible du script des calendriers'); }
    if (!j?.ok) throw new Error(j?.error || 'Le script des calendriers a refusé la demande');
    return j;
  } catch (e) {
    if (ctl.signal.aborted) throw new Error('Le script des calendriers met trop de temps : reprise au prochain passage.');
    throw e;
  } finally { clearTimeout(timer); }
}

/** Ville d'un lieu : règles dans regles.ts (pays écrit, sinon pays par défaut de l'agenda ; élément exact ; code postal) */
async function photon(q: string): Promise<any[]> {
  const r = await fetch(`https://photon.komoot.io/api/?limit=10&lang=fr&layer=city&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('service de lieux indisponible');
  return (await r.json()).features || [];
}
async function cityOf(location: string, country: string | null) { try { return await chooseCity(location, country, photon); } catch { return null; } }   // indisponible : à préciser

type Ev = { id: string; time_zone?: string | null; recurring_id?: string | null; title?: string | null; location?: string | null; start?: string | null; end?: string | null;
  start_date?: string | null; end_date?: string | null; transparency?: string; visibility?: string; type?: string };

async function syncOne(cal: any, url: string, secret: string) {
  const now = Date.now(), tmin = new Date(now - 30 * DAY).toISOString(), tmax = new Date(now + 548 * DAY).toISOString();
  await admin.from('artist_calendars').update({ last_run_at: new Date().toISOString() }).eq('id', cal.id);
  try {
    const j = await script(url, secret, 'events', { calendar_id: cal.calendar_id, time_min: tmin, time_max: tmax });
    const fb = j.mode === 'disponibilites';
    const { data: old } = await admin.from('artist_calendar_events').select('gcal_event_id, location, city, lat, lng, geo_status, geo_key').eq('calendar_ref', cal.id);
    const country = String(cal.default_country || 'FR').toUpperCase();
    const prev = new Map((old || []).map((o: any) => [o.gcal_event_id, o]));
    const rows = [];
    for (const e of (j.events || []) as Ev[]) {
      const priv = fb || e.visibility === 'private' || e.visibility === 'confidential';
      const title = priv ? null : (e.title || null), location = priv ? null : (e.location || null);
      const isShow = isShowTitle(title);
      let geo: any = { city: null, lat: null, lng: null, geo_key: null, geo_status: location ? 'a_preciser' : 'sans_lieu' };
      if (isShow && location) {
        const p: any = prev.get(e.id);
        // déjà localisé avec le même lieu ET le même pays par défaut : repris tel quel ; sinon recalculé
        if (p && p.geo_key === country + '|' + location && p.geo_status !== 'sans_lieu') geo = { city: p.city, lat: p.lat, lng: p.lng, geo_status: p.geo_status };
        else { const c = await cityOf(location, country); if (c) geo = { city: c.city, lat: c.lat, lng: c.lng, geo_status: 'ok' }; }
        geo.geo_key = country + '|' + location;
      }
      const allDay = !!e.start_date;
      rows.push({ calendar_ref: cal.id, project_id: cal.project_id, gcal_event_id: e.id, recurring_id: e.recurring_id || null,
        all_day: allDay, start_at: allDay ? null : e.start, end_at: allDay ? null : e.end, start_date: allDay ? e.start_date : null, end_date: allDay ? e.end_date : null,
        time_zone: allDay ? null : (e.time_zone || null),   // jour local de l'événement (affichage) ; conflits comparés sur les instants
        busy: e.transparency !== 'transparent', private: priv, title, location, is_show: isShow, ...geo, deleted_at: null, updated_at: new Date().toISOString() });
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('artist_calendar_events').upsert(rows.slice(i, i + 500), { onConflict: 'calendar_ref,gcal_event_id' });
      if (error) throw new Error('Enregistrement des événements : ' + error.message);
    }
    // occurrences de la fenêtre absentes de Google : supprimées dans l'agenda → marquées, jamais effacées
    const seen = new Set(rows.map((r) => r.gcal_event_id));
    const gone = (old || []).map((o: any) => o.gcal_event_id).filter((id: string) => !seen.has(id));
    for (let i = 0; i < gone.length; i += 200) {
      await admin.from('artist_calendar_events').update({ deleted_at: new Date().toISOString() }).eq('calendar_ref', cal.id).in('gcal_event_id', gone.slice(i, i + 200))
        .is('deleted_at', null).or(`start_at.gte.${tmin},start_date.gte.${tmin.slice(0, 10)}`);
    }
    await admin.from('artist_calendars').update({ last_ok_at: new Date().toISOString(), last_error: null, mode: j.mode }).eq('id', cal.id);
    return { project_id: cal.project_id, ok: true, events: rows.length, removed: gone.length };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500);
    await admin.from('artist_calendars').update({ last_error: msg }).eq('id', cal.id);
    return { project_id: cal.project_id, ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Demande refusée' }, 405);
  const { data: st, error: se } = await admin.from('settings').select('key, value').in('key', ['calendar_script_url', 'drive_webhook_secret']);
  if (se) return json({ ok: false, error: 'Réglages illisibles pour le moment.' }, 500);
  const val = (k: string) => String(st?.find((r: any) => r.key === k)?.value ?? '').trim();
  const url = val('calendar_script_url'), secret = val('drive_webhook_secret');
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
  if (!url) return json({ ok: false, error: 'Le script des calendriers n’est pas encore installé : Réglages › Google.' });
  if (!scriptUrlOk(url)) return json({ ok: false, error: 'L’adresse du script des calendriers n’est pas une adresse de script publiée (…/exec).' });
  try {
    if (body?.mode === 'calendars') {
      if (!team) return json({ ok: false, error: 'Réservé à l’équipe' }, 403);
      const j = await script(url, secret, 'calendars');
      return json({ ok: true, calendars: j.calendars || [] });
    }
    let q = admin.from('artist_calendars').select('*').eq('status', 'actif');
    if (team && body?.project_id) q = q.eq('project_id', String(body.project_id));
    const { data: cals, error } = await q;
    if (error) throw new Error(error.message);
    const results = [];
    for (const c of cals || []) results.push(await syncOne(c, url, secret));
    return json({ ok: results.every((r) => r.ok), results, error: results.find((r) => !r.ok)?.error });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 500) });
  }
});
