/**
 * Brevo : ajoute dans Brevo les contacts de la Matrice qui n'y sont pas encore (mail, prénom, nom, structure).
 * Un mail déjà présent dans Brevo n'est JAMAIS modifié : ni ses champs, ni ses listes, ni son désabonnement.
 * Contact lié uniquement à des structures inactives (v1.60.2), sans structure et marqué (option B, 08/11), ou exclu à la main (09/11) :
 * pas ajouté (hors prospection) ; rien n'est supprimé ni désabonné.
 * Exception (depuis la v1.16) : un mail CRÉÉ par la Matrice (contacts.brevo_emails) garde prénom, nom et structure(s) à jour ;
 * ajout ET retrait d'un rattachement à une structure (08/11/2026) : champ « structure » mis à jour, jamais de suppression, de
 * désabonnement ni de liste ajoutée ou retirée. Fonction propre à chaque structure : champ FONCTIONS (s'il existe dans Brevo).
 * Appelée par un déclencheur de la base à chaque création ou modification d'un contact, à l'ajout, au retrait d'un
 * rattachement à une structure ou au changement de sa fonction, à la réactivation d'une structure, ou par Réglages › Brevo pour tout envoyer d'un coup.
 * Réglages lus dans la table settings : brevo_api_key, brevo_list_id (une ou plusieurs listes, séparées par des virgules),
 * brevo_hook_secret (code partagé avec le déclencheur). Ces réglages ne sont lisibles que côté serveur (v1.47).
 * Accès : le déclencheur de la base (code x-hook-secret) ; « tout envoyer » (Réglages) : un compte de l'équipe connecté (v1.47 —
 * le navigateur n'a plus le code secret).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { aAjouter, attributes, type Champs, type ClientBrevo, type Contact, emplacements, type Fiche, type Link, lireReglages, listeProtegees, mailsAutorises, type Registre, supprimerContact, syncContact } from "./regles.ts";

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

/** Réglages de CET appel (aucun état partagé entre appels : relecture B3) ; lecture en échec = appel arrêté (lireReglages) */
async function settings() {
  return lireReglages(await sb.from("settings").select("key,value").in("key", ["brevo_api_key", "brevo_list_id", "brevo_hook_secret", "brevo_essai_emails", "brevo_protegees", "brevo_adoption"]));
}

/** Compte de l'équipe connecté (jeton de session de l'utilisateur, vérifié par la base) */
async function isTeam(auth: string) {
  if (!/^Bearer\s+\S+/.test(auth)) return false;
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await user.rpc("is_team");
  return data === true;
}

let ATTRS: Champs | null = null;
/** Noms des champs Brevo du compte (PRENOM / FIRSTNAME…) ; crée « STRUCTURE » s'il n'existe aucun champ pour la structure.
 * « FONCTIONS » (fonctions par structure, 08/11/2026) : utilisé seulement s'il existe déjà dans le compte (créé à la main par
 * Anthony), jamais créé par la Matrice. */
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
  ATTRS = { first: pick(["PRENOM", "FIRSTNAME", "FNAME"]), last: pick(["NOM", "LASTNAME", "LNAME"]), struct, fonctions: pick(["FONCTIONS"]) };
  return ATTRS;
}

/** Toutes les fiches Brevo (abonnées ou désabonnées), par adresse en minuscules : champs, désabonnement (lecture seule) */
// deno-lint-ignore no-explicit-any
async function brevoTout(key: string): Promise<Map<string, any>> {
  // deno-lint-ignore no-explicit-any
  const out = new Map<string, any>();
  for (let offset = 0; ; offset += 1000) {
    const r = await bfetch(`${API}/contacts?limit=1000&offset=${offset}`, { headers: { "api-key": key, accept: "application/json" } });
    if (!r.ok) throw new Error(`Brevo ${r.status} : ${await r.text()}`);
    const j = await r.json();
    for (const c of j.contacts || []) if (c.email) out.set(String(c.email).trim().toLowerCase(), c);
    if (!j.contacts || j.contacts.length < 1000) break;
  }
  return out;
}

