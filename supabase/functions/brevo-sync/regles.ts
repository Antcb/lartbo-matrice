/**
 * Règles de la synchronisation Brevo, sans appel extérieur (testées par tests/static/brevo-regles.mjs sur de fausses données).
 *
 * Contact rattaché UNIQUEMENT à des structures inactives (au moins une, aucune active) — demande d'Anthony (v1.60.2) : tenu hors de
 * la prospection, donc PAS AJOUTÉ à Brevo. Rien n'est supprimé ni désabonné dans Brevo ; un mail déjà présent n'est jamais touché.
 * Un contact lié à au moins une structure active, ou sans structure, est ajouté comme avant. Même règle que js/selectors.js
 * (onlyInactive). Réactiver la structure fait ajouter ses contacts (déclencheur brevo_structure_reactivated, migration v1.60.2).
 *
 * Rattachements (décision d'Anthony du 08/11/2026) : l'ajout ET le retrait d'un rattachement (contact_structures) relancent la
 * synchronisation du contact (déclencheur brevo_contact_structures, migration 2026-11-08_brevo_rattachements.sql — même règle côté
 * SQL : tout changement de rattachement d'un contact qui a un mail part dans brevo_queue). Le champ « structure » de Brevo reprend
 * alors la liste À JOUR des structures ; un retrait ne supprime jamais le contact, ne le retire d'aucune liste et ne touche ni à son
 * désabonnement ni à ses autres champs (préférences). Seuls les mails créés par la Matrice sont mis à jour (règle inchangée).
 *
 * Fonction propre à chaque structure (contact_structures.role) : LUE et conservée structure par structure (fonctionsParStructure),
 * mais PAS ENCORE TRANSMISE à Brevo : la représentation (un champ par structure, un champ combiné, des listes…) n'est pas décidée.
 * Aucune fonction n'en remplace une autre (jamais « la dernière écrite »).
 */
export type Link = { name: string; inactive: boolean; role?: string | null };

export const onlyInactive = (links: Link[] = []): boolean => links.length > 0 && links.every((l) => l.inactive);

const fr = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);

/** Noms des structures du contact (champ « structure » de Brevo), actives ou non — triés et sans doublon : la même liste de
 * rattachements donne toujours le même texte, quel que soit l'ordre de lecture (synchronisation rejouable) */
export const names = (links: Link[] = []): string[] => [...new Set(links.map((l) => (l.name || "").trim()).filter(Boolean))].sort(fr);

/** Fonction propre à chaque structure, structure par structure (préparation : rien n'est envoyé à Brevo).
 * Toutes les fonctions sont gardées, chacune avec SA structure : deux structures, deux fonctions différentes → deux lignes. */
export function fonctionsParStructure(links: Link[] = []): { structure: string; fonction: string }[] {
  const out = new Map<string, { structure: string; fonction: string }>();
  for (const l of links) {
    const structure = (l.name || "").trim(), fonction = String(l.role || "").trim();
    if (!structure || !fonction) continue;
    out.set(`${structure}\u0000${fonction}`, { structure, fonction });
  }
  return [...out.values()].sort((a, b) => fr(a.structure, b.structure) || fr(a.fonction, b.fonction));
}

/** Adresses à ajouter à Brevo : celles des contacts qui ne sont pas liés uniquement à des structures inactives */
export function aAjouter<T extends { c: { id: string } }>(cand: T[], links: Map<string, Link[]>): { list: T[]; skipped_inactive: number } {
  const list = cand.filter((x) => !onlyInactive(links.get(x.c.id)));
  return { list, skipped_inactive: cand.length - list.length };
}

export type Contact = { id: string; email: string | null; email_2?: string | null; first_name: string | null; last_name: string | null; display_name: string | null };
export type Champs = { first?: string; last?: string; struct?: string };

