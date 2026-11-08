// Messagerie intégrée (v1.61) — synchronisation de la boîte anthony@ (Gmail = référence) vers L'ArtBotrice.
//   - tâche planifiée de la base (toutes les 5 min, en-tête x-hook-secret = secret serveur dédié « mail_sync_hook ») : { mode: 'sync' }
//   - équipe connectée (is_team) : { mode: 'sync' } (« Actualiser ») ou { mode: 'threads', ids: [...] } (conversations ouvertes /
//     trouvées par une recherche Gmail : relues côté serveur, jamais reprises telles que fournies par le navigateur).
// Le script de prospection lit Gmail ; cette fonction enregistre conversations et messages (identifiants Gmail uniques : aucun doublon),
// ne touche jamais au rattachement existant, puis lance mail_process (rattachement automatique, journal du suivi, suspension des relances).
// Rien n'est envoyé ni modifié dans Gmail ici. Dernier passage et erreur visibles dans l'espace Mails (mail_sync_state).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { acces, messageRows, scriptUrlOk, threadIds, threadRow, type Thread } from './regles.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hook-secret' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const MAILBOX = 'anthony';
const LIMIT_MS = 120_000;
/** Erreur expliquée à l'utilisateur (message rédigé ici) ; toute autre erreur n'est montrée que sous une forme générique
 *  (détail technique seulement dans le journal du serveur — CodeQL « stack trace exposure ») */
class Explique extends Error {}
const shown = (e: unknown) => e instanceof Explique ? e.message.slice(0, 500) : 'Erreur interne de la synchronisation (détail dans le journal du serveur).';

async function script(url: string, secret: string, action: string, payload: Record<string, unknown>) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), LIMIT_MS);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, action, secret }), signal: ctl.signal });
    const txt = await r.text();
    let j: any; try { j = JSON.parse(txt); } catch { throw new Explique('Réponse illisible du script de prospection'); }
    if (!j?.ok) throw new Explique(String(j?.error || '').slice(0, 300) || 'Le script de prospection a refusé la demande');
    return j;
  } catch (e) {
    if (ctl.signal.aborted) throw new Explique('Le script de prospection met plus de 2 minutes : synchronisation reprise au prochain passage.');
    throw e;
  } finally { clearTimeout(timer); }
}

