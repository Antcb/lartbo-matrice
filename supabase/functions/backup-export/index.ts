// Export complet pour la sauvegarde quotidienne (dépôt privé lartbo-matrice-backup).
// Appel : POST { secret } → { tables: { nom: [lignes] }, files: [{ bucket, path, url, size }], missing: ['espace/chemin'] }
// missing : fichiers référencés introuvables dans le stockage (signalés au lieu d'être ignorés).
// Les réglages des intégrations (adresses et codes des scripts Google et de Brevo) ne sont jamais exportés.
// Les liens des fichiers sont temporaires (2 h) ; le secret est dans private.import_secrets ('backup_secret').
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const TABLES = ['app_users', 'settings', 'partners', 'projects', 'structures', 'contacts', 'contact_structures',
  'shows', 'show_payments', 'prospects', 'prospect_logs', 'prospect_files', 'tasks',
  'structure_events', 'project_logs', 'project_members', 'attachments', 'notifications', 'mail_templates', 'employees', 'budget_lines'];
// colonne(s) de tri pour lire les grandes tables page par page
const ORDER: Record<string, string[]> = { app_users: ['email'], settings: ['key'], contact_structures: ['contact_id', 'structure_id'] };
// Réglages des intégrations (scripts Google, Brevo) : même liste que outils/neutraliser.sql du dépôt de sauvegarde
const INTEGRATION_KEYS = new Set(['drive_webhook_url', 'drive_webhook_secret', 'prospect_script_url', 'prospect_from', 'rename_sheet_url',
  'brevo_api_key', 'brevo_hook_secret', 'brevo_list_id', 'functions_base_url']);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function all(table: string) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select('*');
    for (const c of ORDER[table] || ['id']) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(table + ' : ' + error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

Deno.serve(async (req) => {
  try {
    const { secret } = await req.json().catch(() => ({}));
    const { data: expected } = await sb.rpc('import_secret', { k: 'backup_secret' });
    if (!expected || secret !== expected) return json({ error: 'refusé' }, 403);

    const tables: Record<string, unknown[]> = {};
    for (const t of TABLES) tables[t] = await all(t);
    // B1 : adresses et codes des intégrations jamais exportés (ils se ressaisissent à la restauration)
    tables.settings = (tables.settings as any[]).filter((r) => !INTEGRATION_KEYS.has(r.key));

    // Tous les fichiers stockés, avec leur espace de stockage : pièces des suivis, tâches, projets, budgets, encaissements,
    // pièces jointes des modèles de mail (« suivi ») et pièces des salariés pas encore rangées dans le Drive (« rh »)
    const T = tables as Record<string, any[]>;
    const files: { bucket: string; path: string; size: number }[] = [
      ...T.prospect_files.filter((f) => f.mime !== 'link'), ...T.attachments,
      ...T.projects.flatMap((p) => [p.photo_path, p.photo_orig].filter(Boolean).map((path: string) => ({ path }))),
      ...T.budget_lines.filter((l) => l.file_path).map((l) => ({ path: l.file_path })),
      ...T.show_payments.filter((p) => p.file_path).map((p) => ({ path: p.file_path })),
      ...T.mail_templates.flatMap((m) => (m.attachments || []).filter((a: any) => a?.path).map((a: any) => ({ path: a.path, size: a.size }))),
    ].filter((f: any) => f.path).map((f: any) => ({ bucket: 'suivi', path: f.path, size: f.size || 0 }))
      .concat(T.employees.flatMap((e) => (e.docs || []).filter((d: any) => d?.path && !d.file_id).map((d: any) => ({ bucket: 'rh', path: d.path, size: 0 }))))
      // fichiers envoyés par les artistes (fiche artiste) pas encore rangés dans le Drive (« artiste »)
      .concat(T.projects.flatMap((p) => (p.artist_docs || []).filter((d: any) => d?.path && !d.file_id).map((d: any) => ({ bucket: 'artiste', path: d.path, size: 0 }))));
    const out: { bucket: string; path: string; url: string; size: number }[] = [];
    const missing: string[] = [];   // fichier référencé mais introuvable : signalé au lieu d'être ignoré
    for (const bucket of ['suivi', 'rh', 'artiste']) {
      const list = [...new Map(files.filter((f) => f.bucket === bucket).map((f) => [f.path, f])).values()];
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const { data, error } = await sb.storage.from(bucket).createSignedUrls(chunk.map((f) => f.path), 7200);
        if (error) throw error;
        // chemin d'origine pour « suivi » (compatible avec les sauvegardes existantes), préfixé pour « rh » et « artiste »
        data.forEach((d, j) => d.signedUrl ? out.push({ bucket, path: (bucket === 'suivi' ? '' : bucket + '/') + chunk[j].path, url: d.signedUrl, size: chunk[j].size })
          : missing.push(bucket + '/' + chunk[j].path));
      }
    }
    return json({ exported_at: new Date().toISOString(), tables, files: out, missing });
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});
