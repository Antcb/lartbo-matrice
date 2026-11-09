/**
 * Règles de la synchronisation Brevo, sans appel extérieur (testées par tests/static/brevo-regles.mjs sur de fausses données).
 *
 * Contact rattaché UNIQUEMENT à des structures inactives (au moins une, aucune active) — demande d'Anthony (v1.60.2) : tenu hors de
 * la prospection, donc PAS AJOUTÉ à Brevo. Rien n'est supprimé ni désabonné dans Brevo ; un mail déjà présent n'est jamais touché.
 * Un contact lié à au moins une structure active, ou sans structure (non marqué, voir plus bas), est ajouté comme avant. Même règle que js/selectors.js
 * (onlyInactive). Réactiver la structure fait ajouter ses contacts (déclencheur brevo_structure_reactivated, migration v1.60.2).
 *
 * Rattachements (décision d'Anthony du 08/11/2026) : l'ajout ET le retrait d'un rattachement (contact_structures) relancent la
 * synchronisation du contact, une fois par contact et par requête (déclencheurs par requête brevo_contact_structures, _retrait,
 * _modif, fonction SQL brevo_links_trg, migration 2026-11-08_brevo_rattachements.sql — même règle côté SQL : tout couple
 * (contact, structure) apparu ou disparu, ou fonction changée, d'un contact qui a un mail part dans brevo_queue). Le champ « structure » de Brevo reprend
 * alors la liste À JOUR des structures ; un retrait ne supprime jamais le contact, ne le retire d'aucune liste et ne touche ni à son
 * désabonnement ni à ses autres champs (préférences). Seuls les mails créés par la Matrice sont mis à jour (règle inchangée).
 *
 * Contact devenu « sans structure » (décision d'Anthony du 08/11/2026, option B) : un contact qui a perdu un rattachement alors qu'il
 * n'était lié qu'à des structures inactives porte le marqueur contacts.hors_prospection_at (posé et effacé par les déclencheurs SQL,
 * migration 2026-11-08_brevo_rattachements.sql). Sans structure et marqué, il reste hors prospection et hors Brevo (ni ajout, ni
 * liste) jusqu'à un rattachement à une structure active ou une réactivation ; un contact CRÉÉ sans structure n'est pas marqué et
 * est ajouté comme avant. Même règle : js/selectors.js (horsProspection). Rien n'est supprimé ni désabonné.
 * Exclusion MANUELLE (décision du 09/11/2026) : contacts.prospection_exclue_at, posée et levée seulement par l'équipe (fonction SQL
 * set_prospection, motif, tracé) : hors prospection et hors Brevo quelles que soient ses structures. Un contact déjà dans Brevo y reste
 * (aucune suppression, aucun désabonnement ; ses champs restent à jour si la Matrice l'a créé).
 *
 * Fonction propre à chaque structure (contact_structures.role) — décision d'Anthony du 08/11/2026 : champ texte Brevo « FONCTIONS »,
 * lisible, « Festival B : Programmatrice ; Théâtre Z : Directrice » (structures triées, sans doublon), information seulement
 * (aucune liste, aucun ciblage). Envoyé seulement si le champ existe dans le compte Brevo (créé à la main par Anthony) et seulement
 * pour les mails créés par la Matrice, comme « structure ». Les fonctions générales du contact (contacts.roles) ne sont pas envoyées.
 * Aucune fonction n'en remplace une autre (jamais « la dernière écrite »).
 */
export type Link = { name: string; inactive: boolean; role?: string | null };

export const onlyInactive = (links: Link[] = []): boolean => links.length > 0 && links.every((l) => l.inactive);

/** Hors prospection et hors Brevo : lié uniquement à des structures inactives (v1.60.2), sans structure et marqué automatiquement
 * (option B, contacts.hors_prospection_at), ou exclu MANUELLEMENT par l'équipe (contacts.prospection_exclue_at, décision du 09/11 :
 * jamais levée par un rattachement). Même règle que js/selectors.js (horsProspection). */
export const horsProspection = (links: Link[] = [], marque?: string | null, manuel?: string | null): boolean =>
  !!manuel || onlyInactive(links) || (links.length === 0 && !!marque);

const fr = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);

/** Noms des structures du contact (champ « structure » de Brevo), actives ou non — triés et sans doublon : la même liste de
 * rattachements donne toujours le même texte, quel que soit l'ordre de lecture (synchronisation rejouable) */
export const names = (links: Link[] = []): string[] => [...new Set(links.map((l) => (l.name || "").trim()).filter(Boolean))].sort(fr);

/** Fonction propre à chaque structure, structure par structure (champ FONCTIONS).
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

/** Texte du champ FONCTIONS : « Structure : fonction » séparés par « ; » (vide si aucune fonction propre) */
export const fonctionsTexte = (links: Link[] = []): string => fonctionsParStructure(links).map((f) => `${f.structure} : ${f.fonction}`).join(" ; ");

