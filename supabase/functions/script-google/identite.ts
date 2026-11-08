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

/** Texte signé : version, adresse en minuscules, action, Message-ID, horodatage (ms) — séparés par « | ».
 *  (L'adresse du script destinataire n'est PAS signée : ScriptApp.getService().getUrl() n'est pas fiable côté script depuis V8 ;
 *  décision du 08/11 après relecture de 2a83703.) */
export const signedText = (email: string, action: string, messageId: string, ts: number) =>
  ['matrice-boite-v1', email.trim().toLowerCase(), action, messageId, String(ts)].join('|');

/** HMAC-SHA256(clé dédiée, texte signé), en hexadécimal minuscule */
export async function callerSig(key: string, email: string, action: string, messageId: string, ts: number): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(signedText(email, action, messageId, ts)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Corps envoyé au script : la demande du navigateur d'abord, puis action, code secret des scripts et identité signée — rien dans
 * « payload » ne peut les remplacer. signKey : clé dédiée (jamais envoyée) ; absente → identité sans signature (refusée par le
 * script de prospection, sans effet sur les autres actions).
 */
export async function outgoingBody(payload: Record<string, unknown>, action: string, secret: string, email: string,
  signKey: string, now: number = Date.now()): Promise<string> {
  const caller = email.trim().toLowerCase();
  const messageId = typeof payload.message_id === 'string' ? payload.message_id : '';
  const caller_sig = signKey ? await callerSig(signKey, caller, action, messageId, now) : '';
  return JSON.stringify({ ...payload, action, secret, caller, caller_ts: now, caller_sig });
}
