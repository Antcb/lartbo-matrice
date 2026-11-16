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
 * Contact supprimé puis recréé avec la même adresse (décision du 09/11) : la base lui remet le même marqueur (prospection_memoire),
 * donc il reste hors Brevo ; rien à faire ici.
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
/**
 * Réglages d'UN appel de brevo-sync, à partir de la réponse de la base (relecture B3 du 09/11) : valeurs texte + mode essai calculé
 * sur la valeur BRUTE, sans aucun état partagé entre appels simultanés. Lecture en échec (erreur, réponse vide) : exception, l'appel
 * s'arrête — jamais de repli silencieux sur le fonctionnement normal.
 */
export function lireReglages(r: { data: { key: string; value: unknown }[] | null; error: { message: string } | null }): { m: Record<string, string>; essai: Set<string> | null } {
  if (r.error || !r.data || !r.data.length) throw new Error("Lecture des réglages impossible : synchronisation Brevo arrêtée, rien n’est envoyé (réessaie dans un instant)");
  const m: Record<string, string> = {};
  let brut: unknown = null;
  for (const x of r.data) { if (x.key === "brevo_essai_emails") brut = x.value; m[x.key] = typeof x.value === "string" ? x.value : (x.value == null ? "" : String(x.value)); }
  return { m, essai: listeEssai(brut) };
}
/** Adresses du contact que la synchronisation peut toucher (toutes hors mode essai ; sinon seulement celles de la liste) */
export const mailsAutorises = (c: Contact, essai: Set<string> | null): string[] => mailsOf(c).filter((e) => !essai || essai.has(e));

/** Réponse minimale d'un appel à Brevo (Response, ou faux client des tests) */
export type Rep = { ok: boolean; status: number; text(): Promise<string> };
/**
 * Appels à Brevo utilisés pour un contact. Aucun appel de désabonnement, de réabonnement ni de retrait de liste n'existe ici :
 * « modifier » n'envoie QUE des champs (attributes) ; « supprimer » n'est appelé que par supprimerFiche (règles du 16/11/2026).
 */
export type ClientBrevo = {
  lire(email: string): Promise<Rep>;
  modifier(email: string, corps: { attributes: Record<string, string> }): Promise<Rep>;
  creer(corps: { email: string; attributes: Record<string, string>; listIds?: number[] }): Promise<Rep>;
  supprimer(email: string): Promise<Rep>;
};

/**
 * REGISTRE des fiches Brevo (table brevo_fiches, décisions d'Anthony du 16/11/2026) : MATRICE est la référence, Brevo l'outil de
 * diffusion. Une adresse n'est gérée par MATRICE que si elle figure au registre :
 * - origine « matrice » : fiche créée par MATRICE (une par une ou import en masse) : mise à jour, renommage, suppression ;
 * - origine « preexistante » : fiche qui existait dans Brevo, adoptée (opération d'adoption distincte, autorisée par Anthony) :
 *   mise à jour et renommage, JAMAIS de suppression automatique.
 * Statuts : creation / renommage / suppression (opération en cours, réservée : aucune autre synchronisation n'y touche), active, conflit (changement d'adresse vers une adresse déjà
 * présente dans Brevo : aucune fusion), supprimee_brevo (fiche supprimée à la main dans Brevo : jamais recréée automatiquement,
 * même par l'import en masse), detachee (plus liée à un contact, conservée dans Brevo), supprimee (supprimée par MATRICE).
 * Toutes les écritures du registre sont conditionnelles (« si l'état est encore … ») : deux synchronisations simultanées du même
 * contact ne font jamais deux fois la même opération dans Brevo.
 */
