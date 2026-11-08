// Identité de l'appelant transmise aux scripts Google (v1.60.4, décision d'Anthony du 08/11/2026 : la recherche par Message-ID dans
// la boîte anthony@ est réservée à son titulaire ; connaître l'identifiant d'un message n'autorise pas à consulter la boîte).
// Le relais lit l'adresse du compte connecté dans la session vérifiée par Supabase Auth (jamais dans la demande du navigateur) et
// l'envoie au script avec une signature HMAC-SHA256 calculée avec une CLÉ DÉDIÉE (relecture de 3ca7f59, B1) :
//  - la clé « mailbox_sign_key » est tirée au hasard une fois par la migration 2026-11-08_v1.60.4_cle_boite.sql (schéma privé),
//    lue par le relais via import_secret, recopiée par Anthony dans la propriété CLE_BOITE du script de prospection ;
//  - elle n'est JAMAIS transmise dans une requête (contrairement au code secret des scripts, envoyé à chaque appel et partagé
//    avec production@) : seule la signature part ;
//  - la signature couvre l'adresse, l'action, le Message-ID, l'horodatage et le script destinataire (identifiant de déploiement) :
//    pas de réutilisation pour un autre message, une autre action, un autre script ou plus tard (le script n'accepte qu'une fenêtre de 5 minutes et refuse une signature déjà vue).
// Même calcul dans apps-script/Prospection.gs (callerOk_), contrôlé par tests/static/acces-boite.mjs. Web Crypto (Deno et Node).

/**
 * Identifiant de déploiement d'une adresse de script Google publiée (« …/s/<identifiant>/exec »), quelle que soit la forme :
 * compte personnel (/macros/s/…) ou Google Workspace (/a/macros/<domaine>/s/…). '' si l'adresse n'a pas cette forme.
 * Même lecture dans apps-script/Prospection.gs (deploymentId_), qui la compare à sa propre adresse : une signature captée en
 * redirigeant prospect_script_url vers un autre script ne vaut pas pour le vrai script (durcissement avant séance, 08/11).
 */
export const deploymentId = (url: string) => (String(url || '').match(/^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+|macros)\/s\/([\w-]+)\/(?:exec|dev)(?:[?#].*)?$/) || [])[1] || '';

/** Texte signé : version, adresse en minuscules, action, Message-ID, horodatage (ms), script destinataire — séparés par « | » */
export const signedText = (email: string, action: string, messageId: string, ts: number, target: string) =>
  ['matrice-boite-v2', email.trim().toLowerCase(), action, messageId, String(ts), target].join('|');

/** HMAC-SHA256(clé dédiée, texte signé), en hexadécimal minuscule ; target = identifiant de déploiement du script destinataire */
export async function callerSig(key: string, email: string, action: string, messageId: string, ts: number, target: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(signedText(email, action, messageId, ts, target)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Corps envoyé au script : la demande du navigateur d'abord, puis action, code secret des scripts et identité signée — rien dans
 * « payload » ne peut les remplacer. signKey : clé dédiée (jamais envoyée) ; absente → identité sans signature (refusée par le
 * script de prospection, sans effet sur les autres actions).
 */
export async function outgoingBody(payload: Record<string, unknown>, action: string, secret: string, email: string,
  signKey: string, scriptUrl: string, now: number = Date.now()): Promise<string> {
  const caller = email.trim().toLowerCase();
  const messageId = typeof payload.message_id === 'string' ? payload.message_id : '';
  const target = deploymentId(scriptUrl);
  const caller_sig = signKey && target ? await callerSig(signKey, caller, action, messageId, now, target) : '';
  return JSON.stringify({ ...payload, action, secret, caller, caller_ts: now, caller_sig });
}
