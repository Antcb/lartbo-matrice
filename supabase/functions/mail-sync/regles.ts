// Règles de la synchronisation de la messagerie (v1.63), sans accès réseau ni base : testées par tests/static/messagerie-regles.mjs.
// index.ts les applique ; aucune autre copie de ces règles.

export type Addr = { email: string; name?: string };
export type Msg = { id: string; rfc_id?: string; refs?: string[]; from: Addr; to: Addr[]; cc: Addr[]; subject: string; date: string; snippet: string;
  direction: 'in' | 'out'; draft?: boolean; auto?: string; attachments: { name: string; size: number; mime: string; inline?: boolean }[] };
export type Thread = { id: string; missing?: boolean; subject: string; snippet: string; last_at: string | null; count: number; unread: boolean;
  labels: string[]; participants: Addr[]; messages: Msg[] };

/** Égalité à temps constant (secret de la tâche planifiée) */
export function same(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Accès : secret DÉDIÉ de la tâche planifiée (synchronisation planifiée seulement) ou session du PROPRIÉTAIRE de la boîte
 * (anthony@ réservée au compte d'Anthony, décision du 08/11/2026 ; is_mailbox_owner exécuté avec la session de l'appelant).
 * Tout le reste — autre membre de l'équipe compris : refusé (403), avant toute lecture de Gmail ou écriture en base.
 */
export function acces(o: { hook: string; hookSecret: string | null; owner: boolean; mode: 'sync' | 'threads' }) {
  const parHook = !!o.hook && !!o.hookSecret && same(o.hook, String(o.hookSecret));
  if (!parHook && !o.owner) return { ok: false, status: 403, error: 'Accès refusé : la boîte anthony@ est réservée au compte d’Anthony.' };
  if (o.mode === 'threads' && !o.owner) return { ok: false, status: 403, error: 'Réservé au compte d’Anthony' };
  return { ok: true, status: 200, error: '' };
}

/** Adresse d'un script Google publié (…/exec) et rien d'autre (même contrôle que le relais script-google) */
export const scriptUrlOk = (u: string) => /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(u);

/** Identifiants Gmail de conversation acceptés depuis le navigateur (relus côté serveur, jamais repris tels quels) */
export const threadIds = (ids: unknown) => (Array.isArray(ids) ? ids : []).map(String).filter((s) => /^[0-9a-f]{6,32}$/i.test(s)).slice(0, 25);

const low = (e: unknown) => String(e || '').trim().toLowerCase();
const rfcOk = (s: unknown) => /^<[^<>\s]{1,250}>$/.test(String(s || '').trim());

/** Ligne mail_threads (le rattachement n'en fait jamais partie : il n'est jamais modifié par la synchronisation) */
export function threadRow(mailbox: string, t: Thread) {
  return { mailbox, gmail_thread_id: t.id, subject: t.subject || null, snippet: t.snippet || null,
    participants: [...new Set((t.participants || []).map((p) => low(p.email)).filter(Boolean))],
    last_message_at: t.last_at, message_count: t.count || 0, unread: !!t.unread, labels: t.labels || [] };
}

/** Lignes mail_messages : brouillons exclus (un brouillon n'est jamais un envoi), une ligne par identifiant Gmail */
export function messageRows(mailbox: string, threadId: string, t: Thread) {
  const seen = new Set<string>();
  return (t.messages || []).filter((m) => m && m.id && !m.draft && !seen.has(m.id) && seen.add(m.id)).map((m) => ({
    thread_id: threadId, mailbox, gmail_message_id: m.id, rfc_message_id: rfcOk(m.rfc_id) ? String(m.rfc_id).trim() : null,
    ref_ids: (m.refs || []).filter(rfcOk).map((x) => String(x).trim()).slice(0, 50),
    direction: m.direction === 'out' ? 'out' : 'in',
    // avis de non-remise / réponse automatique (en-têtes lus par le script) : jamais comptés comme une réponse
    auto_kind: m.direction === 'out' ? null : m.auto === 'ndr' || m.auto === 'auto' ? m.auto : null,
    from_addr: low(m.from?.email) || null, from_name: m.from?.name || null,
    to_addrs: (m.to || []).map((a) => low(a.email)).filter(Boolean), cc_addrs: (m.cc || []).map((a) => low(a.email)).filter(Boolean),
    subject: m.subject || null, snippet: m.snippet || null, sent_at: m.date || null,
    attachments: (m.attachments || []).map((a) => ({ name: a.name, size: a.size, mime: a.mime, ...(a.inline ? { inline: true } : {}) })) }));
}

/** Réponse du script acceptée seulement si le compte qui l'exécute (« account ») est le titulaire inscrit (adresse remplacée → refus) */
export const compteOk = (account: unknown, owner: string) => !!owner && String(account || '').trim().toLowerCase() === owner.trim().toLowerCase();

/**
 * Mode essai (réglage mail_essai_libelle du projet de TEST, v1.63) : la réponse doit venir d'un script en mode essai sur CE libellé,
 * et seules les conversations qui le portent (au niveau de la conversation) sont enregistrées. Réglage vide : sans effet.
 */
export function essaiOk(reponse: { essai?: { libelle?: string; id?: string } } | null, libelle: string) {
  if (!libelle) return true;
  return !!reponse?.essai?.id && reponse.essai.libelle === libelle;
}
export const threadsEssai = <T extends { labels?: string[]; missing?: boolean }>(threads: T[], id: string | undefined) =>
  !id ? threads : threads.filter((t) => !t.missing && (t.labels || []).includes(id));

/** Refus du script pour une conversation qui n'est pas TEST (code « hors_essai », jamais déduit du texte du message) */
export const horsEssai = (j: unknown) => !!j && typeof j === 'object' && (j as Record<string, unknown>).refused === true && (j as Record<string, unknown>).code === 'hors_essai';
