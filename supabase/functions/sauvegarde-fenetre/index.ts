// Démarrage réel, fermeture et fin des sauvegardes (dépôt privé lartbo-matrice-backup), décision d'Anthony du 09/11/2026.
// Appel : POST { secret, action: 'demarrer' | 'fermer' | 'terminer', … } (voir regles.ts) → { ok: true, …réponse de
// public.sauvegarde_declenchement } ou { ok: false, error: 'message français' } (CONVENTIONS.md §7.9).
// Secret DÉDIÉ : private.import_secrets 'sauvegarde_declenchement_secret' (migration 2026-11-09_v1.60.7_sauvegarde_declenchement.sql),
// recopié une fois par Anthony dans le secret GitHub SAUVEGARDE_SIGNAL_SECRET du dépôt de sauvegarde. Il ne donne qu'un droit : ouvrir
// la connexion du rôle « sauvegarde » 45 min au plus (qui exige EN PLUS son mot de passe, rangé ailleurs) et enregistrer un statut.
// À déployer SANS vérification du jeton Supabase (« Verify JWT » désactivé, comme backup-export) : la protection est le secret.
// Codes : 403 secret refusé (définitif) ; 400 demande invalide (définitif) ; 503 coffre ou base momentanément indisponible (à
// réessayer). Jamais de secret, de corps de demande ni de message brut de la base dans la réponse ou le journal.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { lireDemande, secretOk } from './regles.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const refus = (error: string, status: number) => json({ ok: false, error }, status);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return refus('méthode refusée', 405);
  try {
    const b = await req.json().catch(() => null);
    const { data: attendu, error: errCoffre } = await sb.rpc('import_secret', { k: 'sauvegarde_declenchement_secret' });
    if (errCoffre) { console.error('sauvegarde-fenetre : lecture du coffre impossible', errCoffre.code); return refus('coffre des secrets momentanément illisible, réessayer', 503); }
    if (!secretOk(b?.secret, attendu)) return refus('refusé', 403);
    const d = lireDemande(b);
    if (typeof d === 'string') return refus(d, 400);
    const { data, error } = await sb.rpc('sauvegarde_declenchement', { p_action: d.action, p: d.p });
    if (error) {
      console.error('sauvegarde-fenetre', d.action, error.code, error.message);   // message de la base : journal seulement
      return refus('la base n’a pas pu enregistrer la demande (voir le journal de la fonction sauvegarde-fenetre)', 503);
    }
    return json({ ok: true, ...(data as Record<string, unknown>) });
  } catch (err) {
    console.error('sauvegarde-fenetre : erreur interne', (err as any)?.name || 'inconnue');
    return refus('erreur interne de la fonction sauvegarde-fenetre', 500);
  }
});
