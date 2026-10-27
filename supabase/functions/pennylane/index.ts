// Pennylane (API v2) : crée les devis et les factures en BROUILLON à partir d'une date de la Matrice,
// au format des factures L'ArtBo déjà dans Pennylane :
//   Titre du document = l'artiste · Description = « 12/03/2027 • Bagnols-sur-Cèze (30) • LA MOBA »
//   En-tête : Projet = l'artiste, Date de réalisation = date du concert
//   Ligne : produit « Production de Spectacles • Cession / Coréalisation » (TVA 5,5 %), quantité = part du cachet (0,5 pour 50 %)
//   Commission : produit « Commission • Booking » (TVA 20 %), facturée à la structure administrative de l'artiste.
// Le jeton API est gardé côté serveur (Réglages › Pennylane). Appels depuis l'app (utilisateur connecté) :
//   { action: 'status' } · { action: 'quote', show_id } · { action: 'invoice', payment_id } · { action: 'sync' }
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { acomptesFactures, caduc, factureIsolee, figerMontant, isBooking, montantAcompte, montantAttendu, payable, rangeeDansLeDrive, relieAuDevis } from './regles.ts';

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
  const list: any[] = PRODUCTS || [];   // typage strict (deno check) : même comportement
  return list.find((p: any) => want.test(p.label)) || (kind === 'coprod' ? list.find((p: any) => /cession/i.test(p.label)) : null);
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
/** Pages de l'application Pennylane (et pas le PDF) : devis et factures s'ouvrent directement, prêts à être modifiés */
let COMPANY: string | null = null;
async function company() { if (!COMPANY) { try { const me = await pl('GET', '/me'); COMPANY = me?.company?.id ? String(me.company.id) : null; } catch (_) { /* */ } } return COMPANY; }
const quotePage = async (id: any) => { const c = await company(); return c ? `https://app.pennylane.com/companies/${c}/clients/customer_estimates?estimate_id=${id}` : null; };
const invoicePage = async (id: any) => { const c = await company(); return c ? `https://app.pennylane.com/companies/${c}/clients/customer_invoices?invoice_id=${id}&subtab=all` : null; };
/** Toutes les lignes d'une requête, page par page (Supabase rend 1 000 lignes au plus par lecture) */
async function readAll(make: () => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || [])); if (!data || data.length < 1000) return out;
  }
}

/**
 * Factures reconnues par la synchronisation : PDF rangé dans le Drive par le script Google
 * (compta « D - Factures de ventes / AAAA-MM » et 02_Finance de la date), nommé « F-AB-2026-10-105 KOLYBREE Acompte.pdf ».
 * Quelques factures par passage (le reste au suivant) ; une facture déjà rangée à la main n'est pas ajoutée deux fois.
 */