export type Statut = "creation" | "renommage" | "active" | "conflit" | "supprimee_brevo" | "detachee" | "suppression" | "supprimee";
export type Fiche = { email: string; contact_id: string | null; champ: "email" | "email_2" | null; origine: "matrice" | "preexistante"; statut: Statut; detail?: string | null };
export type Registre = {
  deContact(contactId: string): Promise<Fiche[]>;
  lire(email: string): Promise<Fiche | null>;
  /** Écriture conditionnelle : applique « patch » seulement si la fiche a encore les valeurs « attendu » ; vrai si appliqué */
  changer(email: string, attendu: Partial<Fiche>, patch: Partial<Fiche>): Promise<boolean>;
  /** Réserve une adresse (nouvelle ligne, ou reprise d'une ligne « supprimee ») ; faux si elle est déjà tenue */
  reserver(f: Fiche): Promise<boolean>;
  /** Changement d'adresse au registre (conditionnel), statut « renommage » posé dans la même écriture ; faux si la nouvelle adresse est déjà tenue */
  renommer(ancien: string, nouveau: string, contactId: string): Promise<boolean>;
  /** Contacts MATRICE qui portent chaque adresse (mail 1 ou mail 2) */
  porteurs(emails: string[]): Promise<Map<string, string[]>>;
  journal(email: string, contactId: string | null, action: string, detail?: string): Promise<void>;
};
export const ACTIVES: Statut[] = ["active", "conflit"];
/** Fiche Brevo désabonnée (désinscrite de tout envoi, ou d'au moins une liste) : jamais supprimée, l'inscription n'est jamais touchée */
export function desabonnee(json: string): boolean {
  try { const j = JSON.parse(json || "{}"); return j.emailBlacklisted === true || (Array.isArray(j.listUnsubscribed) && j.listUnsubscribed.length > 0); }
  catch { return true; }   // réponse illisible : considérée désabonnée (jamais de suppression à l'aveugle)
}
/** Adresses protégées à la main (réglage brevo_protegees, ex. anthony@) : MATRICE n'y touche jamais */
export const listeProtegees = (v: unknown): Set<string> => listeEssai(v) || new Set();
/** Adresses d'un contact avec leur emplacement (mail 1 / mail 2), en minuscules, sans doublon */
export const emplacements = (c: Contact): { e: string; champ: "email" | "email_2" }[] => {
  const out: { e: string; champ: "email" | "email_2" }[] = [];
  for (const champ of ["email", "email_2"] as const) {
    const e = String(c[champ] || "").trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !out.some((x) => x.e === e)) out.push({ e, champ });
  }
  return out;
};
const err = async (email: string, r: Rep) => `${email} : Brevo ${r.status} : ${(await r.text()).slice(0, 200)}`;

type Opts = { client: ClientBrevo; registre: Registre; essai?: Set<string> | null; protegees?: Set<string> };

/**
 * Suppression d'UNE fiche que le contact n'utilise plus (contact supprimé, adresse retirée) — règles du 16/11/2026 :
 * - fiche préexistante adoptée : jamais supprimée, seulement détachée ;
 * - fiche désabonnée : conservée dans Brevo (le désabonnement reste protégé), détachée ;
 * - fiche déjà absente de Brevo : notée supprimée ;
 * - sinon : supprimée dans Brevo, après réservation au registre, et journalisée.
 * L'appelant a déjà écarté les adresses protégées et celles qu'un autre contact porte encore.
 */
