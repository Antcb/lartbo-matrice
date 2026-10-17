// Pennylane (API v2) : crée les devis et les factures en BROUILLON à partir d'une date de la Matrice.
// Le jeton API est gardé côté serveur (Réglages › Pennylane). Appelée depuis l'app (utilisateur connecté) :
//   { action: 'status' }                       → nom de la société connectée
//   { action: 'quote', show_id }               → devis (cession, co-réalisation, co-production…) au nom de l'organisateur
//   { action: 'invoice', payment_id }          → facture brouillon : acompte / solde (organisateur) ou commission (artiste)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const API = 'https://app.pennylane.com/api/external/v2';

let TOKEN = '';
async function pl(method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + TOKEN, accept: 'application/json', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let out: any = null; try { out = txt ? JSON.parse(txt) : null; } catch { out = { message: txt }; }
  if (!r.ok) {
    const msg = out?.error || out?.message || (out?.errors ? JSON.stringify(out.errors) : txt);
    if (r.status === 401) throw new Error('Pennylane refuse le jeton : vérifie-le dans Réglages › Pennylane');
    if (r.status === 403) throw new Error('Le jeton Pennylane n’a pas les droits nécessaires (lecture/écriture Clients, Factures clients, Devis) : ' + msg);
    throw new Error(`Pennylane ${r.status} : ${String(msg).slice(0, 400)}`);
  }
  return out;
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const vatCode = (rate: number | null, country: string) => {
  const r = Number(rate ?? 0);
  if (!r) return /^(fr|france)?$/i.test(country.trim()) ? 'FR_0' : 'exempt';
  return 'FR_' + String(Math.round(r * 10));     // 20 → FR_200, 5,5 → FR_55, 10 → FR_100, 2,1 → FR_21
};
const frDate = (d: string) => d ? d.split('-').reverse().join('/') : '';
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ISO2: Record<string, string> = { france: 'FR', suisse: 'CH', switzerland: 'CH', belgique: 'BE', belgium: 'BE', espagne: 'ES', spain: 'ES', allemagne: 'DE', germany: 'DE', 'pays-bas': 'NL', netherlands: 'NL', luxembourg: 'LU', italie: 'IT', italy: 'IT', 'royaume-uni': 'GB', portugal: 'PT', canada: 'CA' };
const iso2 = (c: string) => { const k = (c || 'France').trim().toLowerCase(); return k.length === 2 ? k.toUpperCase() : (ISO2[k] || 'FR'); };

/** Client Pennylane d'une structure : retrouvé par référence externe, sinon créé (raison sociale, adresse, SIRET, TVA) */
async function customerFor(st: any): Promise<number> {
  if (st.pennylane_id) return Number(st.pennylane_id);
  const ref = 'matrice-' + st.id;
  const filter = encodeURIComponent(JSON.stringify([{ field: 'external_reference', operator: 'eq', value: ref }]));
  try {
    const found = await pl('GET', `/customers?filter=${filter}&limit=1`);
    const c = (found?.items || found?.data || [])[0];
    if (c?.id) { await admin.from('structures').update({ pennylane_id: String(c.id) }).eq('id', st.id); return c.id; }
  } catch (_) { /* la recherche peut échouer : on crée */ }
  const a = st.admin || {};
  const body: any = {
    name: a.legal_name || st.name,
    external_reference: ref,
    billing_address: { address: a.address || st.address || '', postal_code: a.postal_code || st.postal_code || '', city: a.city || st.city || '', country_alpha2: iso2(a.country || st.country || 'France') },
  };
  const emails = [a.billing_email, a.email].filter(Boolean);
  if (emails.length) body.emails = emails;
  if (a.siret) body.reg_no = String(a.siret).replace(/\s/g, '');
  if (a.vat) body.vat_number = String(a.vat).replace(/\s/g, '');
  const c = await pl('POST', '/company_customers', body);
  await admin.from('structures').update({ pennylane_id: String(c.id) }).eq('id', st.id);
  return c.id;
}

const CONTRACT_LABEL: Record<string, string> = {
  'Cession': 'Contrat de cession', 'Co-Réalisation': 'Contrat de co-réalisation', 'Co-Production': 'Contrat de co-production',
  'Production': 'Production', 'Coproduction': 'Contrat de co-production',
};

/** Pennylane renvoie parfois l'adresse du PDF et l'identifiant : on garde ce qui existe */
const linkOf = (o: any) => o?.public_file_url || o?.file_url || o?.url || null;

async function create(kind: 'quotes' | 'customer_invoices', body: any) {
  try { return await pl('POST', '/' + kind, body); }
  catch (e) {
    // champs facultatifs refusés par certaines versions de l'API : on réessaie sans
    if (/pdf_invoice_subject|external_reference|draft/i.test(String(e))) {
      const b = { ...body }; delete b.pdf_invoice_subject; if (/external_reference/i.test(String(e))) delete b.external_reference;
      return await pl('POST', '/' + kind, b);
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
    const { data: team } = await user.rpc('is_team');
    if (!team) return json({ error: 'Accès refusé' }, 403);
    const { data: tok } = await admin.rpc('import_secret', { k: 'pennylane_token' });
    if (!tok) return json({ error: 'Pas encore de jeton Pennylane : Réglages › Pennylane' }, 503);
    TOKEN = String(tok);
    const body = await req.json();

    if (body.action === 'status') {
      const me = await pl('GET', '/me');
      return json({ ok: true, company: me?.company?.name || me?.user?.email || null });
    }

    if (body.action === 'quote') {
      const { data: s } = await admin.from('shows').select('*, projects(name)').eq('id', body.show_id).single();
      if (!s) return json({ error: 'Date introuvable' }, 404);
      if (!s.structure_id) return json({ error: 'La date n’a pas de structure (organisateur) : impossible de choisir le client' }, 400);
      const { data: st } = await admin.from('structures').select('*').eq('id', s.structure_id).single();
      const fee = Number(s.fee_ht) || 0;
      if (!fee) return json({ error: 'Le cachet HT de la date est vide' }, 400);
      const type = CONTRACT_LABEL[s.contract_type] || (s.contract_type ? 'Contrat — ' + s.contract_type : 'Contrat de cession');
      const artist = s.projects?.name || '';
      const label = `${type} — ${artist} — ${frDate(s.date)} — ${[s.venue, s.city].filter(Boolean).join(', ')}`;
      const country = st?.admin?.country || st?.country || 'France';
      const customer_id = await customerFor(st);
      const q = await create('quotes', {
        customer_id, date: today(), deadline: plusDays(30), external_reference: 'matrice-devis-' + s.id + '-' + Date.now(),
        pdf_invoice_subject: label,
        invoice_lines: [{ label: s.contract_type === 'Co-Réalisation' ? label + ' (minimum garanti)' : label, quantity: 1, unit: 'piece', raw_currency_unit_price: money(fee), vat_rate: vatCode(s.vat_rate ?? 5.5, country) }],
      });
      return json({ ok: true, id: q.id, number: q.quote_number || q.invoice_number || null, url: linkOf(q) });
    }

    if (body.action === 'invoice') {
      const { data: p } = await admin.from('show_payments').select('*').eq('id', body.payment_id).single();
      if (!p) return json({ error: 'Ligne de facturation introuvable' }, 404);
      const { data: s } = await admin.from('shows').select('*, projects(*)').eq('id', p.show_id).single();
      const fee = Number(s.fee_ht) || 0, proj = s.projects || {};
      let amount = p.amount != null ? Number(p.amount) : null;
      if (amount == null) {
        if (p.kind === 'artbo') amount = Math.round(fee * Number(p.pct ?? s.artbo_pct ?? 15)) / 100;
        else if (p.pct != null) amount = Math.round(fee * Number(p.pct)) / 100;
      }
      if (!amount) return json({ error: 'Montant de la ligne vide' }, 400);
      let st: any, vat: number, label: string;
      const where = `${proj.name || ''} — ${frDate(s.date)} — ${[s.venue, s.city].filter(Boolean).join(', ')}`;
      if (p.kind === 'artbo') {
        // commission : facturée à la structure administrative de l'artiste (fiche projet)
        if (!proj.admin_structure_id) return json({ error: 'Indique la structure administrative de l’artiste dans sa fiche projet (c’est le client de la facture de commission)' }, 400);
        st = (await admin.from('structures').select('*').eq('id', proj.admin_structure_id).single()).data;
        vat = Number(p.vat_rate ?? 20);
        label = `Commission de booking (${p.pct ?? s.artbo_pct ?? 15} % du cachet de ${money(fee)} € HT) — ${where}`;
      } else {
        if (!s.structure_id) return json({ error: 'La date n’a pas de structure (organisateur)' }, 400);
        st = (await admin.from('structures').select('*').eq('id', s.structure_id).single()).data;
        vat = Number(p.vat_rate ?? s.vat_rate ?? 5.5);
        const what = p.kind === 'acompte' ? `Acompte${p.pct ? ' de ' + p.pct + ' %' : ''}` : p.kind === 'solde' ? 'Solde' : (p.label || 'Prestation');
        label = `${what} — ${(CONTRACT_LABEL[s.contract_type] || 'Contrat de cession').toLowerCase()} — ${where}`;
      }
      const country = st?.admin?.country || st?.country || 'France';
      const customer_id = await customerFor(st);
      const inv = await create('customer_invoices', {
        customer_id, date: today(), deadline: plusDays(30), draft: true, external_reference: 'matrice-' + p.id + '-' + Date.now(),
        pdf_invoice_subject: label,
        invoice_lines: [{ label, quantity: 1, unit: 'piece', raw_currency_unit_price: money(amount), vat_rate: vatCode(vat, country) }],
      });
      return json({ ok: true, id: inv.id, number: inv.invoice_number || null, url: linkOf(inv) });
    }
    return json({ error: 'Action inconnue' }, 400);
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});
