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
 * (v1.63, messagerie) Identifiant signé, UNE règle pour toutes les actions de boîte de Prospection.gs :
 *  - « mail_by_msgid », « thread_by_msgid » : le Message-ID (inchangé depuis la v1.60.4 / v1.60.8) ;
 *  - toute autre action : « sha256: » + empreinte de la demande ENTIÈRE (forme canonique : clés triées, JSON), champs réservés
 *    exclus (action, secret, caller…). Une signature captée ne peut donc servir ni pour une autre conversation, ni pour un autre
 *    destinataire, texte ou rangement : seulement pour la même demande, une fois, dans les 5 minutes.
 * Même calcul dans apps-script/Prospection.gs (canon_, identOf_), contrôlé par tests/static/messagerie-regles.mjs.
 */
export const RESERVED = ['action', 'secret', 'caller', 'caller_ts', 'caller_sig'];
export function canon(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as Record<string, unknown>).sort()
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canon((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
export async function identOf(action: string, payload: Record<string, unknown>): Promise<string> {
  // recherche par Message-ID (message seul, ou sa conversation : v1.60.8) : le Message-ID, comme publié — « want » ne peut viser
  // que des messages de CETTE conversation, déjà couverte par l'identifiant signé
  if (action === 'mail_by_msgid' || action === 'thread_by_msgid') return typeof payload.message_id === 'string' ? payload.message_id : '';
  const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => !RESERVED.includes(k)));
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon(rest)));
  return 'sha256:' + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Corps envoyé au script : la demande du navigateur d'abord, puis action, code secret des scripts et identité signée — rien dans
 * « payload » ne peut les remplacer. signKey : clé dédiée (jamais envoyée) ; absente → identité sans signature (refusée par le
 * script de prospection, sans effet sur les autres actions).
 */
export async function outgoingBody(payload: Record<string, unknown>, action: string, secret: string, email: string,
  signKey: string, now: number = Date.now(), target: string = 'prospect'): Promise<string> {
  const caller = email.trim().toLowerCase();
  const mailbox = MAILBOX_OF[target] || '';
  const caller_sig = signKey && mailbox ? await callerSig(signKey, target, mailbox, caller, action, await identOf(action, payload), now) : '';
  return JSON.stringify({ ...payload, action, secret, caller, caller_ts: now, caller_sig });
}
