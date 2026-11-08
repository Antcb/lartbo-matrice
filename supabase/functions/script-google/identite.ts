// Identité de l'appelant transmise aux scripts Google (v1.60.4, décision d'Anthony du 08/11/2026 : la recherche par Message-ID dans
// la boîte anthony@ est réservée à son titulaire ; connaître l'identifiant d'un message n'autorise pas à consulter la boîte).
// Le relais lit l'adresse du compte connecté dans la session vérifiée par Supabase Auth (jamais dans la demande du navigateur) et
// l'envoie au script avec une signature HMAC-SHA256 calculée avec le code secret des scripts : le navigateur, qui n'a pas ce code,
// ne peut ni fabriquer ni remplacer cette identité. Même calcul dans apps-script/Prospection.gs (callerOk_), contrôlé par
// tests/static/acces-boite.mjs. Aucune dépendance : Web Crypto (Deno et Node).

/** Signature de l'identité : HMAC-SHA256(code secret, « matrice-caller:<adresse en minuscules> »), en hexadécimal */
export async function callerSig(secret: string, email: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('matrice-caller:' + email.trim().toLowerCase()));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Corps envoyé au script : la demande du navigateur d'abord, puis action, code secret et identité signée — rien dans « payload »
 *  ne peut les remplacer */
export async function outgoingBody(payload: Record<string, unknown>, action: string, secret: string, email: string): Promise<string> {
  const caller = email.trim().toLowerCase();
  // sans code secret enregistré, pas de signature (le script refuse de toute façon une demande sans code secret)
  return JSON.stringify({ ...payload, action, secret, caller, caller_sig: secret ? await callerSig(secret, caller) : '' });
}
