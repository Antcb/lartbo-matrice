/**
 * Brevo : ajoute dans Brevo les contacts de la Matrice qui n'y sont pas encore (mail, prénom, nom, structure).
 * Un mail déjà présent dans Brevo n'est JAMAIS modifié : ni ses champs, ni ses listes, ni son désabonnement.
 * Appelée par un déclencheur de la base à chaque création ou modification d'un contact
 * (et quand on le rattache à une structure), ou par Réglages › Brevo pour tout envoyer d'un coup.
 * Réglages lus dans la table settings : brevo_api_key, brevo_list_id (une ou plusieurs listes, séparées par des virgules),
 * brevo_hook_secret (code partagé avec le déclencheur).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const API = "https://api.brevo.com/v3";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-hook-secret, authorization, apikey" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function settings() {
  const { data } = await sb.from("settings").select("key,value").in("key", ["brevo_api_key", "brevo_list_id", "brevo_hook_secret"]);
  const m: Record<string, string> = {};
  for (const r of data || []) m[r.key] = typeof r.value === "string" ? r.value : (r.value == null ? "" : String(r.value));
  return m;
}

let ATTRS: { first?: string; last?: string; struct?: string } | null = null;
/** Noms des champs Brevo du compte (PRENOM / FIRSTNAME…) ; crée « STRUCTURE » s'il n'existe aucun champ pour la structure */
async function attrNames(key: string) {
  if (ATTRS) return ATTRS;
  const r = await fetch(`${API}/contacts/attributes`, { headers: { "api-key": key, accept: "application/json" } });
  if (!r.ok) throw new Error(`Brevo ${r.status} : ${await r.text()}`);
  const names = new Set(((await r.json()).attributes || []).map((a: { name: string }) => a.name.toUpperCase()));
  const pick = (list: string[]) => list.find((n) => names.has(n));
  let struct = pick(["STRUCTURE", "SOCIETE", "ENTREPRISE", "COMPANY", "COMPANY_NAME", "ORGANISATION"]);
  if (!struct) {
    const c = await fetch(`${API}/contacts/attributes/normal/STRUCTURE`, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify({ type: "text" }) });
    if (c.ok || c.status === 400) struct = "STRUCTURE";
  }
  ATTRS = { first: pick(["PRENOM", "FIRSTNAME", "FNAME"]), last: pick(["NOM", "LASTNAME", "LNAME"]), struct };
  return ATTRS;
}

