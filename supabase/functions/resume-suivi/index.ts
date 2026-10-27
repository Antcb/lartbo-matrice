// Met à jour le résumé d'un suivi par IA (Gemini gratuit, ou Claude si une clé Anthropic est configurée),
// à partir du journal, des notes et des PDF. Appelée depuis l'app (utilisateur connecté) : POST { prospect_id }
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
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

/** Région où tourne la fonction (ex. eu-west-3 = Paris) */
const region = () => Deno.env.get('SB_REGION') || Deno.env.get('DENO_REGION') || '';

/**
 * Appel à Gemini (offre gratuite) : essaie les modèles « Flash » du plus récent au plus ancien.
 * Les plus récents sont souvent saturés (« high demand ») : on passe au suivant, puis on refait un tour après une pause.
 * `accept` transforme la réponse (ou lève une erreur si elle est inutilisable).
 */
async function askGemini<T>(gkey: string, parts: unknown[], generationConfig: Record<string, unknown>, accept: (txt: string) => T): Promise<{ ok: T } | { error: string }> {
  const list = await (await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': gkey } })).json();   // clé en en-tête, jamais dans l'adresse (v1.47)
  if (list.error) { console.error('Gemini', list.error.message); return { error: [400, 401, 403].includes(list.error.code) ? 'Clé IA refusée par Google : vérifie-la dans Réglages › IA.' : 'Gemini indisponible pour le moment : réessaie dans quelques minutes.' }; }
  const models: string[] = (list.models || [])
    .filter((m: any) => /flash/i.test(m.name) && !/lite|image|tts|audio|live|omni|thinking-exp|embedding/i.test(m.name)
      && (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m: any) => m.name)
    .sort((a: string, b: string) => {
      const v = (n: string) => parseFloat((n.match(/(\d+(?:\.\d+)?)/) || ['0'])[0]);
      const pre = (n: string) => /preview|exp/.test(n) ? 1 : 0;
      return pre(a) - pre(b) || v(b) - v(a);
    })
    .slice(0, 6);
  if (!models.length) return { error: 'Gemini : aucun modèle Flash disponible' };
  const deadline = Date.now() + 110_000;
  let lastErr = '', busy = 0, tries = 0;
  for (let round = 0; round < 2; round++) {
    if (round) await new Promise((r) => setTimeout(r, 4000));
    for (const model of models) {
      if (Date.now() > deadline) break;
      tries++;
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': gkey },
          body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
        });
        const out = await r.json();
        if (r.status === 404) { tries--; continue; }   // modèle retiré par Google : on passe au suivant
        if (!r.ok) { lastErr = out?.error?.message || String(r.status); if (r.status === 503 || r.status === 429) busy++; continue; }
        const txt = (out.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || '').join('').trim();
        if (!txt) { lastErr = 'réponse vide (' + (out.candidates?.[0]?.finishReason || '?') + ')'; continue; }
        return { ok: accept(txt) };
      } catch (e) { lastErr = String((e as any)?.message || e); }
    }
  }
  if (tries && busy === tries) return { error: 'Gemini est saturé en ce moment (forte demande chez Google). Réessaie dans quelques minutes.' };
  console.error('Gemini', lastErr); return { error: 'Gemini n’a pas pu répondre : réessaie dans quelques minutes.' };
}

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

    const [{ data: gkey }, { data: akey }] = await Promise.all([
      admin.rpc('import_secret', { k: 'gemini_key' }), admin.rpc('import_secret', { k: 'anthropic_key' }),
    ]);
    if (!gkey && !String(akey || '').startsWith('sk-')) return json({ error: "Aucune clé d'IA n'est encore configurée." }, 503);

    const [{ data: st }, { data: pr }, { data: logs }, { data: files }] = await Promise.all([
      user.from('structures').select('name,city,country').eq('id', p.structure_id).maybeSingle(),
      user.from('projects').select('name').in('id', (p.project_ids && p.project_ids.length) ? p.project_ids : [p.project_id].filter(Boolean)),
      user.from('prospect_logs').select('date,kind,contact_name,body').eq('prospect_id', p.id).eq('hidden', false).order('date', { ascending: true }),
      user.from('prospect_files').select('name,path,mime,size,created_at').eq('prospect_id', p.id).order('created_at', { ascending: false }),
    ]);

    const today = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
    const journal = (logs || []).map((l: any) => `[${l.date || 'sans date'}] ${l.kind}${l.contact_name ? ' — ' + l.contact_name : ''}\n${l.body || ''}`).join('\n\n');
    const text = [
      `Structure : ${st?.name || '?'}${st?.city ? ' (' + st.city + ')' : ''}`,
      `Artiste(s) : ${(pr || []).map((x: any) => x.name).join(', ') || '?'}`,
      `Statut du suivi : ${p.status || '?'}`,
      `\nRésumé existant :\n${p.summary || '(aucun)'}`,
      `\nJournal des échanges :\n${journal || '(vide)'}`,
      `\nNotes libres :\n${p.content_md || '(aucune)'}`,
    ].join('\n');

    // Jusqu'à 4 PDF les plus récents (≤ 8 Mo chacun) envoyés tels quels à Claude
    const pdfs: { name: string; data: string }[] = [];
    for (const f of (files || []).filter((f: any) => f.mime !== 'link' && /pdf/i.test(f.mime || f.name) && (f.size || 0) < 8e6).slice(0, 4)) {
      const { data: blob } = await admin.storage.from('suivi').download(f.path);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      pdfs.push({ name: f.name, data: btoa(bin) });
    }
    const instruction = PROMPT.replace('{AUJOURDHUI}', today) + '\n\n---\n' + text;

    let summary = '';
    if (gkey) {
      // Google applique ses règles « payantes » (pas d'entraînement, pas de relecture humaine) aux demandes venant d'Europe :
      // on n'envoie rien à Gemini si la fonction ne tourne pas dans une région européenne
      if (region() && !/^eu-/.test(region())) return json({ error: `Résumé non envoyé : la fonction ne tourne pas en Europe (${region() || 'région inconnue'}).` }, 503);
      const res = await askGemini(gkey, [
        ...pdfs.map((p) => ({ inline_data: { mime_type: 'application/pdf', data: p.data } })),
        { text: instruction },
      ], { temperature: 0.2, maxOutputTokens: 8192 }, (t) => t);
      if ('error' in res) return json({ error: res.error }, 502);
      summary = res.ok;
    } else {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': String(akey), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1500, messages: [{ role: 'user', content: [
          ...pdfs.map((p) => ({ type: 'document', title: p.name, source: { type: 'base64', media_type: 'application/pdf', data: p.data } })),
          { type: 'text', text: instruction },
        ] }] }),
      });
      const out = await r.json();
      if (!r.ok) { console.error('IA', out?.error?.message || r.status); return json({ error: 'L’IA n’a pas pu répondre : réessaie dans quelques minutes.' }, 502); }
      summary = (out.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    }
    summary = summary.replace(/^```[a-z]*\n?|```$/g, '').trim();
    if (!summary) return json({ error: "L'IA n'a rien renvoyé" }, 502);

    const { error: ue } = await user.from('prospects').update({ summary }).eq('id', p.id);
    if (ue) { console.error(ue.message); return json({ error: 'Résumé non enregistré : réessaie dans un instant.' }, 500); }
    return json({ summary });
  } catch (err) {
    console.error(err);   // détail technique dans les journaux du serveur seulement (v1.47)
    return json({ error: 'Erreur inattendue du serveur : réessaie dans un instant.' }, 500);
  }
});
