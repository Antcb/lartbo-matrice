// Identité de l'appelant transmise aux scripts Google (v1.60.4, décision d'Anthony du 08/11/2026 : la recherche par Message-ID dans
// la boîte anthony@ est réservée à son titulaire ; connaître l'identifiant d'un message n'autorise pas à consulter la boîte).
// Le relais lit l'adresse du compte connecté dans la session vérifiée par Supabase Auth (jamais dans la demande du navigateur) et
// l'envoie au script avec une signature HMAC-SHA256 calculée avec une CLÉ DÉDIÉE (relecture de 3ca7f59, B1) :
//  - la clé « mailbox_sign_key » est tirée au hasard une fois par la migration 2026-11-08_v1.60.4_cle_boite.sql (schéma privé),
//    lue par le relais via import_secret, recopiée par Anthony dans la propriété CLE_BOITE du script de prospection ;
//  - elle n'est JAMAIS transmise dans une requête (contrairement au code secret des scripts, envoyé à chaque appel et partagé
//    avec production@) : seule la signature part ;
//  - la signature couvre l'adresse, l'action, le Message-ID et l'horodatage : pas de réutilisation pour un autre message, une autre
//    action ou plus tard (le script n'accepte qu'une fenêtre de 5 minutes et refuse une signature déjà vue).
// Même calcul dans apps-script/Prospection.gs (callerOk_), contrôlé par tests/static/acces-boite.mjs. Web Crypto (Deno et Node).

/**
 * Texte signé (v2, relecture de f95da56) : version, CIBLE (« prospect » | « main »), BOÎTE (« anthony » | « production »), adresse en
 * minuscules, action, identifiant, horodatage (ms) — séparés par « | ». Chaque script compare cible et boîte à SES constantes :
 * une demande signée pour le script principal (adresse drive_webhook_url, modifiable par l'équipe) est refusée par le script de
 * la boîte anthony@, et inversement. (L'adresse du script destinataire n'est toujours pas signée : ScriptApp.getService().getUrl()
 * n'est pas fiable côté script depuis V8 — décision du 08/11 après relecture de 2a83703.)
 */
export const MAILBOX_OF: Record<string, string> = { prospect: 'anthony', main: 'production' };
export const signedText = (target: string, mailbox: string, email: string, action: string, ident: string, ts: number) =>
  ['matrice-boite-v2', target, mailbox, email.trim().toLowerCase(), action, ident, String(ts)].join('|');

