// Export complet pour la sauvegarde quotidienne (dépôt privé lartbo-matrice-backup).
// Appel : POST { secret } → { tables: { nom: [lignes] }, files: [{ path, url, size }] }
// Les liens des fichiers sont temporaires (2 h) ; le secret est dans private.import_secrets ('backup_secret').
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const TABLES = ['app_users', 'settings', 'partners', 'projects', 'structures', 'contacts', 'contact_structures',
  'shows', 'show_payments', 'prospects', 'prospect_logs', 'prospect_files', 'tasks'];
// colonne(s) de tri pour lire les grandes tables page par page
const ORDER: Record<string, string[]> = { app_users: ['email'], settings: ['key'], contact_structures: ['contact_id', 'structure_id'] };
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

    const files = (tables.prospect_files as any[]).filter((f) => f.path && f.mime !== 'link');
    const out: { path: string; url: string; size: number }[] = [];
    for (let i = 0; i < files.length; i += 100) {
      const chunk = files.slice(i, i + 100);
      const { data, error } = await sb.storage.from('suivi').createSignedUrls(chunk.map((f) => f.path), 7200);
      if (error) throw error;
      data.forEach((d, j) => d.signedUrl && out.push({ path: chunk[j].path, url: d.signedUrl, size: chunk[j].size || 0 }));
    }
    return json({ exported_at: new Date().toISOString(), tables, files: out });
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});
