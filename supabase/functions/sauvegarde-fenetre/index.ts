// Démarrage réel, fermeture et fin des sauvegardes (dépôt privé lartbo-matrice-backup), décision d'Anthony du 09/11/2026.
// Appel : POST { secret, action: 'demarrer' | 'fermer' | 'terminer', … } (voir regles.ts) → réponse de public.sauvegarde_declenchement.
// Secret DÉDIÉ : private.import_secrets 'sauvegarde_declenchement_secret' (migration 2026-11-09_sauvegarde_declenchement.sql), recopié
// une fois par Anthony dans le secret GitHub SAUVEGARDE_SIGNAL_SECRET du dépôt de sauvegarde. Il ne donne qu'un droit : ouvrir la
// connexion du rôle « sauvegarde » 1 h au plus (qui exige EN PLUS son mot de passe, rangé ailleurs) et enregistrer un statut.
// À déployer SANS vérification du jeton Supabase (« Verify JWT » désactivé, comme backup-export) : la protection est le secret.
// Jamais de secret ni de détail interne dans la réponse.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { lireDemande, secretOk } from './regles.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'méthode refusée' }, 405);
  try {
    const b = await req.json().catch(() => null);
    const { data: attendu } = await sb.rpc('import_secret', { k: 'sauvegarde_declenchement_secret' });
    if (!secretOk(b?.secret, attendu)) return json({ error: 'refusé' }, 403);
    const d = lireDemande(b);
    if (typeof d === 'string') return json({ error: d }, 400);
    const { data, error } = await sb.rpc('sauvegarde_declenchement', { p_action: d.action, p: d.p });
    if (error) { console.error('sauvegarde-fenetre', d.action, error.message); return json({ error: 'base : ' + error.message.slice(0, 200) }, 500); }
    return json(data);
  } catch (err) {
    console.error('sauvegarde-fenetre', String((err as any)?.message || err));
    return json({ error: 'erreur interne' }, 500);
  }
});
