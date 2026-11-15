// Relais vers les scripts Google (Apps Script) — lot Sécurité v1.47 (décision d'Anthony du 27/10/2026 : secrets exclusivement côté serveur).
// Le navigateur n'a plus le code secret des scripts : il appelle cette fonction avec la session de l'utilisateur ; la fonction vérifie
// que c'est un compte de l'équipe (is_team), lit l'adresse du script et le code secret côté serveur, et transmet la demande.
//   POST { target: 'main' | 'prospect', action, payload } → réponse du script ({ ok, … }) ou { ok: false, error: 'message français' }
// (v1.60.4) Le relais transmet aussi l'adresse du compte connecté, signée avec une clé dédiée jamais transmise (identite.ts). Les appels de la base (dossier Drive d'une date…)
// et de la fonction pennylane passent toujours directement, côté serveur.
// (Réserve sécurité du 10/11/2026) Script de prospection (boîte anthony@) : code secret DÉDIÉ prospect_script_secret (coffre privé,
// migration 2026-11-10_v1.61.1_secret_prospection.sql ; propriété SECRET_PROSPECTION du script) — jamais celui du script principal
// (drive_webhook_secret), sauf repli de TRANSITION ci-dessous ; pièces jointes contrôlées ici (identite.ts, attachmentsCheck).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { attachmentsCheck, isOldProspectRefusal, outgoingBody, templateDriveIds } from './identite.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Adresse d'un script Google publié (« …/exec »), compte personnel ou Google Workspace : rien d'autre n'est appelé */
export const scriptUrlOk = (u: string) => /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(u);
const TARGETS: Record<string, { key: string; missing: string; unreadable: string }> = {
  main: { key: 'drive_webhook_url', missing: 'Le script Google (Apps Script) n’est pas encore installé.', unreadable: 'Réponse illisible du script' },
  prospect: { key: 'prospect_script_url', missing: 'Le script de prospection n’est pas encore installé : Réglages › Prospection.', unreadable: 'Réponse illisible du script de prospection' },
};
const LIMIT_MS = 140_000;   // la fonction serveur est coupée à 150 s (offre gratuite) : on répond avant

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Demande refusée' }, 405);
  try {
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
    const { data: team } = await user.rpc('is_team');
    if (team !== true) return json({ ok: false, error: 'Accès refusé : connecte-toi avec un compte de l’équipe.' }, 403);
    // (v1.60.4) adresse du compte connecté, vérifiée par Supabase Auth : transmise signée au script (identite.ts), qui peut ainsi
    // réserver une action au titulaire de sa boîte (recherche par Message-ID dans anthony@)
    // (jeton passé explicitement : sans session gardée, getUser() sans argument ne lirait pas l'en-tête Authorization)
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = await user.auth.getUser(jwt);
    const email = String(who?.user?.email || '').trim().toLowerCase();
    if (!email) return json({ ok: false, error: 'Accès refusé : compte connecté illisible, reconnecte-toi.' }, 403);
    const body = await req.json().catch(() => null);
    const t = Object.hasOwn(TARGETS, body?.target || 'main') ? TARGETS[body?.target || 'main'] : null;
    if (!t || typeof body?.action !== 'string' || !/^[a-z_]{2,40}$/.test(body.action)) return json({ ok: false, error: 'Demande illisible' }, 400);
    const target = body?.target || 'main', prospect = target === 'prospect';
    const { data: st, error } = await admin.from('settings').select('key, value').in('key', [t.key, 'drive_webhook_secret']);
    if (error) { console.error('réglages', error.message); return json({ ok: false, error: 'Réglages illisibles pour le moment : réessaie dans un instant.' }, 500); }
    const val = (k: string) => String(st?.find((r: any) => r.key === k)?.value ?? '').trim();
    const url = val(t.key), common = val('drive_webhook_secret');
    if (!url) return json({ ok: false, error: t.missing });
    if (!scriptUrlOk(url)) return json({ ok: false, error: 'L’adresse du script Google enregistrée dans les Réglages n’est pas une adresse de script publiée (…/exec).' });
    // code secret : celui du script principal pour « main », le code DÉDIÉ pour « prospect » (jamais de repli silencieux s'il manque)
    let secret = common;
    if (prospect) {
      const { data: ps } = await admin.rpc('import_secret', { k: 'prospect_script_secret' });
      secret = String(ps || '').trim();
      if (!secret) return json({ ok: false, error: 'Code secret de prospection absent du serveur (migration secret_prospection à appliquer) : rien n’a été fait.' }, 500);
    }
    // le code secret, l'action et l'identité signée passent en dernier : rien dans « payload » ne peut les remplacer
    const payload: Record<string, unknown> = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? { ...body.payload } : {};
    // pièces jointes vers la boîte anthony@ : fichiers des modèles de mail de la Matrice ou liens temporaires de son stockage seulement
    if (prospect && 'attachments' in payload) {
      const { data: tpls, error: te } = await admin.from('mail_templates').select('attachments');
      if (te) { console.error('modèles', te.message); return json({ ok: false, error: 'Modèles de mail illisibles pour le moment : réessaie dans un instant. Rien n’a été envoyé.' }, 500); }
      const chk = attachmentsCheck(payload.attachments, templateDriveIds(tpls), URL_);
      if (!chk.ok) return json({ ok: false, error: chk.error });
      payload.attachments = chk.attachments;
    }
    // clé DÉDIÉE de signature de l'identité (schéma privé, migration v1.60.4 cle_boite) : jamais transmise, seule la signature part
    const { data: signKey } = await admin.rpc('import_secret', { k: 'mailbox_sign_key' });
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), LIMIT_MS);
    // (relecture de f95da56) la cible fait partie de la signature : une demande signée pour « main » ne vaut rien pour « prospect »
    const send = async (code: string) => {
      const outgoing = await outgoingBody(payload, body.action, code, email, String(signKey || ''), Date.now(), target);
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: outgoing, signal: ctl.signal });
      const txt = await r.text();
      try { return { parsed: JSON.parse(txt), ok: true }; } catch { console.error('réponse du script', r.status, txt.slice(0, 300)); return { parsed: null, ok: false }; }
    };
    let res: { parsed: any; ok: boolean };
    try {
      res = await send(secret);
      // TRANSITION : ancien script de prospection pas encore redéployé (refus avant toute action) → même demande avec le code commun
      if (prospect && res.ok && isOldProspectRefusal(res.parsed) && common) res = await send(common);
    } catch (e) {
      if (ctl.signal.aborted) return json({ ok: false, error: 'Le script Google met plus de 2 minutes : il continue sans doute en arrière-plan. Réessaie ou vérifie le résultat dans quelques minutes.' }, 504);
      throw e;
    } finally { clearTimeout(timer); }
    return res.ok ? json(res.parsed) : json({ ok: false, error: t.unreadable });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'Script Google injoignable pour le moment : réessaie dans un instant.' }, 502);
  }
});