/** HMAC-SHA256(clé dédiée, texte signé), en hexadécimal minuscule */
export async function callerSig(key: string, target: string, mailbox: string, email: string, action: string, ident: string, ts: number): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(signedText(target, mailbox, email, action, ident, ts)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Corps envoyé au script : la demande du navigateur d'abord, puis action, code secret des scripts et identité signée — rien dans
 * « payload » ne peut les remplacer. signKey : clé dédiée (jamais envoyée) ; absente → identité sans signature (refusée par le
 * script de prospection, sans effet sur les autres actions).
 */
export async function outgoingBody(payload: Record<string, unknown>, action: string, secret: string, email: string,
  signKey: string, now: number = Date.now(), target: string = 'prospect'): Promise<string> {
  const caller = email.trim().toLowerCase();
  const messageId = typeof payload.message_id === 'string' ? payload.message_id : '';   // identifiant signé (Message-ID)
  const mailbox = MAILBOX_OF[target] || '';
  const caller_sig = signKey && mailbox ? await callerSig(signKey, target, mailbox, caller, action, messageId, now) : '';
  // (réserve sécurité du 10/11/2026) fichiers Drive joints, déjà contrôlés par le relais (attachmentsCheck) : leur liste est signée
  // à part (att_sig) — le script de prospection ne lit un fichier Drive que s'il figure dans une liste signée de moins de 5 minutes
  const ids = driveIdsOf(payload.attachments);
  const att = ids.length && signKey && mailbox ? { att_sig: await hmacHex(signKey, attSignedText(target, mailbox, now, ids)) } : {};
  return JSON.stringify({ ...payload, action, secret, caller, caller_ts: now, caller_sig, ...att });
}

// ─────────────── Pièces jointes du script de prospection (réserve sécurité du 10/11/2026) ───────────────
/**
 * Avant : le script de prospection lisait N'IMPORTE QUEL fichier Drive de la boîte anthony@ par son identifiant (blobs_) et allait
 * chercher n'importe quelle adresse. Règle la plus restrictive compatible avec les usages existants (question listée pour Anthony) :
 *  - fichier Drive {id} : seulement un fichier joint à un modèle de mail de la Matrice (mail_templates.attachments, saisi dans
 *    Réglages › Modèles de mail) — contrôlé ICI par le relais, puis liste signée (att_sig, clé CLE_BOITE jamais transmise) vérifiée
 *    par le script ;
 *  - fichier de la Matrice {url, name} : seulement un lien temporaire signé du stockage « suivi » de CE projet Supabase ;
 *  - toute autre forme : la demande entière est refusée, rien n'est créé ni envoyé (jamais de mail parti sans une pièce prévue).
 */
export const DRIVE_ID_RE = /^[\w-]{25,200}$/;
export const ATT_MAX = 20;
export const attSignedText = (target: string, mailbox: string, ts: number, ids: string[]) =>
  ['matrice-pj-v1', target, mailbox, String(ts), ids.join(',')].join('|');
export async function hmacHex(key: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const driveIdsOf = (list: unknown): string[] =>
  Array.isArray(list) ? list.filter((f: any) => f && typeof f === 'object' && typeof f.id === 'string').map((f: any) => f.id) : [];
/** Identifiants Drive joints aux modèles de mail de la Matrice (lignes mail_templates : { attachments }) */
export const templateDriveIds = (rows: unknown): Set<string> => new Set((Array.isArray(rows) ? rows : [])
  .flatMap((r: any) => Array.isArray(r?.attachments) ? r.attachments : [])
  .map((a: any) => typeof a?.id === 'string' ? a.id : '').filter((id: string) => DRIVE_ID_RE.test(id)));
/** Lien temporaire signé du stockage « suivi » de ce projet Supabase (créé par l'application, signedUrl de js/data.js) */
export function matriceUrlOk(u: unknown, supabaseUrl: string): boolean {
  if (typeof u !== 'string' || u.length > 2000) return false;
  try {
    const x = new URL(u), base = new URL(supabaseUrl);
    return x.protocol === 'https:' && x.origin === base.origin && !x.username && !x.password && !x.hash
      && x.pathname.startsWith('/storage/v1/object/sign/suivi/') && !x.pathname.includes('/../') && !!x.searchParams.get('token');
  } catch { return false; }
}
/**
 * Contrôle serveur des pièces jointes envoyées au script de prospection. Renvoie la liste nettoyée (seulement {id} ou {url, name})
 * ou le motif du refus (la demande n'est alors pas transmise). Absence de pièce jointe : rien à contrôler.
 */
export function attachmentsCheck(list: unknown, allowedDrive: Set<string>, supabaseUrl: string):
  { ok: true; attachments?: Array<Record<string, string>> } | { ok: false; error: string } {
  if (list === undefined || list === null) return { ok: true };
  const no = (why: string) => ({ ok: false as const, error: `Pièce jointe refusée : ${why}. Rien n’a été créé ni envoyé.` });
  if (!Array.isArray(list)) return no('liste illisible');
  if (list.length > ATT_MAX) return no(`${ATT_MAX} pièces jointes au plus`);
  const out: Array<Record<string, string>> = [];
  for (const f of list as any[]) {
    if (!f || typeof f !== 'object') return no('pièce illisible');
    if (f.id !== undefined) {
      if (typeof f.id !== 'string' || !DRIVE_ID_RE.test(f.id) || f.url !== undefined) return no('identifiant Drive illisible');
      if (!allowedDrive.has(f.id)) return no('ce fichier Drive n’est joint à aucun modèle de mail de la Matrice (Réglages › Modèles de mail)');
      out.push({ id: f.id });
    } else if (f.url !== undefined) {
      if (!matriceUrlOk(f.url, supabaseUrl)) return no('le lien n’est pas un fichier de la Matrice (lien temporaire expiré ou illisible ? réessaie)');
      out.push({ url: f.url, name: String(f.name ?? 'piece-jointe').slice(0, 200) });
    } else return no('pièce sans fichier (lien temporaire non obtenu : réessaie)');
  }
  return { ok: true, attachments: out };
}

/**
 * TRANSITION (bascule sans coupure) : refus EXACT de l'ancien script de prospection (code v1.60.8 et antérieur, qui n'attend que le
 * code commun). Ce refus intervient avant toute action (rien n'est fait) : le relais renvoie alors la même demande avec le code commun.
 * Le nouveau script ne renvoie jamais ce texte et refuse le code commun : une fois redéployé, ce repli ne sert plus. À retirer dans
 * un lot ultérieur, après confirmation du redéploiement (« Tester » affiche le code v1.61.1).
 */
export const OLD_PROSPECT_REFUSAL = 'Code secret du script de prospection incorrect';
export const isOldProspectRefusal = (o: any) => !!o && typeof o === 'object' && o.ok === false && o.error === OLD_PROSPECT_REFUSAL && Object.keys(o).length === 2; 