/** Tous les mails déjà présents dans Brevo (abonnés ou désabonnés) */
async function brevoEmails(key: string) {
  const out = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${API}/contacts?limit=1000&offset=${offset}`, { headers: { "api-key": key, accept: "application/json" } });
    if (!r.ok) throw new Error(`Brevo ${r.status} : ${await r.text()}`);
    const j = await r.json();
    for (const c of j.contacts || []) if (c.email) out.add(String(c.email).trim().toLowerCase());
    if (!j.contacts || j.contacts.length < 1000) break;
  }
  return out;
}

type Contact = { id: string; email: string | null; first_name: string | null; last_name: string | null; display_name: string | null };

async function structuresOf(ids: string[]) {
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb.from("contact_structures").select("contact_id, structures(name)").in("contact_id", ids.slice(i, i + 500));
    for (const r of (data || []) as any[]) if (r.structures?.name) (out.get(r.contact_id) || out.set(r.contact_id, []).get(r.contact_id)!).push(r.structures.name);
  }
  return out;
}

function attributes(c: Contact, structs: string[], a: NonNullable<typeof ATTRS>) {
  const at: Record<string, string> = {};
  const first = c.first_name || (!c.last_name ? (c.display_name || "").split(" ")[0] : "");
  const last = c.last_name || (!c.first_name ? (c.display_name || "").split(" ").slice(1).join(" ") : "");
  if (a.first && first) at[a.first] = first;
  if (a.last && last) at[a.last] = last;
  if (a.struct && structs.length) at[a.struct] = structs.join(", ");
  return at;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const s = await settings();
    if (!s.brevo_hook_secret || req.headers.get("x-hook-secret") !== s.brevo_hook_secret) return json({ ok: false, error: "Code d’accès incorrect" }, 401);
    if (!s.brevo_api_key) return json({ ok: false, error: "Clé API Brevo absente (Réglages › Brevo)" });
    const key = s.brevo_api_key.trim();
    const listIds = String(s.brevo_list_id || "").split(/[,;\s]+/).map(Number).filter((n) => n > 0);
    const a = await attrNames(key);
    const body = await req.json().catch(() => ({}));

    // Tout envoyer d'un coup (import Brevo)
    if (body.all) {
      const all: Contact[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await sb.from("contacts").select("id,email,first_name,last_name,display_name").not("email", "is", null).range(from, from + 999);
        all.push(...((data || []) as Contact[]));
        if (!data || data.length < 1000) break;
      }
      // seulement les mails absents de Brevo : les contacts existants (et les désabonnés) ne sont pas touchés
      const known = await brevoEmails(key);
      const seen = new Set<string>();
      const list = all.filter((c) => { const e = (c.email || "").trim().toLowerCase(); if (!/@/.test(e) || known.has(e) || seen.has(e)) return false; seen.add(e); return true; });
      if (!list.length) return json({ ok: true, count: 0 });
      const st = await structuresOf(list.map((c) => c.id));
      const r = await fetch(`${API}/contacts/import`, { method: "POST", headers: { "api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ jsonBody: list.map((c) => ({ email: c.email!.trim().toLowerCase(), attributes: attributes(c, st.get(c.id) || [], a) })),
          ...(listIds.length ? { listIds } : {}), updateExistingContacts: false, emptyContactsAttributes: false }) });
      if (!r.ok) return json({ ok: false, error: `Brevo ${r.status} : ${await r.text()}` });
      return json({ ok: true, count: list.length });
    }

    // Un contact : petite attente pour que les structures rattachées juste après la création soient là
    await new Promise((ok) => setTimeout(ok, 3000));
    const { data: c } = await sb.from("contacts").select("id,email,first_name,last_name,display_name,brevo_created").eq("id", body.contact_id).single();
    if (!c || !/@/.test(c.email || "")) return json({ ok: true, skipped: "pas de mail" });
    const email = c.email!.trim().toLowerCase();
    // déjà dans Brevo (abonné ou désabonné) : on n'y touche pas
    const g = await fetch(`${API}/contacts/${encodeURIComponent(email)}`, { headers: { "api-key": key, accept: "application/json" } });
    const st = await structuresOf([c.id]);
    if (g.ok) {
      // créé par la Matrice (ex. la structure rattachée juste après) : on complète seulement prénom / nom / structure
      if (c.brevo_created) await fetch(`${API}/contacts/${encodeURIComponent(email)}`, { method: "PUT", headers: { "api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ attributes: attributes(c as Contact, st.get(c.id) || [], a) }) });
      await sb.from("contacts").update({ brevo_at: new Date().toISOString(), brevo_error: null }).eq("id", c.id);
      return json({ ok: true, skipped: c.brevo_created ? "complété" : "déjà dans Brevo" });
    }
    const r = await fetch(`${API}/contacts`, { method: "POST", headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, attributes: attributes(c as Contact, st.get(c.id) || [], a), ...(listIds.length ? { listIds } : {}) }) });
    const txt = r.ok ? "" : await r.text();
    const err = r.ok || /duplicate/i.test(txt) ? null : `Brevo ${r.status} : ${txt.slice(0, 300)}`;
    await sb.from("contacts").update({ brevo_at: new Date().toISOString(), brevo_error: err, ...(r.ok ? { brevo_created: true } : {}) }).eq("id", c.id);
    return json({ ok: !err, error: err });
  } catch (e) {
    const msg = String(e);
    if (/unrecognised IP/i.test(msg)) return json({ ok: false, error: "Brevo bloque la connexion (adresse IP non autorisée). Dans Brevo : Paramètres › Sécurité › IP autorisées, désactive le blocage des adresses IP inconnues, puis réessaie." });
    return json({ ok: false, error: msg.replace(/^Error: /, "") });
  }
});
