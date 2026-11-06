// Messagerie intégrée (v1.61) — synchronisation de la boîte anthony@ (Gmail = référence) vers L'ArtBotrice.
//   - tâche planifiée de la base (toutes les 5 min, en-tête x-hook-secret = code des scripts Google) : { mode: 'sync' }
//   - équipe connectée (is_team) : { mode: 'sync' } (« Actualiser ») ou { mode: 'threads', ids: [...] } (conversations ouvertes /
//     trouvées par une recherche Gmail : relues côté serveur, jamais reprises telles que fournies par le navigateur).
// Le script de prospection lit Gmail ; cette fonction enregistre conversations et messages (identifiants Gmail uniques : aucun doublon),
// ne touche jamais au rattachement existant, puis lance mail_process (rattachement automatique, journal du suivi, suspension des relances).
// Rien n'est envoyé ni modifié dans Gmail ici. Dernier passage et erreur visibles dans l'espace Mails (mail_sync_state).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hook-secret' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const MAILBOX = 'anthony';
const LIMIT_MS = 120_000;
/** Même contrôle que le relais script-google : adresse d'un script Google publié (…/exec) et rien d'autre */
const scriptUrlOk = (u: string) => /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(u);

type Addr = { email: string; name?: string };
type Msg = { id: string; rfc_id?: string; from: Addr; to: Addr[]; cc: Addr[]; subject: string; date: string; snippet: string;
  direction: 'in' | 'out'; attachments: { name: string; size: number; mime: string }[] };
type Thread = { id: string; missing?: boolean; subject: string; snippet: string; last_at: string | null; count: number; unread: boolean;
  labels: string[]; participants: Addr[]; messages: Msg[] };

/** Égalité à temps constant (code partagé avec la tâche planifiée) */
function same(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function script(url: string, secret: string, action: string, payload: Record<string, unknown>) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), LIMIT_MS);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, action, secret }), signal: ctl.signal });
    const txt = await r.text();
    let j: any; try { j = JSON.parse(txt); } catch { throw new Error('Réponse illisible du script de prospection'); }
    if (!j?.ok) throw new Error(j?.error || 'Le script de prospection a refusé la demande');
    return j;
  } catch (e) {
    if (ctl.signal.aborted) throw new Error('Le script de prospection met plus de 2 minutes : synchronisation reprise au prochain passage.');
    throw e;
  } finally { clearTimeout(timer); }
}

/** Enregistre les conversations ; renvoie les identifiants internes à traiter. Le rattachement n'est jamais modifié ici. */
async function store(threads: Thread[]) {
  const ids: string[] = [];
  for (const t of threads) {
    if (t.missing || !t.id) continue;   // supprimée définitivement de Gmail : la ligne reste (historique), rien n'est effacé
    const row = { mailbox: MAILBOX, gmail_thread_id: t.id, subject: t.subject || null, snippet: t.snippet || null,
      participants: [...new Set((t.participants || []).map((p) => String(p.email || '').toLowerCase()).filter(Boolean))],
      last_message_at: t.last_at, message_count: t.count || 0, unread: !!t.unread, labels: t.labels || [] };
    const { data, error } = await admin.from('mail_threads').upsert(row, { onConflict: 'mailbox,gmail_thread_id' }).select('id').single();
    if (error) throw new Error('Enregistrement d’une conversation : ' + error.message);
    ids.push(data.id);
    const msgs = (t.messages || []).map((m) => ({ thread_id: data.id, mailbox: MAILBOX, gmail_message_id: m.id, rfc_message_id: m.rfc_id || null,
      direction: m.direction === 'out' ? 'out' : 'in', from_addr: String(m.from?.email || '').toLowerCase() || null, from_name: m.from?.name || null,
      to_addrs: (m.to || []).map((a) => a.email.toLowerCase()), cc_addrs: (m.cc || []).map((a) => a.email.toLowerCase()),
      subject: m.subject || null, snippet: m.snippet || null, sent_at: m.date || null,
      attachments: (m.attachments || []).map((a) => ({ name: a.name, size: a.size, mime: a.mime })) }));
    if (msgs.length) {
      const { error: e2 } = await admin.from('mail_messages').upsert(msgs, { onConflict: 'mailbox,gmail_message_id', ignoreDuplicates: true });
      if (e2) throw new Error('Enregistrement des messages : ' + e2.message);
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
  const hook = req.headers.get('x-hook-secret') || '';
  let allowed = !!hook && same(hook, secret);
  if (!allowed) {
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
    const { data: team } = await user.rpc('is_team');
    allowed = team === true;
  }
  if (!allowed) return json({ ok: false, error: 'Accès refusé : connecte-toi avec un compte de l’équipe.' }, 403);
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'threads' ? 'threads' : 'sync';
  if (!url) return json({ ok: false, error: 'Le script de prospection n’est pas encore installé : Réglages › Prospection.' });
  if (!scriptUrlOk(url)) return json({ ok: false, error: 'L’adresse du script de prospection n’est pas une adresse de script publiée (…/exec).' });

  const now = new Date().toISOString();
  try {
    let threads: Thread[] = [], historyId: string | null = null, remaining = 0;
    if (mode === 'threads') {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((s: string) => /^[0-9a-f]{6,32}$/i.test(s)).slice(0, 25);
      for (const id of ids) {
        const j = await script(url, secret, 'thread', { thread_id: id });
        threads.push(j.thread);
      }
    } else {
      const { data: state } = await admin.from('mail_sync_state').select('history_id').eq('mailbox', MAILBOX).maybeSingle();
      await admin.from('mail_sync_state').upsert({ mailbox: MAILBOX, last_run_at: now }, { onConflict: 'mailbox' });
      const j = await script(url, secret, 'history', { start_history_id: state?.history_id || null, max: 30 });
      threads = j.threads || []; remaining = (j.remaining || []).length;
      // conversations restantes : point de reprise inchangé, elles reviennent au prochain passage
      historyId = remaining ? (state?.history_id || null) : (j.history_id ? String(j.history_id) : null);
    }
    const ids = await store(threads);
    const { data: processed, error: pe } = ids.length ? await admin.rpc('mail_process', { p_threads: ids }) : { data: 0, error: null };
    if (pe) throw new Error('Rattachement / journal : ' + pe.message);
    if (mode === 'sync') {
      const patch: Record<string, unknown> = { mailbox: MAILBOX, last_ok_at: new Date().toISOString(), last_error: null };
      if (historyId) patch.history_id = historyId;
      await admin.from('mail_sync_state').upsert(patch, { onConflict: 'mailbox' });
    }
    return json({ ok: true, threads: ids.length, journal: processed ?? 0, remaining });
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500);
    console.error('mail-sync', msg);
    if (mode === 'sync') await admin.from('mail_sync_state').upsert({ mailbox: MAILBOX, last_error: msg, last_run_at: now }, { onConflict: 'mailbox' });
    return json({ ok: false, error: msg });
  }
});
