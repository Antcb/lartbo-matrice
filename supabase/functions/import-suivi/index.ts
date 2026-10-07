// Import du contenu des pages Notion « Suivi » (résumé, journal, PDF).
// Appel : POST { secret, limit } — traite `limit` fiches non encore importées.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { splitSuivi } from './convert.js';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

async function secret(k: string) {
  const { data, error } = await sb.rpc('import_secret', { k });
  if (error) throw error;
  return data as string;
}

async function notion(path: string, token: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch('https://api.notion.com/v1/' + path, {
      headers: { Authorization: 'Bearer ' + token, 'Notion-Version': '2025-09-03' },
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1200 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`Notion ${r.status} : ${(await r.text()).slice(0, 300)}`);
    return await r.json();
  }
  throw new Error('Notion indisponible');
}

async function children(id: string, token: string, depth = 0): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined;
  do {
    const j = await notion(`blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`, token);
    all.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  if (depth < 4) {
    for (const b of all) {
      if (b.has_children && b.type !== 'child_page' && b.type !== 'child_database') b.children = await children(b.id, token, depth + 1);
    }
  }
  return all;
}

const safe = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-120);

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.secret || body.secret !== (await secret('fn_secret'))) return new Response('unauthorized', { status: 401 });
    const token = await secret('notion_token');
    const limit = Math.min(Number(body.limit) || 10, 40);

    const ctx = { users: {} as Record<string, string> };

    const { data: todo, error } = await sb.from('prospects')
      .select('id,notion_id').not('notion_id', 'is', null).is('content_imported_at', null).limit(limit);
    if (error) throw error;

    const done: string[] = [];
    for (const p of todo || []) {
      try {
        const blocks = await children(p.notion_id, token);
        const r = splitSuivi(blocks, ctx);

        if (r.logs.length) {
          const rows = r.logs.map((l: any) => ({
            import_key: l.key, prospect_id: p.id, date: l.date, kind: l.kind,
            contact_name: l.contact_name, body: l.body, sort: l.sort,
          }));
          const { error: e } = await sb.from('prospect_logs').upsert(rows, { onConflict: 'import_key' });
          if (e) throw e;
        }

        for (const f of r.files) {
          if (!f.url) continue;
          const path = `${p.id}/${f.id.slice(0, 8)}_${safe(f.name)}`;
          if (f.external) {
            await sb.from('prospect_files').upsert({ import_key: f.id, prospect_id: p.id, name: f.name, path: f.url, mime: 'link' }, { onConflict: 'import_key' });
            continue;
          }
          const dl = await fetch(f.url);
          if (!dl.ok) throw new Error(`Téléchargement ${f.name} : ${dl.status}`);
          const buf = new Uint8Array(await dl.arrayBuffer());
          const mime = dl.headers.get('content-type') || 'application/octet-stream';
          const { error: ue } = await sb.storage.from('suivi').upload(path, buf, { contentType: mime, upsert: true });
          if (ue) throw ue;
          const { error: fe } = await sb.from('prospect_files').upsert(
            { import_key: f.id, prospect_id: p.id, name: f.name, path, size: buf.length, mime }, { onConflict: 'import_key' });
          if (fe) throw fe;
        }

        const { error: pe } = await sb.from('prospects').update({
          summary: r.summary, content_md: r.content, content_imported_at: new Date().toISOString(), import_error: null,
        }).eq('id', p.id);
        if (pe) throw pe;
        done.push(p.id);
      } catch (err) {
        await sb.from('prospects').update({
          import_error: String((err as any)?.message || err).slice(0, 500), content_imported_at: new Date().toISOString(),
        }).eq('id', p.id);
      }
    }
    const { count } = await sb.from('prospects').select('id', { count: 'exact', head: true })
      .not('notion_id', 'is', null).is('content_imported_at', null);
    return Response.json({ traites: (todo || []).length, ok: done.length, restants: count });
  } catch (err) {
    return Response.json({ error: String((err as any)?.message || err) }, { status: 500 });
  }
});