/** Enregistre les conversations ; renvoie les identifiants internes à traiter. Le rattachement n'est jamais modifié ici. */
async function store(threads: Thread[]) {
  const ids: string[] = [];
  for (const t of threads) {
    if (t.missing || !t.id) continue;   // supprimée définitivement de Gmail : la ligne reste (historique), rien n'est effacé
    const { data, error } = await admin.from('mail_threads').upsert(threadRow(MAILBOX, t), { onConflict: 'mailbox,gmail_thread_id' }).select('id').single();
    if (error) { console.error('Enregistrement d’une conversation', error.message); throw new Explique('Enregistrement d’une conversation impossible pour le moment.'); }
    ids.push(data.id);
    const msgs = messageRows(MAILBOX, data.id, t);
    if (msgs.length) {
      // message déjà connu : libellés / pièces jointes mis à jour ; son lien avec le journal (prospect_log_id, non envoyé ici) est gardé
      const { error: e2 } = await admin.from('mail_messages').upsert(msgs, { onConflict: 'mailbox,gmail_message_id' });
      if (e2) { console.error('Enregistrement des messages', e2.message); throw new Explique('Enregistrement des messages impossible pour le moment.'); }
    }
  }
  return ids;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Demande refusée' }, 405);
  const { data: st, error: se } = await admin.from('settings').select('key, value').in('key', ['prospect_script_url', 'drive_webhook_secret']);
  if (se) return json({ ok: false, error: 'Réglages illisibles pour le moment.' }, 500);
  const val = (k: string) => String(st?.find((r: any) => r.key === k)?.value ?? '').trim();
  const url = val('prospect_script_url'), secret = val('drive_webhook_secret');
  // accès : tâche planifiée (code partagé) ou compte de l'équipe
  // appel automatique : secret serveur DÉDIÉ (« mail_sync_hook », créé par la migration dans le schéma privé, jamais affiché, jamais
  // dans le navigateur, une adresse ou un journal) ; sinon compte de l'équipe. Sans justificatif ou justificatif faux : 403.
  const hook = req.headers.get('x-hook-secret') || '';
  const { data: hookSecret } = hook ? await admin.rpc('import_secret', { k: 'mail_sync_hook' }) : { data: null };
  // session de l'appelant : is_team() exécuté avec SA session (jamais avec le rôle serveur)
  let team = false;
  if (req.headers.get('Authorization')) {
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
    const { data } = await user.rpc('is_team');
    team = data === true;
  }
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'threads' ? 'threads' : 'sync';
  // le secret de la tâche planifiée ne sert qu'à la synchronisation planifiée ; relire des conversations précises = compte de l'équipe
  const ok = acces({ hook, hookSecret: hookSecret ? String(hookSecret) : null, team, mode });
  if (!ok.ok) return json({ ok: false, error: ok.error }, ok.status);
  if (!url) return json({ ok: false, error: 'Le script de prospection n’est pas encore installé : Réglages › Prospection.' });
  if (!scriptUrlOk(url)) return json({ ok: false, error: 'L’adresse du script de prospection n’est pas une adresse de script publiée (…/exec).' });

  const now = new Date().toISOString();
  try {
    let threads: Thread[] = [], historyId: string | null = null, remaining = 0, pendingAfter: string[] = [];
    if (mode === 'threads') {
      const ids = threadIds(body.ids);
      for (const id of ids) {
        const j = await script(url, secret, 'thread', { thread_id: id });
        threads.push(j.thread);
      }
    } else {
      // plus de 30 conversations changées : le reste est gardé (pending) et lu aux passages suivants, le point de reprise avance
      // toujours (relecture v1.61, B1 : jamais deux fois les mêmes 30, plus de balayage complet sans fin)
      const { data: state } = await admin.from('mail_sync_state').select('history_id, pending').eq('mailbox', MAILBOX).maybeSingle();
      await admin.from('mail_sync_state').upsert({ mailbox: MAILBOX, last_run_at: now }, { onConflict: 'mailbox' });
      const pending: string[] = state?.pending || [];
      if (pending.length) {
        const j = await script(url, secret, 'history', { ids: pending.slice(0, 30) });
        threads = j.threads || []; pendingAfter = pending.slice(30);
      } else {
        const j = await script(url, secret, 'history', { start_history_id: state?.history_id || null, max: 30 });
        threads = j.threads || []; pendingAfter = (j.remaining || []).map(String);
        historyId = j.history_id ? String(j.history_id) : null;
      }
      remaining = pendingAfter.length;
    }
    const ids = await store(threads);
    const { data: processed, error: pe } = ids.length ? await admin.rpc('mail_process', { p_threads: ids }) : { data: 0, error: null };
    if (pe) { console.error('Rattachement / journal', pe.message); throw new Explique('Rattachement / journal impossible pour le moment.'); }
    if (mode === 'sync') {
      const patch: Record<string, unknown> = { mailbox: MAILBOX, last_ok_at: new Date().toISOString(), last_error: null, pending: pendingAfter };
      if (historyId) patch.history_id = historyId;
      await admin.from('mail_sync_state').upsert(patch, { onConflict: 'mailbox' });
    }
    return json({ ok: true, threads: ids.length, journal: processed ?? 0, remaining });
  } catch (e) {
    if (!(e instanceof Explique)) console.error(e);
    const msg = shown(e);
    console.error('mail-sync', msg);
    if (mode === 'sync') await admin.from('mail_sync_state').upsert({ mailbox: MAILBOX, last_error: msg, last_run_at: now }, { onConflict: 'mailbox' });
    return json({ ok: false, error: msg });
  }
});
