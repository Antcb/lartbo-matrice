/**
 * Brevo : ajoute dans Brevo les contacts de la Matrice qui n'y sont pas encore (mail, prénom, nom, structure).
 * Un mail déjà présent dans Brevo n'est JAMAIS modifié : ni ses champs, ni ses listes, ni son désabonnement.
 * Contact lié uniquement à des structures inactives (v1.60.2) : pas ajouté (hors prospection) ; rien n'est supprimé ni désabonné.
 * Exception (depuis la v1.16) : un mail CRÉÉ par la Matrice (contacts.brevo_emails) garde prénom, nom et structure(s) à jour ;
 * ajout ET retrait d'un rattachement à une structure (08/11/2026) : champ « structure » mis à jour, jamais de suppression, de
 * désabonnement ni de retrait de liste. Fonction propre à chaque structure : lue, pas encore transmise (regles.ts).
 * Appelée par un déclencheur de la base à chaque création ou modification d'un contact, à l'ajout ou au retrait d'un
 * rattachement à une structure, à la réactivation d'une structure, ou par Réglages › Brevo pour tout envoyer d'un coup.
 * Réglages lus dans la table settings : brevo_api_key, brevo_list_id (une ou plusieurs listes, séparées par des virgules),
 * brevo_hook_secret (code partagé avec le déclencheur). Ces réglages ne sont lisibles que côté serveur (v1.47).
 * Accès : le déclencheur de la base (code x-hook-secret) ; « tout envoyer » (Réglages) : un compte de l'équipe connecté (v1.47 —
 * le navigateur n'a plus le code secret).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { aAjouter, attributes, type Champs, type ClientBrevo, type Contact, type Link, mailsOf, syncContact } from "./regles.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const API = "https://api.brevo.com/v3";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-hook-secret, authorization, apikey" };
/** Appel à Brevo qui patiente et réessaie quand Brevo dit « trop de demandes » (429), jusqu'à 5 fois */
async function bfetch(url: string, init: RequestInit = {}): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || i >= 4) return r;
    const wait = Number(r.headers.get("retry-after")) * 1000 || 1000 * 2 ** i;
    await new Promise((ok) => setTimeout(ok, Math.min(wait, 10000)));
  }
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function settings() {
  const { data } = await sb.from("settings").select("key,value").in("key", ["brevo_api_key", "brevo_list_id", "brevo_hook_secret"]);
  const m: Record<string, string> = {};
  for (const r of data || []) m[r.key] = typeof r.value === "string" ? r.value : (r.value == null ? "" : String(r.value));
  return m;
}

/** Compte de l'équipe connecté (jeton de session de l'utilisateur, vérifié par la base) */
async function isTeam(auth: string) {
  if (!/^Bearer\s+\S+/.test(auth)) return false;
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await user.rpc("is_team");
  return data === true;
}

let ATTRS: Champs | null = null;
/** Noms des champs Brevo du compte (PRENOM / FIRSTNAME…) ; crée « STRUCTURE » s'il n'existe aucun champ pour la structure */
async function attrNames(key: string) {
  if (ATTRS) return ATTRS;
  const r = await bfetch(`${API}/contacts/attributes`, { headers: { "api-key": key, accept: "application/json" } });
  if (!r.ok) throw new Error(`Brevo ${r.status} : ${await r.text()}`);
  const names = new Set(((await r.json()).attributes || []).map((a: { name: string }) => a.name.toUpperCase()));
  const pick = (list: string[]) => list.find((n) => names.has(n));
  let struct = pick(["STRUCTURE", "SOCIETE", "ENTREPRISE", "COMPANY", "COMPANY_NAME", "ORGANISATION"]);
  if (!struct) {
    const c = await bfetch(`${API}/contacts/attributes/normal/STRUCTURE`, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify({ type: "text" }) });
    if (c.ok || c.status === 400) struct = "STRUCTURE";
  }
  ATTRS = { first: pick(["PRENOM", "FIRSTNAME", "FNAME"]), last: pick(["NOM", "LASTNAME", "LNAME"]), struct };
  return ATTRS;
}

/** Tous les mails déjà présents dans Brevo (abonnés ou désabonnés) */
async function brevoEmails(key: string) {
  const out = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const r = await bfetch(`${API}/contacts?limit=1000&offset=${offset}`, { headers: { "api-key": key, accept: "application/json" } });
    if (!r.ok) throw new Error(`Brevo ${r.status} : ${await r.text()}`);
    const j = await r.json();
    for (const c of j.contacts || []) if (c.email) out.add(String(c.email).trim().toLowerCase());
    if (!j.contacts || j.contacts.length < 1000) break;
  }
  return out;
}

/** Structures rattachées à chaque contact (nom, inactive ou non — v1.60.2 ; fonction ici — lue, pas transmise) ; une erreur de lecture arrête tout (jamais d'ajout à l'aveugle) */
async function structuresOf(ids: string[]) {
  const out = new Map<string, Link[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await sb.from("contact_structures").select("contact_id, role, structures(name, inactive_at)").in("contact_id", ids.slice(i, i + 500));
    if (error) throw new Error(`Lecture des structures des contacts impossible : ${error.message}`);
    for (const r of (data || []) as any[]) if (r.structures) (out.get(r.contact_id) || out.set(r.contact_id, []).get(r.contact_id)!)
      .push({ name: r.structures.name || "", inactive: !!r.structures.inactive_at, role: r.role ?? null });
  }
  return out;
}