/** Registre des fiches Brevo (table brevo_fiches) : écritures conditionnelles, une erreur de la base arrête l'appel (jamais d'opération à l'aveugle) */
const ok = <T>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(`Registre Brevo : ${r.error.message}`); return r.data; };
const registre: Registre = {
  deContact: async (id) => ok(await sb.from("brevo_fiches").select("*").eq("contact_id", id)) as Fiche[],
  lire: async (email) => ok(await sb.from("brevo_fiches").select("*").eq("email", email).maybeSingle()) as Fiche | null,
  changer: async (email, attendu, patch) => {
    let q = sb.from("brevo_fiches").update({ ...patch, maj_at: new Date().toISOString() }).eq("email", email);
    for (const [k, v] of Object.entries(attendu)) q = v === null ? q.is(k, null) : q.eq(k, v as string);
    return (ok(await q.select("email")) as unknown[]).length > 0;
  },
  reserver: async (f) => {
    const r = await sb.from("brevo_fiches").insert({ ...f, maj_at: new Date().toISOString() }).select("email");
    if (!r.error) return true;
    if (r.error.code !== "23505") throw new Error(`Registre Brevo : ${r.error.message}`);
    return registre.changer(f.email, { statut: "supprimee" }, f);   // reprise d'une adresse supprimée par MATRICE
  },
  renommer: async (ancien, nouveau, contactId) => {
    const t = await registre.lire(nouveau);
    if (t && t.statut !== "supprimee") return false;
    if (t) ok(await sb.from("brevo_fiches").delete().eq("email", nouveau).eq("statut", "supprimee"));
    const r = await sb.from("brevo_fiches").update({ email: nouveau, statut: "renommage", maj_at: new Date().toISOString() }).eq("email", ancien).eq("contact_id", contactId).in("statut", ["active", "conflit", "detachee", "renommage"]).select("email");
    if (r.error?.code === "23505") return false;
    return (ok(r) as unknown[]).length > 0;
  },
  porteurs: async (emails) => {
    const m = new Map<string, string[]>();
    if (!emails.length) return m;
    for (const x of (ok(await sb.rpc("brevo_porteurs", { p_emails: emails })) || []) as { email: string; contacts: string[] }[]) m.set(x.email, x.contacts || []);
    return m;
  },
  journal: async (email, contactId, action, detail) => { ok(await sb.from("brevo_journal").insert({ email, contact_id: contactId, action, detail: detail ?? null })); },
};

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

/** Contacts lus avec les marqueurs « hors prospection », automatique et manuel (migration 2026-11-08) ; base sans cette colonne (migration pas encore
 * appliquée) : relu sans elle, la règle v1.60.2 seule s'applique (jamais d'arrêt de la synchronisation) */
async function lireContacts<T>(cols: string, q: (sel: string) => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  const r = await q(`${cols},hors_prospection_at,prospection_exclue_at`);
  if (r.error && /hors_prospection_at|prospection_exclue_at/.test(r.error.message)) return (await q(cols)).data;
  return r.data;
}

