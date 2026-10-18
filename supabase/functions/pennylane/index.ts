// Pennylane (API v2) : crée les devis et les factures en BROUILLON à partir d'une date de la Matrice,
// au format des factures L'ArtBo déjà dans Pennylane :
//   Titre du document = l'artiste · Description = « 12/03/2027 • Bagnols-sur-Cèze (30) • LA MOBA »
//   En-tête : Projet = l'artiste, Date de réalisation = date du concert
//   Ligne : produit « Production de Spectacles • Cession / Coréalisation » (TVA 5,5 %), quantité = part du cachet (0,5 pour 50 %)
//   Commission : produit « Commission • Booking » (TVA 20 %), facturée à la structure administrative de l'artiste.
// Le jeton API est gardé côté serveur (Réglages › Pennylane). Appels depuis l'app (utilisateur connecté) :
//   { action: 'status' } · { action: 'quote', show_id } · { action: 'invoice', payment_id }
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
    if (r.status === 403) throw new Error('Le jeton Pennylane n’a pas les droits nécessaires : ' + msg);
    throw new Error(`Pennylane ${r.status} : ${String(msg).slice(0, 400)}`);
  }
  return out;
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const vatCode = (rate: number | null, country: string) => {
  const r = Number(rate ?? 0);
  if (!r) return /^(fr|france)?$/i.test(country.trim()) ? 'FR_0' : 'exempt';
  return 'FR_' + String(Math.round(r * 10));
};
const frDate = (d: string) => d ? d.split('-').reverse().join('/') : '';
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ISO2: Record<string, string> = { france: 'FR', suisse: 'CH', switzerland: 'CH', belgique: 'BE', belgium: 'BE', espagne: 'ES', spain: 'ES', allemagne: 'DE', germany: 'DE', 'pays bas': 'NL', netherlands: 'NL', luxembourg: 'LU', italie: 'IT', italy: 'IT', 'royaume uni': 'GB', portugal: 'PT', canada: 'CA' };
const iso2 = (c: string) => { const k = norm(c || 'France'); return k.length === 2 ? k.toUpperCase() : (ISO2[k] || 'FR'); };

/** « 12/03/2027 • Bagnols-sur-Cèze (30) • LA MOBA » */
function describe(s: any) {
  const cp = s.department ? ` (${s.department})` : '';
  return [frDate(s.date), s.city ? s.city + cp : '', s.venue].filter(Boolean).join(' • ');
}

/** Produits Pennylane (Cession, Coréalisation, Commission) retrouvés par leur nom */
let PRODUCTS: any[] | null = null;
async function product(kind: 'cession' | 'corea' | 'coprod' | 'commission') {
  if (!PRODUCTS) { try { PRODUCTS = (await pl('GET', '/products?limit=100')).items || []; } catch { PRODUCTS = []; } }
  const want = kind === 'commission' ? /commission/i : kind === 'corea' ? /cor[ée]alisation/i : kind === 'coprod' ? /co-?production/i : /cession/i;
  return PRODUCTS.find((p: any) => want.test(p.label)) || (kind === 'coprod' ? PRODUCTS.find((p: any) => /cession/i.test(p.label)) : null);
}
const contractKind = (t: string) => /r[ée]alisation/i.test(t || '') ? 'corea' : /production/i.test(t || '') ? 'coprod' : 'cession';
const CONTRACT_LABEL: Record<string, string> = { cession: 'Cession', corea: 'Coréalisation', coprod: 'Coproduction' };

/** Modèles utilisés par les dernières factures / devis (mise en page, mentions, coordonnées bancaires) */
async function templates() {
  const out: { invoice?: number; quote?: number } = {};
  try { const i = (await pl('GET', '/customer_invoices?limit=5&sort=-id')).items || []; out.invoice = i.find((x: any) => x.customer_invoice_template?.id)?.customer_invoice_template.id; } catch (_) { /* */ }
  try { const q = (await pl('GET', '/quotes?limit=5&sort=-id')).items || []; out.quote = q.find((x: any) => x.quote_template?.id)?.quote_template.id; } catch (_) { /* */ }
  return out;
}