export async function supprimerFiche(o: Opts, f: Fiche): Promise<{ action: string; error?: string }> {
  const { client, registre } = o;
  if (f.origine !== "matrice") {
    if (await registre.changer(f.email, { statut: f.statut, contact_id: f.contact_id }, { statut: "detachee", contact_id: null, champ: null, detail: "Fiche préexistante : conservée dans Brevo" }))
      await registre.journal(f.email, f.contact_id, "detachee", "fiche préexistante, jamais supprimée");
    return { action: "detachee" };
  }
  const g = await client.lire(f.email);
  if (!g.ok && g.status !== 404) return { action: "erreur", error: await err(f.email, g) };
  if (!g.ok) {
    if (await registre.changer(f.email, { statut: f.statut }, { statut: "supprimee", contact_id: null, champ: null, detail: "Déjà absente de Brevo" }))
      await registre.journal(f.email, f.contact_id, "supprimee", "déjà absente de Brevo");
    return { action: "absente" };
  }
  if (desabonnee(await g.text())) {
    if (await registre.changer(f.email, { statut: f.statut }, { statut: "detachee", detail: "Désabonnée : conservée dans Brevo" }))
      await registre.journal(f.email, f.contact_id, "detachee", "désabonnée, conservée dans Brevo");
    return { action: "conservee_desabonnee" };
  }
  if (!await registre.changer(f.email, { statut: f.statut, contact_id: f.contact_id }, { statut: "suppression" })) return { action: "deja_traitee" };
  const d = await client.supprimer(f.email);
  if (!d.ok && d.status !== 404) {
    const e = await err(f.email, d);
    await registre.changer(f.email, { statut: "suppression" }, { statut: f.statut, detail: e });
    return { action: "erreur", error: e };
  }
  await registre.changer(f.email, { statut: "suppression" }, { statut: "supprimee", contact_id: null, champ: null, detail: null });
  await registre.journal(f.email, f.contact_id, "supprimee", "supprimée dans Brevo par MATRICE");
  return { action: "supprimee" };
}

/** Une adresse quitte ce contact : un autre contact la porte encore → elle lui revient (un seul) ou est détachée (plusieurs) ; sinon suppression */
async function quitter(o: Opts, f: Fiche, autres: string[]) {
  if (autres.length === 1) { await o.registre.changer(f.email, { contact_id: f.contact_id }, { contact_id: autres[0], champ: null }); return { action: "transferee" }; }
  if (autres.length > 1) {
    if (await o.registre.changer(f.email, { contact_id: f.contact_id }, { contact_id: null, champ: null, statut: "detachee", detail: "Adresse partagée par plusieurs contacts : à dédoublonner" }))
      await o.registre.journal(f.email, f.contact_id, "detachee", "adresse partagée");
    return { action: "detachee" };
  }
  return supprimerFiche(o, f);
}

/**
 * Synchronisation d'UN contact (création, modification, rattachements, réactivation) — MATRICE fait référence :
 * 1. adresses que le contact n'a plus : même emplacement avec une nouvelle adresse = CHANGEMENT D'ADRESSE (la fiche Brevo est
 *    renommée : même fiche, désabonnement et historique gardés ; nouvelle adresse déjà dans Brevo = conflit, aucune fusion) ;
 *    sinon adresse retirée (quitter : transfert, détachement ou suppression selon les règles) ;
 * 2. adresses du contact : fiche au registre = champs mis à jour (jamais listes ni abonnement ; absente de Brevo = supprimée à la
 *    main, jamais recréée) ; hors registre et absente de Brevo = créée avec la ou les listes des Réglages (seul moment où une liste
 *    est donnée), sauf contact hors prospection ; hors registre mais présente dans Brevo = fiche préexistante : adoptée seulement
 *    si l'adoption a été autorisée (réglage brevo_adoption), sinon jamais touchée.
 * Adresses protégées (réglage) ou portées par plusieurs contacts : aucune opération. Mode essai : seules ses adresses.
 */