const KIND_LABEL: Record<string, string> = { acompte: 'Acompte', solde: 'Solde' };
async function fileInvoices(list: { p: any; x: any }[]) {
  if (!list.length) return { done: [], errors: [] as string[], left: 0 };
  const { data: st } = await admin.from('settings').select('key, value').in('key', ['drive_webhook_url', 'drive_webhook_secret']);
  const set: Record<string, string> = {}; for (const r of st || []) set[r.key] = typeof r.value === 'string' ? r.value : String(r.value ?? '');
  if (!set.drive_webhook_url) return { done: [], errors: [], left: list.length };
  const done: string[] = [], errors: string[] = [], started = Date.now();
  let i = 0;
  // d'abord les factures jamais rangées
  list.sort((a, b) => (a.p.drive_file_id ? 1 : 0) - (b.p.drive_file_id ? 1 : 0));
  for (; i < list.length && i < 10 && Date.now() - started < 60000; i++) {
    const { p, x } = list[i];
    const client = String(x.label || '').replace(/^(Facture|Avoir)\s+/i, '').replace(new RegExp('\\s*-\\s*' + x.invoice_number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '').trim();
    const what = x.credited_invoice ? 'Avoir' : KIND_LABEL[p.kind] || String(p.label || '').trim();
    const name = [x.invoice_number, client, what].filter(Boolean).join(' ') + '.pdf';
    try {
      const r = await fetch(set.drive_webhook_url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: set.drive_webhook_secret, action: 'file_invoice', number: x.invoice_number, name, url: x.public_file_url, date: x.date, folder_id: p.shows?.drive_folder_id || null }) });
      const out = await r.json().catch(() => ({ ok: false, error: 'réponse illisible du script Google' }));
      if (!out.ok) { errors.push(`${x.invoice_number} : ${/Action inconnue/i.test(out.error || '') ? 'script Google pas à jour (Réglages › Google)' : out.error}`); if (/Action inconnue/i.test(out.error || '')) break; continue; }
      // rangée partout où il faut ? sinon on réessaiera au prochain passage
      const inDate = (out.files || []).find((y: any) => y.where === 'date'), inCompta = (out.files || []).find((y: any) => y.where === 'compta');
      if (out.date_error) errors.push(`${x.invoice_number} : dossier de la date inaccessible (${String(out.date_error).replace(/^(Exception|Error): /, '')})`);
      const mark = inDate?.id && inCompta?.id ? inDate.id : !p.shows?.drive_folder_id && inCompta?.id ? 'compta:' + inCompta.id : null;
      if (mark) { const { error: e4 } = await admin.from('show_payments').update({ drive_file_id: mark }).eq('id', p.id); if (e4) errors.push(`${x.invoice_number} : rangée, mais non notée dans la Matrice (${e4.message})`); }
      if ((out.files || []).some((y: any) => !y.existed)) done.push(name.replace(/\.pdf$/, ''));
    } catch (e) { errors.push(`${x.invoice_number} : ${String(e).replace(/^Error: /, '')}`); }
  }
  return { done, errors, left: list.length - i };
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

    // Factures payées dans Pennylane → cochées « Payée » dans la Matrice (acomptes, soldes, autres lignes)
    if (body.action === 'sync') {
      const inv: Record<string, any> = {}, byId: Record<string, any> = {};
      let cursor = '';
      for (let i = 0; i < 30; i++) {
        const page = await pl('GET', '/customer_invoices?limit=100&sort=-id' + (cursor ? '&cursor=' + cursor : ''));
        for (const x of page.items || []) { if (x.draft) continue; byId[String(x.id)] = x; if (x.invoice_number) inv[norm(x.invoice_number)] = x; }
        if (!page.has_more) break; cursor = page.next_cursor;
      }
      // factures créées depuis la Matrice : reconnues par leur identifiant Pennylane (le numéro n'est connu qu'une fois finalisées)
      // factures faites dans Pennylane depuis le devis créé par la Matrice (acompte puis solde) : reconnues par leur devis et leur montant HT
      const byQuote: Record<string, any[]> = {};
      for (const x of Object.values(byId)) if (x.quote?.id && x.status !== 'cancelled') (byQuote[String(x.quote.id)] ||= []).push(x);
      const linked: any[] = [], caducs: string[] = [], erreurs: string[] = [];   // erreurs : écritures refusées (jamais comptées comme faites)
      if (Object.keys(byQuote).length) {
        const open = (await readAll(() => admin.from('show_payments').select('id, show_id, kind, pct, amount, sort, invoice_number, pennylane_id, sent_at, paid_at, shows!inner(fee_ht, pennylane_quote_id, prod_mode)')
          .in('kind', ['acompte', 'solde']).is('invoice_number', null).is('pennylane_id', null).is('hors_calcul', null).not('shows.pennylane_quote_id', 'is', null)) || [])
          .filter((p: any) => relieAuDevis(p, p.shows?.prod_mode));   // booking : factures de l'artiste, jamais reliées (lot C1)
        // acomptes déjà facturés de ces dates : le solde attendu = cession − acomptes facturés (comme Pennylane)
        const ids = [...new Set(open.map((p: any) => p.show_id))];
        const acs = ids.length ? await readAll(() => admin.from('show_payments').select('show_id, kind, amount, pct, sent_at, paid_at, invoice_number, pennylane_id').in('kind', ['acompte', 'solde']).is('hors_calcul', null).in('show_id', ids)) : [];
        const facture: Record<string, number> = {};
        for (const id of ids) { const fee = Number((open.find((p: any) => p.show_id === id) as any)?.shows?.fee_ht) || 0; facture[id as string] = acomptesFactures((acs || []).filter((a: any) => a.show_id === id), fee); }
        const taken = await readAll(() => admin.from('show_payments').select('id, pennylane_id, invoice_number').or('invoice_number.not.is.null,pennylane_id.not.is.null'));
        const used = new Set<string>(); for (const t of taken || []) { if (t.pennylane_id) used.add('id:' + t.pennylane_id); if (t.invoice_number) used.add('n:' + norm(t.invoice_number)); }
        const order = (a: any, b: any) => (a.kind === b.kind ? (a.sort || 0) - (b.sort || 0) : a.kind === 'acompte' ? -1 : 1);
        for (const p of (open || []).sort(order)) {
          const sh = (p as any).shows, fee = Number(sh.fee_ht) || 0;
          const want = montantAttendu(p, fee, facture[p.show_id] || 0); if (!want) continue;
          const cands = (byQuote[String(sh.pennylane_quote_id)] || []).sort((a, b) => Number(a.id) - Number(b.id));
          const x = cands.find(c => !used.has('id:' + c.id) && !(c.invoice_number && used.has('n:' + norm(c.invoice_number))) && Math.abs(Number(c.currency_amount_before_tax) - want) < 0.05);
          if (!x) continue;
          // acompte caduc (solde déjà facturé) : une facture Pennylane lui correspond, mais il n'est jamais relié automatiquement
          // (la date serait facturée au-delà de sa cession) — signalé dans le rapport, à examiner (relecture C1, B3)
          if (caduc(p, (acs || []).filter((a: any) => a.show_id === p.show_id))) { caducs.push(x.invoice_number || String(x.id)); continue; }
          // acompte / solde relié pas encore émis : son montant est figé sur celui de la facture Pennylane (plus jamais recalculé,
          // lots C1 et D1 — le montant réel de la facture fait référence) ;
          // déjà émis (ex. marqué envoyé) : montant inchangé (protection A1) — seuls le numéro et le lien sont repris
          const fige = figerMontant(p) ? { amount: Number(x.currency_amount_before_tax) } : {};
          const { error: e1 } = await admin.from('show_payments').update({ pennylane_id: String(x.id), pennylane_url: await invoicePage(x.id) || linkOf(x), invoice_number: x.invoice_number || null, ...fige }).eq('id', p.id);
          if (e1) { erreurs.push(`${x.invoice_number || x.id} : ${e1.message}`); continue; }   // refusée : ni reliée, ni comptée
          used.add('id:' + x.id); if (x.invoice_number) used.add('n:' + norm(x.invoice_number));
          // compte pour le solde suivant : le montant réel de la facture quand l'acompte vient d'être figé dessus (lot D1)
          if (p.kind === 'acompte') facture[p.show_id] = (facture[p.show_id] || 0) + ('amount' in fige ? Number((fige as any).amount) : (montantAcompte(p, fee) || 0));
          linked.push(x.invoice_number);
        }
      }
      // paiements repris : acomptes / soldes / autres lignes de PRODUCTION, et factures de commission BOOKING (lot C1) ;
      // jamais les factures de l'artiste en booking, ni la commission de production (pas une facture)
      const pays = ((await readAll(() => admin.from('show_payments').select('id, show_id, kind, label, invoice_number, pennylane_id, paid_at, drive_file_id, shows(date, city, venue, drive_folder_id, prod_mode)')
        .in('kind', ['acompte', 'solde', 'autre', 'artbo']).is('hors_calcul', null).or('invoice_number.not.is.null,pennylane_id.not.is.null'))) || [])
        .filter((p: any) => payable(p, p.shows?.prod_mode));
      const updated: any[] = [], pennylaneLate: any[] = [], toFile: { p: any; x: any }[] = [];
      for (const p of pays || []) {
        const x = (p.pennylane_id && byId[String(p.pennylane_id)]) || (p.invoice_number && inv[norm(p.invoice_number)]); if (!x) continue;
        // numéro et lien vers la page de la facture dans Pennylane, s'ils manquent
        if ((!p.invoice_number && x.invoice_number) || !p.pennylane_id) {
          const { error: e2 } = await admin.from('show_payments').update({ invoice_number: p.invoice_number || x.invoice_number || null, pennylane_id: String(x.id), pennylane_url: await invoicePage(x.id) || linkOf(x) }).eq('id', p.id);
          if (e2) { erreurs.push(`${p.invoice_number || x.invoice_number || x.id} : ${e2.message}`); continue; }
        }
        p.invoice_number = p.invoice_number || x.invoice_number || '';
        // à ranger : jamais rangée, ou rangée seulement en compta alors que la date a maintenant un dossier
        const filedAll = p.drive_file_id && !(String(p.drive_file_id).startsWith('compta:') && p.shows?.drive_folder_id);
        // commission booking (reprise du paiement, lot C1) : PAS de rangement automatique dans le Drive — non demandé, à décider à part
        if (!filedAll && rangeeDansLeDrive(p) && x.invoice_number && x.public_file_url && x.status !== 'cancelled') toFile.push({ p, x });
        const where = `${frDate((p as any).shows?.date)} ${(p as any).shows?.city || ''}`.trim();
        const isPaid = x.paid === true && x.status !== 'cancelled';
        if (isPaid && !p.paid_at) {
          let date = '';
          try { const t = await pl('GET', `/customer_invoices/${x.id}/matched_transactions`); date = (t.items || []).map((y: any) => y.date).filter(Boolean).sort().pop() || ''; } catch (_) { /* */ }
          date = date ? String(date).slice(0, 10) : today();
          const { error: e3 } = await admin.from('show_payments').update({ paid_at: date }).eq('id', p.id);
          if (e3) { erreurs.push(`${p.invoice_number} : ${e3.message}`); continue; }
          updated.push({ id: p.id, paid_at: date, label: `${p.label || p.kind} ${p.invoice_number} · ${where}` });
        } else if (!isPaid && p.paid_at && x.status !== 'cancelled') {
          pennylaneLate.push(`${p.invoice_number} · ${where} (payée le ${frDate(p.paid_at)} dans la Matrice)`);
        }
      }
      const filed = await fileInvoices(toFile);
      return json({ ok: true, updated, pennylaneLate, linked, caducs, erreurs, filed });
    }

    if (body.action === 'quote') {
      const { data: s } = await admin.from('shows').select('*, projects(name)').eq('id', body.show_id).single();
      if (!s) return json({ error: 'Date introuvable' }, 404);
      if (isBooking(s.prod_mode)) return json({ error: 'Date en booking : pas de devis de cession (L’ArtBo ne facture que sa commission à l’artiste)' }, 400);
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
      return json({ ok: true, id: q.id, number: q.quote_number || null, url: await quotePage(q.id) || linkOf(q), headers });
    }

    if (body.action === 'invoice') {
      const { data: p } = await admin.from('show_payments').select('*').eq('id', body.payment_id).single();
      if (!p) return json({ error: 'Ligne de facturation introuvable' }, 404);
      // ligne hors calcul (coproduction, import — v1.44) : jamais facturée
      if (p.hors_calcul) return json({ error: 'Ligne hors calcul (gardée pour la traçabilité) : elle ne se facture pas' }, 400);
      const { data: s } = await admin.from('shows').select('*, projects(*)').eq('id', p.show_id).single();
      if (!s) return json({ error: 'Date introuvable' }, 404);
      // booking : seulement la commission de L'ArtBo ; production : jamais la commission (pas une facture) — acompte / solde : depuis le devis
      if (!factureIsolee(p, s.prod_mode) && (isBooking(s.prod_mode) || !['acompte', 'solde'].includes(p.kind)))
        return json({ error: isBooking(s.prod_mode) ? 'Date en booking : seule la facture de commission de L’ArtBo se crée ici' : p.kind === 'artbo' ? 'En production, la commission de L’ArtBo n’est pas une facture : note seulement sa date de versement' : 'Cette ligne ne se facture pas depuis la Matrice' }, 400);
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
      } else if (p.kind === 'acompte' || p.kind === 'solde') {
        // comme dans Pennylane : acompte et solde se font depuis le devis (le solde déduit l'acompte), pas en facture isolée
        return json({ error: 'L’acompte et le solde se facturent depuis le devis Pennylane (bouton « Facturer depuis le devis »)' }, 400);
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
          ...(p.kind === 'acompte' ? { description: `Acompte${p.pct ? ' ' + Number(p.pct).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %' : ''}` } : p.kind === 'solde' ? { description: 'Solde' } : {}) };
      }
      const customer_id = await customerFor(st);
      const { doc: inv, headers } = await create('customer_invoices', {
        customer_id, date: today(), deadline: plusDays(14), draft: true, external_reference: 'matrice-' + p.id + '-' + Date.now(),
        pdf_invoice_subject: artist, pdf_description: description,
        ...(tpl.invoice ? { customer_invoice_template_id: tpl.invoice } : {}),
        custom_header_fields: headerFields, invoice_lines: [line],
      });
      return json({ ok: true, id: inv.id, number: inv.invoice_number || null, url: await invoicePage(inv.id) || linkOf(inv), headers });
    }
    return json({ error: 'Action inconnue' }, 400);
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});