/** Adresses à ajouter à Brevo : celles des contacts qui ne sont pas hors prospection (horsProspection) */
export function aAjouter<T extends { c: { id: string; hors_prospection_at?: string | null; prospection_exclue_at?: string | null } }>(cand: T[], links: Map<string, Link[]>): { list: T[]; skipped_inactive: number } {
  const list = cand.filter((x) => !horsProspection(links.get(x.c.id), x.c.hors_prospection_at, x.c.prospection_exclue_at));
  return { list, skipped_inactive: cand.length - list.length };
}

export type Contact = { id: string; email: string | null; email_2?: string | null; first_name: string | null; last_name: string | null; display_name: string | null; hors_prospection_at?: string | null; prospection_exclue_at?: string | null };
export type Champs = { first?: string; last?: string; struct?: string; fonctions?: string };

/** Mails valides d'un contact (mail 1 puis mail 2), en minuscules et sans doublon */
export const mailsOf = (c: Contact): string[] =>
  [...new Set([c.email, c.email_2].map((e) => String(e || "").trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];

/**
 * Champs envoyés à Brevo : prénom, nom, structure(s), fonctions par structure (si le champ FONCTIONS existe). JAMAIS d'autre
 * champ (désabonnement, listes, préférences du contact…).
 * - création : « structure » / « FONCTIONS » seulement s'ils ne sont pas vides (comme avant) ;
 * - mise à jour (mail créé par la Matrice) : toujours envoyés, vides quand le dernier rattachement (ou la dernière fonction) a été
 *   retiré, pour que Brevo ne garde pas une structure ou une fonction quittée.
 */
export function attributes(c: Contact, links: Link[] | undefined, a: Champs, miseAJour = false): Record<string, string> {
  const at: Record<string, string> = {};
  const first = c.first_name || (!c.last_name ? (c.display_name || "").split(" ")[0] : "");
  const last = c.last_name || (!c.first_name ? (c.display_name || "").split(" ").slice(1).join(" ") : "");
  const structs = names(links);
  if (a.first && first) at[a.first] = first;
  if (a.last && last) at[a.last] = last;
  if (a.struct && (structs.length || miseAJour)) at[a.struct] = structs.join(", ");
  const fonctions = fonctionsTexte(links);
  if (a.fonctions && (fonctions || miseAJour)) at[a.fonctions] = fonctions;
  return at;
}

/**
 * MODE ESSAI (marche supabase/operations/2026-11-09_essai_brevo_contact_test.md) : réglage brevo_essai_emails = une ou plusieurs
 * adresses (virgules). Tant qu'il est rempli, la synchronisation ne touche QUE les adresses valides qu'il contient : toute autre
 * adresse est ignorée AVANT le moindre appel à Brevo, et « tout envoyer » est refusé. Sert à brancher la vraie clé Brevo sur l'espace
 * de test sans risque pour ses autres contacts.
 * - réglage absent, null ou texte vide : null = fonctionnement normal ;
 * - réglage rempli SANS aucune adresse valide (exemple laissé tel quel, faute de frappe, valeur non texte) : liste VIDE = TOUT est
 *   bloqué (relecture B2 du 09/11) ; jamais de retour silencieux au fonctionnement normal.
 * Même règle : js/selectors.js (listeEssaiBrevo), affichée dans Réglages › Brevo.
 */
export function listeEssai(v: unknown): Set<string> | null {
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  const brut = Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : JSON.stringify(v);
  return new Set(brut.split(/[,;\s]+/).map((e) => e.replace(/^[<"'(]+|[>"'),.]+$/g, "").trim().toLowerCase())
    .filter((e) => /^[^\s@<>"',;()]+@[^\s@<>"',;()]+\.[a-z]{2,}$/.test(e)));
}
/** Adresses du contact que la synchronisation peut toucher (toutes hors mode essai ; sinon seulement celles de la liste) */
export const mailsAutorises = (c: Contact, essai: Set<string> | null): string[] => mailsOf(c).filter((e) => !essai || essai.has(e));

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
 * - mail absent de Brevo : créé (avec la ou les listes des Réglages), sauf contact hors prospection (horsProspection) ;
 * - mail déjà dans Brevo et créé par la Matrice (ours) : prénom, nom et structure(s) mis à jour, rien d'autre ;
 * - mail déjà dans Brevo et non créé par la Matrice : jamais touché ;
 * - rejouable : relancer donne le même résultat, sans doublon (lecture avant création, « duplicate » = déjà là).
 */
export async function syncContact(p: { client: ClientBrevo; c: Contact; links: Link[] | undefined; champs: Champs; listIds: number[]; ours: Set<string>; essai?: Set<string> | null }) {
  const { client, c, links, champs, listIds, ours } = p;
  const held = horsProspection(links, c.hors_prospection_at, c.prospection_exclue_at);   // hors prospection : pas de nouveau contact Brevo (v1.60.2, option B)
  const aCreer = attributes(c, links, champs, false);
  const aJour = attributes(c, links, champs, true);
  const errors: string[] = [], done: string[] = [], created: string[] = [], skipped: string[] = [], updated: string[] = [];
  for (const email of mailsAutorises(c, p.essai ?? null)) {   // mode essai : seulement les adresses de la liste
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