/** Mails valides d'un contact (mail 1 puis mail 2), en minuscules et sans doublon */
export const mailsOf = (c: Contact): string[] =>
  [...new Set([c.email, c.email_2].map((e) => String(e || "").trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];

/**
 * Champs envoyés à Brevo : prénom, nom, structure(s). JAMAIS d'autre champ (désabonnement, listes, préférences du contact…).
 * - création : « structure » seulement si le contact a au moins une structure (comme avant) ;
 * - mise à jour (mail créé par la Matrice) : « structure » toujours envoyée, vide quand le dernier rattachement a été retiré, pour
 *   que Brevo ne garde pas une structure quittée.
 */
export function attributes(c: Contact, links: Link[] | undefined, a: Champs, miseAJour = false): Record<string, string> {
  const at: Record<string, string> = {};
  const first = c.first_name || (!c.last_name ? (c.display_name || "").split(" ")[0] : "");
  const last = c.last_name || (!c.first_name ? (c.display_name || "").split(" ").slice(1).join(" ") : "");
  const structs = names(links);
  if (a.first && first) at[a.first] = first;
  if (a.last && last) at[a.last] = last;
  if (a.struct && (structs.length || miseAJour)) at[a.struct] = structs.join(", ");
  return at;
}

/** Réponse minimale d'un appel à Brevo (Response, ou faux client des tests) */
export type Rep = { ok: boolean; status: number; text(): Promise<string> };
/** Les trois appels utilisés pour un contact. Aucun appel de suppression, de désabonnement ni de retrait de liste n'existe ici. */
export type ClientBrevo = {
  lire(email: string): Promise<Rep>;
  modifier(email: string, corps: { attributes: Record<string, string> }): Promise<Rep>;
  creer(corps: { email: string; attributes: Record<string, string>; listIds?: number[] }): Promise<Rep>;
};

/**
 * Synchronisation d'UN contact (déclencheur : création, modification, ajout ou retrait d'un rattachement, réactivation).
 * - mail absent de Brevo : créé (avec la ou les listes des Réglages), sauf contact lié uniquement à des structures inactives ;
 * - mail déjà dans Brevo et créé par la Matrice (ours) : prénom, nom et structure(s) mis à jour, rien d'autre ;
 * - mail déjà dans Brevo et non créé par la Matrice : jamais touché ;
 * - rejouable : relancer donne le même résultat, sans doublon (lecture avant création, « duplicate » = déjà là).
 */
export async function syncContact(p: { client: ClientBrevo; c: Contact; links: Link[] | undefined; champs: Champs; listIds: number[]; ours: Set<string> }) {
  const { client, c, links, champs, listIds, ours } = p;
  const held = onlyInactive(links);   // lié uniquement à des structures inactives : pas de nouveau contact Brevo (v1.60.2)
  const aCreer = attributes(c, links, champs, false);
  const aJour = attributes(c, links, champs, true);
  const errors: string[] = [], done: string[] = [], created: string[] = [], skipped: string[] = [], updated: string[] = [];
  for (const email of mailsOf(c)) {
    const g = await client.lire(email);
    if (!g.ok && g.status !== 404) { errors.push(`${email} : Brevo ${g.status} : ${(await g.text()).slice(0, 200)}`); continue; }
    if (g.ok) {
      // déjà dans Brevo : on n'y touche pas, sauf si c'est la Matrice qui l'a créé (prénom / nom / structure à jour)
      if (ours.has(email)) {
        const u = await client.modifier(email, { attributes: aJour });
        if (!u.ok) { errors.push(`${email} : Brevo ${u.status} : ${(await u.text()).slice(0, 200)}`); continue; }
        updated.push(email);
      }
      done.push(email); continue;
    }
    if (held) { skipped.push(email); continue; }
    const r = await client.creer({ email, attributes: aCreer, ...(listIds.length ? { listIds } : {}) });
    const txt = r.ok ? "" : await r.text();
    if (r.ok) { ours.add(email); created.push(email); done.push(email); }
    else if (/duplicate/i.test(txt)) done.push(email);
    else errors.push(`${email} : Brevo ${r.status} : ${txt.slice(0, 200)}`);
  }
  return { done, created, updated, skipped, errors };
}
