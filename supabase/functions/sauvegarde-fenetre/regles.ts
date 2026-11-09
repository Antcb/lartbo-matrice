// Règles de la fonction « sauvegarde-fenetre » (sans appel réseau ni base) : testées par tests/static/sauvegarde-declenchement.mjs.

// Comparaison du secret en temps constant (longueurs différentes : refus, sans comparer caractère par caractère)
export function secretOk(recu: unknown, attendu: unknown): boolean {
  if (typeof recu !== 'string' || typeof attendu !== 'string' || attendu.length < 32 || recu.length !== attendu.length) return false;
  let d = 0;
  for (let i = 0; i < attendu.length; i++) d |= recu.charCodeAt(i) ^ attendu.charCodeAt(i);
  return d === 0;
}

export type Demande =
  | { action: 'demarrer'; p: { type: string; run_id: string; tentative: number; origine: string; forcer: boolean; duree_minutes: number } }
  | { action: 'fermer'; p: { id: number } }
  | { action: 'terminer'; p: { id: number; statut: string; detail: string | null } };

const entier = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

// Validation stricte : seules les valeurs prévues passent ; rien d'autre n'est transmis à la base. Renvoie un message d'erreur sinon.
export function lireDemande(b: any): Demande | string {
  if (!b || typeof b !== 'object') return 'demande illisible';
  const id = entier(b.id, 1, Number.MAX_SAFE_INTEGER);
  switch (b.action) {
    case 'demarrer': {
      if (!['complete', 'json'].includes(b.type)) return 'type inconnu';
      if (typeof b.run_id !== 'string' || !/^[0-9]{1,20}$/.test(b.run_id)) return 'run_id invalide';
      const tentative = entier(b.tentative, 1, 100);
      if (tentative === null) return 'tentative invalide';
      if (!['schedule', 'workflow_dispatch'].includes(b.origine)) return 'origine inconnue';
      // 45 min au plus : la fermeture de secours de la base passe dans les 15 min suivantes ⇒ connexion ouverte 1 h au plus
      const duree = b.duree_minutes === undefined ? 45 : entier(b.duree_minutes, 5, 45);
      if (duree === null) return 'durée invalide (5 à 45 min)';
      return { action: 'demarrer', p: { type: b.type, run_id: b.run_id, tentative, origine: b.origine, forcer: b.forcer === true, duree_minutes: duree } };
    }
    case 'fermer':
      return id === null ? 'id invalide' : { action: 'fermer', p: { id } };
    case 'terminer': {
      if (id === null) return 'id invalide';
      if (!['succes', 'echec'].includes(b.statut)) return 'statut inconnu';
      const detail = typeof b.detail === 'string' ? b.detail.replace(/[^\p{L}\p{N} .,:;()'’«»\/_-]/gu, ' ').slice(0, 300) : null;
      return { action: 'terminer', p: { id, statut: b.statut, detail } };
    }
    default:
      return 'action inconnue';
  }
}
