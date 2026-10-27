// Lit une pièce comptable (facture, bulletin de paie, note de frais…) déposée dans le budget d'une date,
// avec Gemini (clé Google AI Studio enregistrée dans Réglages › IA), et renvoie ses informations en JSON.
// Appelée depuis l'app (utilisateur connecté) : POST { path, show_id?, project_id? }
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const region = () => Deno.env.get('SB_REGION') || Deno.env.get('DENO_REGION') || '';

const CATS = ['Technique', 'VHR', 'Promo', 'Accueil', 'Taxes', 'Autres', 'Staff', 'Movinmotion', 'Solde artiste'];

const PROMPT = (ctx: string) => `Tu lis une pièce comptable pour L'ArtBoristerie Productions (production de concerts, Paris).
${ctx}
Réponds UNIQUEMENT avec un objet JSON, sans texte autour, avec ces clés (null si l'information n'apparaît pas) :
{
 "type": "facture_emise" (facture émise PAR L'ArtBoristerie Productions à un client) | "facture_recue" (facture d'un fournisseur ou d'un artiste adressée à L'ArtBoristerie) | "bulletin" (bulletin de salaire) | "note_de_frais" | "avoir" | "recu" | "autre",
 "emetteur": nom de qui émet la pièce (pour un bulletin : l'employeur),
 "destinataire": nom du client ou destinataire,
 "numero": numéro de la facture / pièce,
 "date": date de la pièce au format AAAA-MM-JJ,
 "montant_ht": total hors taxes (nombre),
 "montant_ttc": total TTC / net à payer (nombre),
 "tva_taux": taux de TVA principal en % (nombre, ex. 20 ou 5.5 ; 0 si pas de TVA),
 "personne": pour un bulletin ou une note de frais : prénom et nom du salarié,
 "cout_employeur": pour un bulletin : coût total employeur (nombre),
 "net": pour un bulletin : net à payer (nombre),
 "categorie": une valeur parmi ${CATS.join(', ')} (Technique = matériel, son, lumière, backline ; VHR = voyage, transport, hébergement, restauration, péages, carburant ; Promo = affiches, impression, publicité ; Accueil = catering, loges ; Taxes = CNM, SACEM ; Staff = salaires ; Solde artiste = facture de l'artiste ou de son représentant pour son cachet ; Autres = le reste),
 "libelle": libellé court en français (ex. « Train Paris-Lille Julien », « Affiches lot 2 », « Cachet 12/03 »),
 "acompte_ou_solde": pour une facture émise : "acompte" ou "solde" si c'est indiqué, sinon null,
 "acquittee": true si la pièce indique qu'elle est payée / acquittée
}
Les montants sont des nombres avec un point décimal, sans symbole. N'invente rien.`;

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
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { path, show_id, project_id } = await req.json();
    if (!path || !/^budget\//.test(path)) return json({ error: 'Pièce manquante' }, 400);
    // droits de l'équipe vérifiés en lisant avec le compte de l'utilisateur
    const { data: ok } = await user.rpc('is_team');
    if (!ok) return json({ error: 'Accès refusé' }, 403);
    const { data: gkey } = await admin.rpc('import_secret', { k: 'gemini_key' });
    if (!gkey) return json({ error: "Aucune clé d'IA : Réglages › IA" }, 503);
    if (region() && !/^eu-/.test(region())) return json({ error: `Pièce non envoyée : la fonction ne tourne pas en Europe (${region()}).` }, 503);

    let ctx = '';
    if (show_id) {
      const { data: s } = await admin.from('shows').select('date,venue,city,fee_ht,project_id,projects(name)').eq('id', show_id).single();
      if (s) ctx = `Elle concerne le concert de ${(s as any).projects?.name || '?'} le ${s.date} à ${s.venue || ''} (${s.city || ''}), cachet ${s.fee_ht ?? '?'} € HT.`;
    } else if (project_id) {
      const { data: p } = await admin.from('projects').select('name').eq('id', project_id).single();
      if (p) ctx = `Elle concerne la tournée de ${p.name} (frais hors date).`;
    }

    const { data: blob, error: dlErr } = await admin.storage.from('suivi').download(path);
    if (dlErr || !blob) return json({ error: 'Pièce introuvable' }, 404);
    if (blob.size > 15e6) return json({ error: 'Pièce trop lourde (15 Mo max)' }, 413);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const lower = path.toLowerCase();
    const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type
      : lower.endsWith('.pdf') ? 'application/pdf' : /\.(jpe?g)$/.test(lower) ? 'image/jpeg' : lower.endsWith('.png') ? 'image/png' : lower.endsWith('.heic') ? 'image/heic' : 'application/pdf';

    const res = await askGemini(gkey, [{ inline_data: { mime_type: mime, data: btoa(bin) } }, { text: PROMPT(ctx) }],
      { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      (t) => JSON.parse(t.replace(/^```[a-z]*\n?|```$/g, '')));
    if ('error' in res) return json({ error: res.error }, 502);
    const doc: any = res.ok;
    if (doc.categorie && !CATS.includes(doc.categorie)) doc.categorie = 'Autres';
    for (const k of ['montant_ht', 'montant_ttc', 'tva_taux', 'cout_employeur', 'net']) {
      if (doc[k] != null && typeof doc[k] !== 'number') { const n = parseFloat(String(doc[k]).replace(/\s/g, '').replace(',', '.')); doc[k] = isNaN(n) ? null : n; }
    }
    return json({ doc });
  } catch (err) {
    console.error(err);   // détail technique dans les journaux du serveur seulement (v1.47)
    return json({ error: 'Erreur inattendue du serveur : réessaie dans un instant.' }, 500);
  }
});