/** Appels réels à Brevo pour un contact (lecture, mise à jour des champs, création) : voir syncContact (regles.ts) */
const client = (key: string): ClientBrevo => ({
  lire: (email) => bfetch(`${API}/contacts/${encodeURIComponent(email)}`, { headers: { "api-key": key, accept: "application/json" } }),
  modifier: (email, corps) => bfetch(`${API}/contacts/${encodeURIComponent(email)}`, { method: "PUT", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify(corps) }),
  creer: (corps) => bfetch(`${API}/contacts`, { method: "POST", headers: { "api-key": key, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(corps) }),
  // seul appel de suppression : supprimerFiche (regles.ts), après toutes les vérifications (gérée, non partagée, non désabonnée)
  supprimer: (email) => bfetch(`${API}/contacts/${encodeURIComponent(email)}`, { method: "DELETE", headers: { "api-key": key, accept: "application/json" } }),
});

/** Tous les contacts MATRICE qui ont une adresse (lecture page par page) */
async function tousLesContacts(): Promise<Contact[]> {
  const all: Contact[] = [];
  for (let from = 0; ; from += 1000) {
    const data = await lireContacts<Contact[]>("id,email,email_2,first_name,last_name,display_name",
      (sel) => sb.from("contacts").select(sel).or("email.not.is.null,email_2.not.is.null").order("id").range(from, from + 999));
    all.push(...((data || []) as Contact[]));
    if (!data || data.length < 1000) break;
  }
  return all;
}
/** Tout le registre, par adresse */
async function toutLeRegistre(): Promise<Map<string, Fiche>> {
  const m = new Map<string, Fiche>();
  for (let from = 0; ; from += 1000) {
    const data = ok(await sb.from("brevo_fiches").select("*").order("email").range(from, from + 999)) as Fiche[];
    for (const f of data) m.set(f.email, f);
    if (data.length < 1000) break;
  }
  return m;
}

/**
 * ADOPTION des fiches préexistantes (décision du 16/11/2026, opération distincte autorisée explicitement par Anthony) :
 * adresse portée par UN seul contact MATRICE, présente dans Brevo, absente du registre, non protégée. Aperçu : chiffres seulement,
 * rien d'écrit. Exécution : fiche inscrite au registre (origine « preexistante » : mise à jour et renommage, jamais de suppression
 * automatique) puis champs mis à jour par lots de 100 (seuls prénom, nom, structures, fonctions : ni listes ni abonnement).
 */
async function adopter(key: string, protegees: Set<string>, executer: boolean, limite: number) {
  const a = await attrNames(key);
  const champs = [a.first, a.last, a.struct, a.fonctions].filter(Boolean) as string[];
  const [all, known, tenues] = [await tousLesContacts(), await brevoTout(key), await toutLeRegistre()];
  const porteurs = await registre.porteurs([...new Set(all.flatMap((c) => emplacements(c).map((m) => m.e)))]);
  const st = await structuresOf(all.map((c) => c.id));
  const n = { adresses_matrice: 0, absentes_de_brevo: 0, deja_gerees: 0, protegees: 0, partagees: 0, candidates: 0, sans_changement: 0, a_modifier: 0, desabonnees: 0 };
  const parChamp: Record<string, number> = Object.fromEntries(champs.map((k) => [k, 0]));
  const cand: { email: string; c: Contact; champ: "email" | "email_2"; at: Record<string, string>; change: boolean }[] = [];
  const vus = new Set<string>();
  for (const c of all) for (const { e, champ } of emplacements(c)) {
    if (vus.has(e)) continue; vus.add(e); n.adresses_matrice++;
    if (protegees.has(e)) { n.protegees++; continue; }
    if ((porteurs.get(e) || []).length > 1) { n.partagees++; continue; }
    if (tenues.has(e)) { n.deja_gerees++; continue; }
    const b = known.get(e);
    if (!b) { n.absentes_de_brevo++; continue; }
    n.candidates++;
    if (b.emailBlacklisted === true || (b.listUnsubscribed || []).length) n.desabonnees++;
    const at = attributes(c, st.get(c.id), a, true);
    let change = false;
    for (const k of champs) if (String(b.attributes?.[k] ?? "") !== String(at[k] ?? "")) { parChamp[k]++; change = true; }
    if (change) n.a_modifier++; else n.sans_changement++;
    cand.push({ email: e, c, champ, at, change });
  }
  if (!executer) return { ok: true, apercu: true, ...n, modifications_par_champ: parChamp };
  const lot = cand.slice(0, Math.max(1, Math.min(limite, 500)));   // lots courts : jamais près du temps limite de la fonction
  let adoptees = 0; const erreurs: string[] = [];
  for (let i = 0; i < lot.length; i += 100) {
    const pris = [];
    for (const x of lot.slice(i, i + 100)) if (await registre.reserver({ email: x.email, contact_id: x.c.id, champ: x.champ, origine: "preexistante", statut: "active" })) pris.push(x);
    const maj = pris.filter((x) => x.change);
    if (maj.length) {
      const r = await bfetch(`${API}/contacts/batch`, { method: "POST", headers: { "api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ contacts: maj.map((x) => ({ email: x.email, attributes: x.at })) }) });
      if (!r.ok) {
        erreurs.push(`Brevo ${r.status} : ${(await r.text()).slice(0, 200)}`);
        for (const x of pris) ok(await sb.from("brevo_fiches").delete().eq("email", x.email).eq("origine", "preexistante").eq("statut", "active"));
        break;
      }
    }
    for (const x of pris) await registre.journal(x.email, x.c.id, "adoptee", x.change ? "champs mis à jour" : "champs déjà à jour");
    adoptees += pris.length;
  }
  const restantes = cand.length - adoptees;
  // toutes adoptées : les prochaines fiches préexistantes rencontrées une par une sont adoptées de la même façon
  if (!erreurs.length && restantes === 0) ok(await sb.from("settings").upsert({ key: "brevo_adoption", value: "oui" }));
  return { ok: !erreurs.length, adoptees, restantes, erreurs };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { m: s, essai } = await settings();   // mode essai (brevo_essai_emails) : seules ses adresses, rien d'autre n'appelle Brevo
    const body = await req.json().catch(() => ({}));
    const hook = !!s.brevo_hook_secret && req.headers.get("x-hook-secret") === s.brevo_hook_secret;
    // « tout envoyer » depuis les Réglages : session d'un compte de l'équipe (vérifiée par la base, is_team)
    const team = !hook && body.all === true && await isTeam(req.headers.get("Authorization") || "");
    if (!hook && !team) return json({ ok: false, error: "Accès refusé" }, 401);
    if (!s.brevo_api_key) return json({ ok: false, error: "Clé API Brevo absente (Réglages › Brevo)" });
    const key = s.brevo_api_key.trim();
    const listIds = String(s.brevo_list_id || "").split(/[,;\s]+/).map(Number).filter((n) => n > 0);

    const protegees = listeProtegees(s.brevo_protegees), adoption = String(s.brevo_adoption || "").trim() === "oui";

    // Contact supprimé dans MATRICE (déclencheur brevo_contact_supprime) : règles de suppression (supprimerContact)
    if (body.contact_supprime) {
      if (!hook) return json({ ok: false, error: "Accès refusé" }, 401);
      const r = await supprimerContact({ client: client(key), registre, essai, protegees, contactId: String(body.contact_supprime) });
      return json({ ok: !r.errors.length, error: r.errors.join(" · ") || null, fiches: r.fiches });
    }

    // Adoption des fiches préexistantes (opération distincte, autorisée par Anthony) : aperçu, puis exécution par lots
    if (body.adoption) {
      if (!hook) return json({ ok: false, error: "Accès refusé" }, 401);
      if (essai) return json({ ok: false, error: "Mode essai Brevo actif : adoption désactivée pendant l’essai." });
      return json(await adopter(key, protegees, body.adoption === "executer" && body.confirmer === "ADOPTER", Number(body.limite) || 500));
    }

    // Tout envoyer d'un coup (import Brevo) : mêmes règles qu'un contact créé seul (registre, protections, fiches supprimées dans Brevo)
    if (body.all) {
      if (essai) return json({ ok: false, error: "Mode essai Brevo actif : « tout envoyer » est désactivé pendant l’essai." });
      const a = await attrNames(key);
      const all = await tousLesContacts();
      const known = await brevoTout(key);
      const porteurs = await registre.porteurs([...new Set(all.flatMap((c) => emplacements(c).map((m) => m.e)))]);
      const tenues = await toutLeRegistre();
      const seen = new Set<string>();
      // contacts EN SUSPENS (décisions du 16-17/11) : conflit, fiche supprimée dans Brevo, fiche désabonnée (au registre ou lue dans Brevo) :
      // aucune de leurs nouvelles adresses n'est importée en masse (gel du cas ambigu, blocage du remplacement d'une désabonnée, pas de
      // nouvelle fiche après une suppression dans Brevo, jamais d'inscription à une liste malgré une opposition) ; synchronisation une par une
      const opp = (e: string) => { const b = known.get(e); return !!b && (b.emailBlacklisted === true || (b.listUnsubscribed || []).length > 0); };
      const enSuspens = new Set<string>();
      // fiche gérée absente de Brevo (supprimée à la main, pas encore notée) : suspens aussi
      for (const f of tenues.values()) if (f.contact_id && (["conflit", "supprimee_brevo"].includes(f.statut) || (f.statut === "detachee" && f.champ) || (["active", "detachee"].includes(f.statut) && opp(f.email)) || (f.statut === "active" && !known.has(f.email)))) enSuspens.add(f.contact_id);
      // fiche PRÉEXISTANTE (non adoptée) désabonnée portée par le contact : opposition, aucune nouvelle adresse importée avec liste
      for (const c of all) if (emplacements(c).some((m) => !protegees.has(m.e) && opp(m.e))) enSuspens.add(c.id);
      let suspendues = 0;
      // chaque adresse (mail 1 et mail 2) devient une fiche Brevo ; jamais : déjà dans Brevo, protégée, partagée, ou connue du registre
      // (une fiche gérée absente de Brevo a été supprimée à la main dans Brevo : jamais recréée)
      const cand: { c: Contact; email: string; champ: "email" | "email_2" }[] = [];
      for (const c of all) for (const { e, champ } of emplacements(c)) {
        if (known.has(e) || seen.has(e) || protegees.has(e) || (porteurs.get(e) || []).length > 1) continue;
        const f = tenues.get(e);
        if (f && f.statut !== "supprimee") continue;
        if (enSuspens.has(c.id)) { suspendues++; continue; }
        seen.add(e); cand.push({ c, email: e, champ });
      }
      if (!cand.length) return json({ ok: true, count: 0, skipped_inactive: 0, en_suspens: suspendues });
      const st = await structuresOf([...new Set(cand.map((x) => x.c.id))]);
      const { list, skipped_inactive } = aAjouter(cand, st);
      // réservation au registre AVANT l'import (origine « matrice », mêmes règles ensuite) ; adresse déjà tenue : écartée
      const pris: typeof list = [];
      for (const x of list) if (await registre.reserver({ email: x.email, contact_id: x.c.id, champ: x.champ, origine: "matrice", statut: "creation" })) pris.push(x);
      if (!pris.length) return json({ ok: true, count: 0, skipped_inactive, en_suspens: suspendues });
      const r = await bfetch(`${API}/contacts/import`, { method: "POST", headers: { "api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ jsonBody: pris.map(({ c, email }) => ({ email, attributes: attributes(c, st.get(c.id), a) })),
          ...(listIds.length ? { listIds } : {}), updateExistingContacts: false, emptyContactsAttributes: false }) });
      const fin = r.ok ? { statut: "active" as const, detail: null } : { statut: "supprimee" as const, contact_id: null, champ: null, detail: null };
      for (const x of pris) await registre.changer(x.email, { statut: "creation" }, fin);
      if (!r.ok) return json({ ok: false, error: `Brevo ${r.status} : ${await r.text()}` });
      for (const x of pris) await registre.journal(x.email, x.c.id, "creee", "import en masse");
      return json({ ok: true, count: pris.length, skipped_inactive, en_suspens: suspendues });
    }

    // Un contact : petite attente pour que les structures rattachées juste après la création soient là
    await new Promise((ok) => setTimeout(ok, 3000));
    // deno-lint-ignore no-explicit-any
    const c = await lireContacts<any>("id,email,email_2,first_name,last_name,display_name",
      (sel) => sb.from("contacts").select(sel).eq("id", body.contact_id).maybeSingle());
    if (!c) return json({ ok: true, skipped: "contact introuvable" });
    // mode essai : ni adresse actuelle ni fiche du registre dans la liste → aucun appel à Brevo, rien d'écrit sur le contact
    const fiches = await registre.deContact(c.id);
    if (!mailsAutorises(c as Contact, essai).length && !fiches.some((f) => !essai || essai.has(f.email))) return json({ ok: true, skipped: essai ? "mode essai" : "pas de mail" });
    const a = await attrNames(key);
    const st = await structuresOf([c.id]);
    const r = await syncContact({ client: client(key), registre, c: c as Contact, links: st.get(c.id), champs: a, listIds, essai, protegees, adoption });
    const err = r.errors.length ? r.errors.join(" · ") : null;
    await sb.from("contacts").update({ brevo_at: new Date().toISOString(), brevo_error: err }).eq("id", c.id);
    return json({ ok: !err, error: err, emails: r.done, ...(r.skipped.length ? { skipped_inactive: r.skipped } : {}),
      renamed: r.renamed, removed: r.removed, conflicts: r.conflicts, protected: r.protected, deleted_in_brevo: r.deletedInBrevo, en_attente: r.enAttente });
  } catch (e) {
    const msg = String(e);
    if (/unrecognised IP/i.test(msg)) return json({ ok: false, error: "Brevo bloque la connexion (adresse IP non autorisée). Dans Brevo : Paramètres › Sécurité › IP autorisées, désactive le blocage des adresses IP inconnues, puis réessaie." });
    return json({ ok: false, error: msg.replace(/^Error: /, "") });
  }
});