export async function syncContact(p: Opts & { c: Contact; links: Link[] | undefined; champs: Champs; listIds: number[]; adoption?: boolean }) {
  const { client, registre, c, links, champs, listIds } = p;
  const essai = p.essai ?? null, protegees = p.protegees ?? new Set<string>();
  const held = horsProspection(links, c.hors_prospection_at, c.prospection_exclue_at);
  const aCreer = attributes(c, links, champs, false), aJour = attributes(c, links, champs, true);
  const errors: string[] = [], done: string[] = [], created: string[] = [], skipped: string[] = [], updated: string[] = [];
  const renamed: string[] = [], removed: string[] = [], conflicts: string[] = [], protectedSkip: string[] = [], deletedInBrevo: string[] = [];
  const mails = emplacements(c);
  const autorise = (e: string) => !essai || essai.has(e);
  const toutes = await registre.deContact(c.id);
  const reg = toutes.filter((f) => ACTIVES.includes(f.statut));
  const detachees = toutes.filter((f) => f.statut === "detachee" && f.champ && !mails.some((m) => m.e === f.email));
  const porteurs = await registre.porteurs([...new Set([...mails.map((m) => m.e), ...reg.map((f) => f.email), ...detachees.map((f) => f.email)])]);
  const autresQue = (e: string) => (porteurs.get(e) || []).filter((id) => id !== c.id);
  const partagee = (e: string) => autresQue(e).length > 0;
  const intouchable = (e: string) => protegees.has(e) || !autorise(e);
  const consommees = new Set<string>();

  // CAS AMBIGU (décision d'Anthony du 16/11/2026) : le contact avait DEUX adresses gérées (mail 1 et mail 2) et, dans le même
  // enregistrement, les deux emplacements changent, avec au moins une adresse quittée et au moins une adresse nouvelle (ex. mail 1
  // vidé et mail 2 changé ; mail 2 remonté en mail 1 et nouveau mail 2). On ne peut pas savoir quelle fiche devient quelle adresse :
  // AUCUNE fiche n'est supprimée ni renommée, et la nouvelle adresse n'est pas créée, tant que le conflit n'est pas résolu (l'équipe
  // remet l'une des anciennes adresses, enregistre, puis change l'autre). Les adresses gérées encore portées restent mises à jour.
  const norme = (v: unknown) => String(v || "").trim().toLowerCase();
  const reg1 = reg.find((f) => f.champ === "email"), reg2 = reg.find((f) => f.champ === "email_2");
  const ambigu = !!reg1 && !!reg2 && norme(c.email) !== reg1.email && norme(c.email_2) !== reg2.email
    && reg.some((f) => !mails.some((m) => m.e === f.email)) && mails.some((m) => !reg.some((f) => f.email === m.e));
  const enAttente: string[] = [];
  if (ambigu) {
    const detail = `Les deux adresses ont changé dans le même enregistrement (${mails.map((m) => m.e).join(", ") || "aucune adresse"}) : rien n’est fait dans Brevo. Remets l’une des deux anciennes adresses, enregistre, puis change l’autre.`;
    for (const f of reg.filter((x) => !mails.some((m) => m.e === x.email))) {
      if (intouchable(f.email)) { protectedSkip.push(f.email); continue; }
      if (await registre.changer(f.email, { statut: f.statut, contact_id: c.id }, { statut: "conflit", detail }))
        await registre.journal(f.email, c.id, "conflit", "deux adresses changées en même temps");
      conflicts.push(f.email);
    }
    for (const m of mails) if (!reg.some((f) => f.email === m.e)) { consommees.add(m.e); enAttente.push(m.e); }
  }

  // 1. adresses que le contact n'a plus (fiches gérées), puis fiches désabonnées détachées de ce contact (reprises si son
  //    emplacement reçoit une nouvelle adresse : même fiche, le désabonnement suit, jamais de nouvelle fiche inscrite)
  // décision d'Anthony du 16/11 : fiche supprimée volontairement dans Brevo = jamais recréée, MÊME si l'adresse du contact change
  // ensuite → la nouvelle adresse du même emplacement hérite du blocage (non créée ; « Recréer dans Brevo » pour la lever)
  const bloquer = async (ancienne: string, nouveau: { e: string; champ: "email" | "email_2" }) => {
    if (!await registre.reserver({ email: nouveau.e, contact_id: c.id, champ: nouveau.champ, origine: "matrice", statut: "supprimee_brevo",
      detail: `Ancienne fiche ${ancienne} supprimée dans Brevo : nouvelle adresse non créée (« Recréer dans Brevo » pour la créer)` })) return false;
    await registre.changer(ancienne, { statut: "supprimee_brevo" }, { champ: null });
    await registre.journal(nouveau.e, c.id, "bloquee", `ancienne fiche ${ancienne} supprimée dans Brevo`);
    deletedInBrevo.push(nouveau.e); return true;
  };
  for (const f of ambigu ? [] : toutes.filter((x) => x.statut === "supprimee_brevo" && x.champ && !mails.some((m) => m.e === x.email))) {
    if (String(c[f.champ!] || "").trim() && !mails.some((m) => m.champ === f.champ)) continue;   // adresse non valide : en attente
    // emplacement repris depuis par une fiche gérée du contact (ex. mail 2 remonté en mail 1) : le blocage ne passe jamais à elle
    if (reg.some((x) => x.champ === f.champ)) { await registre.changer(f.email, { statut: "supprimee_brevo" }, { champ: null }); continue; }
    const nouveau = mails.find((m) => m.champ === f.champ && !reg.some((x) => x.email === m.e));
    if (!nouveau || intouchable(nouveau.e) || partagee(nouveau.e)) continue;
    const t = await registre.lire(nouveau.e);
    if (t && t.statut !== "supprimee") continue;   // ligne « supprimee » (supprimée autrefois par MATRICE) : reprise par la réservation
    consommees.add(nouveau.e); await bloquer(f.email, nouveau);
  }
  const sources = ambigu ? [] : [...reg.filter((f) => !mails.some((m) => m.e === f.email)), ...detachees];
  for (const f of sources) {
    const active = ACTIVES.includes(f.statut);
    if (intouchable(f.email)) { protectedSkip.push(f.email); continue; }
    // adresse portée par un autre contact : fiche gérée = transfert / détachement ; fiche désabonnée détachée = jamais reprise ici
    // (relecture du 16/11 : la reprendre ferait passer le désabonnement à la mauvaise personne et réinscrire l'adresse)
    if (partagee(f.email)) { if (active) await quitter(p, f, autresQue(f.email)); continue; }
    // emplacement rempli avec une adresse NON VALIDE (faute de frappe) : rien n'est supprimé ni créé en attendant une adresse correcte
    if (f.champ && String(c[f.champ] || "").trim() && !mails.some((m) => m.champ === f.champ)) {
      await registre.changer(f.email, { statut: f.statut }, { detail: "Adresse saisie non valide : en attente d’une adresse correcte" });
      protectedSkip.push(f.email); continue;
    }
    const nouveau = mails.find((m) => m.champ === f.champ && !consommees.has(m.e) && !reg.some((x) => x.email === m.e));
    if (nouveau) {
      consommees.add(nouveau.e);
      // nouvelle adresse protégée, partagée ou hors essai : aucune opération, jamais de suppression de l'ancienne fiche
      if (intouchable(nouveau.e) || partagee(nouveau.e)) {
        if (await registre.changer(f.email, { statut: f.statut }, { ...(active ? { statut: "conflit" as const } : {}), detail: `Nouvelle adresse ${nouveau.e} protégée ou partagée : aucune opération` }))
          await registre.journal(f.email, c.id, "conflit", nouveau.e);
        conflicts.push(f.email); continue;
      }
      const tenue = await registre.lire(nouveau.e);
      if (tenue && tenue.statut !== "supprimee") { await registre.changer(f.email, { statut: f.statut }, { ...(active ? { statut: "conflit" as const } : {}), detail: `Nouvelle adresse ${nouveau.e} déjà connue de MATRICE : aucune fusion` }); conflicts.push(f.email); continue; }
      const g = await client.lire(nouveau.e);
      if (!g.ok && g.status !== 404) { errors.push(await err(nouveau.e, g)); continue; }
      if (g.ok) {
        if (await registre.changer(f.email, { statut: f.statut }, { ...(active ? { statut: "conflit" as const } : {}), detail: `Nouvelle adresse ${nouveau.e} déjà présente dans Brevo : aucune fusion, à traiter à la main` }))
          await registre.journal(f.email, c.id, "conflit", nouveau.e);
        conflicts.push(f.email); continue;
      }
      // renommage réservé au registre (statut « renommage » : opération en cours, aucune autre synchronisation n'y touche)
      if (!await registre.renommer(f.email, nouveau.e, c.id)) continue;
      let r: Rep;
      try { r = await client.modifier(f.email, { attributes: { ...aJour, EMAIL: nouveau.e } }); }
      catch (x) { r = { ok: false, status: 0, text: async () => String(x) }; }   // erreur réseau : le registre revient à l'état d'avant
      if (!r.ok) {
        const e = await err(f.email, r);
        await registre.renommer(nouveau.e, f.email, c.id);
        // ancienne fiche supprimée à la main dans Brevo : jamais recréée, et la nouvelle adresse hérite du blocage (décision du 16/11)
        if (r.status === 404) { await registre.changer(f.email, { statut: "renommage" }, { statut: "supprimee_brevo", detail: "Fiche supprimée dans Brevo : non recréée" }); deletedInBrevo.push(f.email); await bloquer(f.email, nouveau); }
        else { await registre.changer(f.email, { statut: "renommage" }, { statut: f.statut, detail: e }); errors.push(e); }
        continue;
      }
      await registre.changer(nouveau.e, { statut: "renommage" }, { statut: active ? "active" : "detachee", champ: nouveau.champ, detail: active ? null : "Désabonnée : conservée dans Brevo" });
      await registre.journal(nouveau.e, c.id, "renommee", `ancienne adresse ${f.email}`);
      renamed.push(nouveau.e); done.push(nouveau.e); continue;
    }
    if (!active) continue;   // fiche désabonnée détachée sans nouvelle adresse : rien
    const q = await quitter(p, f, []);
    if (q.error) errors.push(q.error); else removed.push(f.email);
  }

  // 2. adresses actuelles du contact
  for (const { e: email, champ } of mails) {
    if (consommees.has(email)) continue;
    if (intouchable(email)) { if (autorise(email)) protectedSkip.push(email); continue; }
    if (partagee(email)) { protectedSkip.push(email); continue; }
    let f = await registre.lire(email);
    // fiche gérée d'un ancien porteur (qui n'a plus cette adresse) : elle revient à ce contact
    if (f && f.contact_id !== c.id && ACTIVES.includes(f.statut) && await registre.changer(email, { contact_id: f.contact_id }, { contact_id: c.id, champ })) f = await registre.lire(email);
    if (f && f.statut === "supprimee_brevo") { deletedInBrevo.push(email); continue; }
    if (f && f.contact_id === c.id && ACTIVES.includes(f.statut)) {
      if (f.champ !== champ) await registre.changer(email, { contact_id: c.id }, { champ });
      const g = await client.lire(email);
      if (!g.ok && g.status !== 404) { errors.push(await err(email, g)); continue; }
      if (!g.ok) {
        if (await registre.changer(email, { statut: f.statut }, { statut: "supprimee_brevo", detail: "Fiche supprimée dans Brevo : non recréée" })) await registre.journal(email, c.id, "supprimee_brevo");
        deletedInBrevo.push(email); continue;
      }
      const u = await client.modifier(email, { attributes: aJour });
      if (!u.ok) { errors.push(await err(email, u)); continue; }
      if (f.statut === "conflit" || f.detail) await registre.changer(email, { contact_id: c.id }, { statut: "active", detail: null });
      updated.push(email); done.push(email); continue;
    }
    if (f && f.statut === "detachee") {
      // fiche détachée (préexistante, désabonnée ou partagée) que le contact reprend : jamais recréée si elle a disparu de Brevo
      const g = await client.lire(email);
      if (!g.ok && g.status !== 404) { errors.push(await err(email, g)); continue; }
      if (!g.ok) { await registre.changer(email, { statut: "detachee" }, { statut: "supprimee_brevo", contact_id: c.id, champ, detail: "Fiche supprimée dans Brevo : non recréée" }); deletedInBrevo.push(email); continue; }
      if (await registre.changer(email, { statut: "detachee" }, { statut: "active", contact_id: c.id, champ, detail: null })) {
        const u = await client.modifier(email, { attributes: aJour });
        if (!u.ok) { errors.push(await err(email, u)); continue; }
        updated.push(email);
      }
      done.push(email); continue;
    }
    if (f && f.statut !== "supprimee") { done.push(email); continue; }   // opération en cours ailleurs (creation / suppression)
    const g = await client.lire(email);
    if (!g.ok && g.status !== 404) { errors.push(await err(email, g)); continue; }
    if (g.ok) {
      // fiche préexistante : adoptée seulement si l'adoption a été autorisée ; sinon jamais touchée
      if (p.adoption && await registre.reserver({ email, contact_id: c.id, champ, origine: "preexistante", statut: "active" })) {
        await registre.journal(email, c.id, "adoptee");
        const u = await client.modifier(email, { attributes: aJour });
        if (!u.ok) { errors.push(await err(email, u)); continue; }
        updated.push(email);
      }
      done.push(email); continue;
    }
    if (held) { skipped.push(email); continue; }
    if (!await registre.reserver({ email, contact_id: c.id, champ, origine: "matrice", statut: "creation" })) { done.push(email); continue; }
    let r: Rep;
    try { r = await client.creer({ email, attributes: aCreer, ...(listIds.length ? { listIds } : {}) }); }
    catch (x) { r = { ok: false, status: 0, text: async () => String(x) }; }   // erreur réseau : réservation levée (statut « supprimee »)
    const txt = r.ok ? "" : await r.text();
    if (r.ok) {
      await registre.changer(email, { statut: "creation" }, { statut: "active", detail: null });
      await registre.journal(email, c.id, "creee");
      created.push(email); done.push(email);
    } else if (/duplicate/i.test(txt)) {
      // créée au même instant hors de cette synchronisation : préexistante, jamais gérée sans adoption
      await registre.changer(email, { statut: "creation" }, { statut: "supprimee", contact_id: null, champ: null, detail: null });
      done.push(email);
    } else {
      await registre.changer(email, { statut: "creation" }, { statut: "supprimee", contact_id: null, champ: null, detail: null });
      errors.push(`${email} : Brevo ${r.status} : ${txt.slice(0, 200)}`);
    }
  }
  return { done, created, updated, skipped, errors, renamed, removed, conflicts, protected: protectedSkip, deletedInBrevo, enAttente };
}

/**
 * Contact SUPPRIMÉ dans MATRICE : chacune de ses fiches gérées suit les règles de suppression (supprimerFiche) ; une adresse qu'un
 * autre contact porte encore lui revient (ou est détachée si plusieurs), une adresse protégée n'est jamais touchée.
 */
export async function supprimerContact(o: Opts & { contactId: string }) {
  const essai = o.essai ?? null, protegees = o.protegees ?? new Set<string>();
  const reg = (await o.registre.deContact(o.contactId)).filter((f) => ACTIVES.includes(f.statut));
  const porteurs = await o.registre.porteurs(reg.map((f) => f.email));
  const out: { email: string; action: string }[] = [], errors: string[] = [];
  for (const f of reg) {
    if (protegees.has(f.email) || (essai && !essai.has(f.email))) { out.push({ email: f.email, action: "protegee" }); continue; }
    const r = await quitter(o, f, (porteurs.get(f.email) || []).filter((id) => id !== o.contactId));
    if (r.error) errors.push(r.error);
    out.push({ email: f.email, action: r.action });
  }
  return { fiches: out, errors };
}