/** Client Pennylane d'une structure : déjà lié, sinon retrouvé par son nom parmi les clients existants, sinon créé */
async function customerFor(st: any): Promise<number> {
  if (st.pennylane_id) return Number(st.pennylane_id);
  const a = st.admin || {};
  const names = [a.legal_name, st.name].filter(Boolean).map(norm);
  let cursor = '', found: any = null;
  for (let i = 0; i < 20 && !found; i++) {
    const page = await pl('GET', '/customers?limit=100' + (cursor ? '&cursor=' + cursor : ''));
    found = (page.items || []).find((c: any) => names.includes(norm(c.name)) || c.external_reference === 'matrice-' + st.id);
    if (!page.has_more) break; cursor = page.next_cursor;
  }
  if (found) { await admin.from('structures').update({ pennylane_id: String(found.id) }).eq('id', st.id); return found.id; }
  const body: any = {
    name: a.legal_name || st.name, external_reference: 'matrice-' + st.id,
    billing_address: { address: a.address || st.address || '', postal_code: a.postal_code || st.postal_code || '', city: a.city || st.city || '', country_alpha2: iso2(a.country || st.country || 'France') },
  };
  const emails = [a.billing_email, a.email].filter(Boolean); if (emails.length) body.emails = emails;
  if (a.siret) body.reg_no = String(a.siret).replace(/\s/g, '');
  if (a.vat) body.vat_number = String(a.vat).replace(/\s/g, '');
  const c = await pl('POST', '/company_customers', body);
  await admin.from('structures').update({ pennylane_id: String(c.id) }).eq('id', st.id);
  return c.id;
}