/** Appels réels à Brevo pour un contact (lecture, mise à jour des champs, création) : voir syncContact (regles.ts) */
const client = (key: string): ClientBrevo => ({
  lire: (email) => bfetch(`${API}/contacts/${encodeURIComponent(email)}`, { headers: { "api-key": key, accept: "application/json" } }),
  modifier: (email, corps) => bfetch(`${API}/contacts/${encodeURIComponent(email)}`, { method: "PUT", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify(corps) }),
  creer: (corps) => bfetch(`${API}/contacts`, { method: "POST", headers: { "api-key": key, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(corps) }),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const s = await settings();
    const body = await req.json().catch(() => ({}));
    const hook = !!s.brevo_hook_secret && req.headers.get("x-hook-secret") === s.brevo_hook_secret;
    // « tout envoyer » depuis les Réglages : session d'un compte de l'équipe (vérifiée par la base, is_team)
    const team = !hook && body.all === true && await isTeam(req.headers.get("Authorization") || "");
    if (!hook && !team) return json({ ok: false, error: "Accès refusé" }, 401);
    if (!s.brevo_api_key) return json({ ok: false, error: "Clé API Brevo absente (Réglages › Brevo)" });
    const key = s.brevo_api_key.trim();
    const listIds = String(s.brevo_list_id || "").split(/[,;\s]+/).map(Number).filter((n) => n > 0);
    const a = await attrNames(key);

    // Tout envoyer d'un coup (import Brevo)
    if (body.all) {
      const all: Contact[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await sb.from("contacts").select("id,email,email_2,first_name,last_name,display_name").or("email.not.is.null,email_2.not.is.null").range(from, from + 999);
        all.push(...((data || []) as Contact[]));
        if (!data || data.length < 1000) break;
      }
      // seulement les mails absents de Brevo : les contacts existants (et les désabonnés) ne sont pas touchés
      const known = await brevoEmails(key);
      const seen = new Set<string>();
      // chaque mail du contact (mail 1 et mail 2) devient un contact Brevo
      const cand: { c: Contact; email: string }[] = [];
      for (const c of all) for (const e of mailsOf(c)) { if (known.has(e) || seen.has(e)) continue; seen.add(e); cand.push({ c, email: e }); }
      if (!cand.length) return json({ ok: true, count: 0, skipped_inactive: 0 });
      const st = await structuresOf([...new Set(cand.map((x) => x.c.id))]);
      // contacts liés uniquement à des structures inactives : pas ajoutés (v1.60.2, regles.ts)
      const { list, skipped_inactive } = aAjouter(cand, st);
      if (!list.length) return json({ ok: true, count: 0, skipped_inactive });
      const r = await bfetch(`${API}/contacts/import`, { method: "POST", headers: { "api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ jsonBody: list.map(({ c, email }) => ({ email, attributes: attributes(c, st.get(c.id), a) })),
          ...(listIds.length ? { listIds } : {}), updateExistingContacts: false, emptyContactsAttributes: false }) });
      if (!r.ok) return json({ ok: false, error: `Brevo ${r.status} : ${await r.text()}` });
      return json({ ok: true, count: list.length, skipped_inactive });
    }

    // Un contact : petite attente pour que les structures rattachées juste après la création soient là
    await new Promise((ok) => setTimeout(ok, 3000));
    const { data: c } = await sb.from("contacts").select("id,email,email_2,first_name,last_name,display_name,brevo_created,brevo_emails").eq("id", body.contact_id).single();
    const mails = c ? mailsOf(c as Contact) : [];
    if (!c || !mails.length) return json({ ok: true, skipped: "pas de mail" });
    const st = await structuresOf([c.id]);
    // mails créés par la Matrice (avant la v1.32 : seul le mail 1, signalé par brevo_created)
    const ours = new Set<string>((c.brevo_emails || []).map((e: string) => e.toLowerCase()));
    const old: string[] = [];
    if (c.brevo_created && !ours.size && c.email) { ours.add(c.email.trim().toLowerCase()); old.push(c.email.trim().toLowerCase()); }
    const { done, created, skipped, errors } = await syncContact({ client: client(key), c: c as Contact, links: st.get(c.id), champs: a, listIds, ours });
    created.unshift(...old);
    const err = errors.length ? errors.join(" · ") : null;
    // ajout des mails créés à la liste enregistrée, sans l'écraser (une autre synchronisation du même contact peut tourner en même temps)
    if (created.length) await sb.rpc("brevo_add_emails", { p_contact: c.id, p_emails: created });
    await sb.from("contacts").update({ brevo_at: new Date().toISOString(), brevo_error: err, ...(ours.size ? { brevo_created: true } : {}) }).eq("id", c.id);
    return json({ ok: !err, error: err, emails: done, ...(skipped.length ? { skipped_inactive: skipped } : {}) });
  } catch (e) {
    const msg = String(e);
    if (/unrecognised IP/i.test(msg)) return json({ ok: false, error: "Brevo bloque la connexion (adresse IP non autorisée). Dans Brevo : Paramètres › Sécurité › IP autorisées, désactive le blocage des adresses IP inconnues, puis réessaie." });
    return json({ ok: false, error: msg.replace(/^Error: /, "") });
  }
});
