// Met à jour le résumé d'un suivi avec Claude, à partir du journal, des notes et des PDF.
// Appelée depuis l'app (utilisateur connecté) : POST { prospect_id }
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PROMPT = `Tu mets à jour la fiche de suivi d'une structure (salle, festival…) pour L'ArtBoristerie, agence de booking et de production de concerts.
Analyse tout ce qui suit : le résumé existant, le journal des échanges (appels, mails, rendez-vous), les notes libres et le texte lisible dans les pièces jointes (mails imprimés en PDF).

Rédige le résumé en français, 6 à 8 puces maximum, dans cet ordre, en omettant une puce seulement si aucune information n'existe :
- **Contexte / interlocuteurs :**
- **Date(s) visée(s) / option(s) :**
- **Jauge + billetterie :**
- **Offre financière :** (préciser HT/TTC si présent)
- **Accueil / VHR / technique :** (rider, rooms, repas, transport…)
- **Statut actuel :**
- **Prochaine action + date de relance :**
Termine par la ligne « Dernière mise à jour : {AUJOURDHUI} ».
Format : une puce par ligne commençant par « - », libellés en **gras** comme ci-dessus. N'invente rien : si une information manque, ne la suppose pas. Réponds uniquement avec le résumé, sans introduction.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') || '';
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    });
    const { prospect_id } = await req.json();
    if (!prospect_id) return json({ error: 'prospect_id manquant' }, 400);

    // Lecture avec les droits de l'utilisateur : refusé si ce n'est pas l'équipe
    const { data: p, error } = await user.from('prospects').select('*').eq('id', prospect_id).single();
    if (error || !p) return json({ error: 'Suivi introuvable ou accès refusé' }, 403);

    const { data: key } = await admin.rpc('import_secret', { k: 'anthropic_key' });
    if (!key || !String(key).startsWith('sk-')) return json({ error: "La clé d'API Anthropic n'est pas encore configurée." }, 503);

    const [{ data: st }, { data: pr }, { data: logs }, { data: files }] = await Promise.all([
      user.from('structures').select('name,city,country').eq('id', p.structure_id).maybeSingle(),
      user.from('projects').select('name').eq('id', p.project_id).maybeSingle(),
      user.from('prospect_logs').select('date,kind,contact_name,body').eq('prospect_id', p.id).eq('hidden', false).order('date', { ascending: true }),
      user.from('prospect_files').select('name,path,mime,size,created_at').eq('prospect_id', p.id).order('created_at', { ascending: false }),
    ]);

    const today = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
    const journal = (logs || []).map((l: any) => `[${l.date || 'sans date'}] ${l.kind}${l.contact_name ? ' — ' + l.contact_name : ''}\n${l.body || ''}`).join('\n\n');
    const text = [
      `Structure : ${st?.name || '?'}${st?.city ? ' (' + st.city + ')' : ''}`,
      `Artiste / projet : ${pr?.name || '?'}`,
      `Statut du suivi : ${p.status || '?'}`,
      `\nRésumé existant :\n${p.summary || '(aucun)'}`,
      `\nJournal des échanges :\n${journal || '(vide)'}`,
      `\nNotes libres :\n${p.content_md || '(aucune)'}`,
    ].join('\n');

    // Jusqu'à 4 PDF les plus récents (≤ 8 Mo chacun) envoyés tels quels à Claude
    const content: any[] = [];
    for (const f of (files || []).filter((f: any) => f.mime !== 'link' && /pdf/i.test(f.mime || f.name) && (f.size || 0) < 8e6).slice(0, 4)) {
      const { data: blob } = await admin.storage.from('suivi').download(f.path);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      content.push({ type: 'document', title: f.name, source: { type: 'base64', media_type: 'application/pdf', data: btoa(bin) } });
    }
    content.push({ type: 'text', text: PROMPT.replace('{AUJOURDHUI}', today) + '\n\n---\n' + text });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': String(key), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1500, messages: [{ role: 'user', content }] }),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: 'IA : ' + (out?.error?.message || r.status) }, 502);
    const summary = (out.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    if (!summary) return json({ error: "L'IA n'a rien renvoyé" }, 502);

    const { error: ue } = await user.from('prospects').update({ summary }).eq('id', p.id);
    if (ue) return json({ error: ue.message }, 500);
    return json({ summary });
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});