/** Création avec les champs d'en-tête (Projet, Date de réalisation) ; si Pennylane les refuse, on crée sans et on le signale */
async function create(kind: 'quotes' | 'customer_invoices', body: any) {
  try { return { doc: await pl('POST', '/' + kind, body), headers: true }; }
  catch (e) {
    const msg = String(e);
    if (/custom_header|header_field/i.test(msg) || /400|422/.test(msg) && body.custom_header_fields) {
      const b = { ...body }; delete b.custom_header_fields;
      try { return { doc: await pl('POST', '/' + kind, b), headers: false }; } catch (e2) { throw e2; }
    }
    throw e;
  }
}
const linkOf = (o: any) => o?.public_file_url || null;

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
      const fee = Number(s.fee_ht) || 0;
      if (!fee) return json({ error: 'Le cachet HT de la date est vide' }, 400);
      const { data: st } = await admin.from('structures').select('*').eq('id', s.structure_id).single();
      const artist = s.projects?.name || '', k = contractKind(s.contract_type), prod = await product(k as any);
      const country = st?.admin?.country || st?.country || 'France';
      const [customer_id, tpl] = await Promise.all([customerFor(st), templates()]);
      const { doc: q, headers } = await create('quotes', {
        customer_id, date: today(), deadline: plusDays(30), external_reference: 'matrice-devis-' + s.id + '-' + Date.now(),
        pdf_invoice_subject: artist, pdf_description: describe(s),
        ...(tpl.quote ? { quote_template_id: tpl.quote } : {}),
        custom_header_fields: [{ title: 'Projet', value: artist }, { title: 'Date de réalisation', value: frDate(s.date) }],
        invoice_lines: [{ ...(prod ? { product_id: prod.id } : {}), label: prod?.label || 'Production de Spectacles • ' + CONTRACT_LABEL[k], quantity: 1, unit: 'no_unit',
          raw_currency_unit_price: money(fee), vat_rate: vatCode(s.vat_rate ?? 5.5, country) }],
      });
      return json({ ok: true, id: q.id, number: q.quote_number || null, url: linkOf(q), headers });
    }

    if (body.action === 'invoice') {
      const { data: p } = await admin.from('show_payments').select('*').eq('id', body.payment_id).single();
      if (!p) return json({ error: 'Ligne de facturation introuvable' }, 404);
      const { data: s } = await admin.from('shows').select('*, projects(*)').eq('id', p.show_id).single();
      const fee = Number(s.fee_ht) || 0, proj = s.projects || {}, artist = proj.name || '';
      let amount = p.amount != null ? Number(p.amount) : null;
      if (amount == null) {
        if (p.kind === 'artbo') amount = Math.round(fee * Number(p.pct ?? s.artbo_pct ?? 15)) / 100;
        else if (p.pct != null) amount = Math.round(fee * Number(p.pct)) / 100;
      }
      if (!amount) return json({ error: 'Montant de la ligne vide' }, 400);
      const tpl = await templates();
      const headerFields = [{ title: 'Projet', value: artist }, { title: 'Date de réalisation', value: frDate(s.date) }];
      let st: any, line: any, description: string;
      if (p.kind === 'artbo') {
        if (!proj.admin_structure_id) return json({ error: 'Indique la structure administrative de l’artiste dans sa fiche projet : c’est le client de la facture de commission' }, 400);
        st = (await admin.from('structures').select('*').eq('id', proj.admin_structure_id).single()).data;
        const prod = await product('commission');
        description = `Commission booking • ${frDate(s.date)} • ${s.city || s.venue || ''}`;
        line = { ...(prod ? { product_id: prod.id } : {}), label: prod?.label || 'Commission • Booking', quantity: 1, unit: 'no_unit', raw_currency_unit_price: money(amount),
          vat_rate: vatCode(p.vat_rate ?? 20, st?.admin?.country || st?.country || 'France'),
          description: `Commission booking pour ${artist} • Concert le ${frDate(s.date)} • ${[s.city, s.venue].filter(Boolean).join(' • ')}` };
      } else {
        if (!s.structure_id) return json({ error: 'La date n’a pas de structure (organisateur)' }, 400);
        st = (await admin.from('structures').select('*').eq('id', s.structure_id).single()).data;
        const k = contractKind(s.contract_type), prod = await product(k as any);
        description = describe(s);
        // comme dans Pennylane : le cachet entier en prix unitaire, la part facturée en quantité (0,5 = 50 %)
        const share = fee ? amount / fee : 0, clean = Math.abs(share * 10000 - Math.round(share * 10000)) < 1e-6;
        line = { ...(prod ? { product_id: prod.id } : {}), label: prod?.label || 'Production de Spectacles • ' + CONTRACT_LABEL[k], unit: 'no_unit',
          ...(fee && clean ? { quantity: Number(share.toFixed(4)), raw_currency_unit_price: money(fee) } : { quantity: 1, raw_currency_unit_price: money(amount) }),
          vat_rate: vatCode(p.vat_rate ?? s.vat_rate ?? 5.5, st?.admin?.country || st?.country || 'France'),
          ...(p.kind === 'acompte' ? { description: `Acompte${p.pct ? ' ' + p.pct + ' %' : ''}` } : p.kind === 'solde' ? { description: 'Solde' } : {}) };
      }
      const customer_id = await customerFor(st);
      const { doc: inv, headers } = await create('customer_invoices', {
        customer_id, date: today(), deadline: plusDays(14), draft: true, external_reference: 'matrice-' + p.id + '-' + Date.now(),
        pdf_invoice_subject: artist, pdf_description: description,
        ...(tpl.invoice ? { customer_invoice_template_id: tpl.invoice } : {}),
        custom_header_fields: headerFields, invoice_lines: [line],
      });
      return json({ ok: true, id: inv.id, number: inv.invoice_number || null, url: linkOf(inv), headers });
    }
    return json({ error: 'Action inconnue' }, 400);
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});
