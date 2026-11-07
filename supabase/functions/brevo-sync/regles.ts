/**
 * Règles de la synchronisation Brevo, sans appel extérieur (testées par tests/static/brevo-regles.mjs sur de fausses données).
 *
 * Contact rattaché UNIQUEMENT à des structures inactives (au moins une, aucune active) — demande d'Anthony (v1.60.2) : tenu hors de
 * la prospection, donc PAS AJOUTÉ à Brevo. Rien n'est supprimé ni désabonné dans Brevo ; un mail déjà présent n'est jamais touché.
 * Un contact lié à au moins une structure active, ou sans structure, est ajouté comme avant. Même règle que js/selectors.js
 * (onlyInactive). Réactiver la structure fait ajouter ses contacts (déclencheur brevo_structure_reactivated, migration v1.60.2).
 */
export type Link = { name: string; inactive: boolean };

export const onlyInactive = (links: Link[] = []): boolean => links.length > 0 && links.every((l) => l.inactive);

/** Noms des structures du contact (champ « structure » de Brevo), actives ou non */
export const names = (links: Link[] = []): string[] => links.map((l) => l.name).filter(Boolean);

/** Adresses à ajouter à Brevo : celles des contacts qui ne sont pas liés uniquement à des structures inactives */
export function aAjouter<T extends { c: { id: string } }>(cand: T[], links: Map<string, Link[]>): { list: T[]; skipped_inactive: number } {
  const list = cand.filter((x) => !onlyInactive(links.get(x.c.id)));
  return { list, skipped_inactive: cand.length - list.length };
}
