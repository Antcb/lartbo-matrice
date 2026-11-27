// Pennylane (API v2) : crée les devis et les factures en BROUILLON à partir d'une date de la Matrice,
// au format des factures L'ArtBo déjà dans Pennylane :
//   Titre du document = l'artiste · Description = « 12/03/2027 • Bagnols-sur-Cèze (30) • LA MOBA »
//   En-tête : Projet = l'artiste, Date de réalisation = date du concert
//   Ligne : produit « Production de Spectacles • Cession / Coréalisation » (TVA 5,5 %), quantité = part du cachet (0,5 pour 50 %)
//   Commission : produit « Commission • Booking » (TVA 20 %), facturée à la structure administrative de l'artiste.
// Le jeton API est gardé côté serveur (Réglages › Pennylane). Appels depuis l'app (utilisateur connecté) :
//   { action: 'status' } · { action: 'quote', show_id } · { action: 'invoice', payment_id } · { action: 'sync' }
//   { action: 'lire_avoir', invoice_number? } (v1.69 : lecture seule du format réel d'un avoir)
//   { action: 'reemission', payment_id, invoice_number, motif? } (v1.71 : la ligne suit une facture réémise — option B, L2b)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { acomptesDeLaDate, baseCommission, describe, emise, estAvoir, factureIsolee, figerMontant, frDate, isBooking, montantAcompte, montantAttendu, origineAvoir, payable, pctCommission, planAvoir, planEncaissement, planRemboursement, rangeeDansLeDrive, remboursementsAutoActifs, relieAuDevis, soldeDouteux, texteCommission, delaiDocument } from './regles.ts';

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
// frDate, describe : regles.ts (v1.60.2, testés par tests/static/pennylane-regles.mjs)
// jour de Paris (CONVENTIONS §1.2, v1.49) : une facture faite entre 0 h et 2 h ne prend plus la date de la veille
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
// délais des NOUVEAUX documents (v1.64) : lus dans settings à chaque création ; illisible ou absent → 14 j / 30 j comme avant
async function delai(cle: 'pennylane_payment_days' | 'pennylane_quote_days') {
  const { data } = await admin.from('settings').select('value').eq('key', cle).maybeSingle();
  return delaiDocument(cle, data?.value);
}
const plusDays = (n: number) => { const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ISO2: Record<string, string> = { france: 'FR', suisse: 'CH', switzerland: 'CH', belgique: 'BE', belgium: 'BE', espagne: 'ES', spain: 'ES', allemagne: 'DE', germany: 'DE', 'pays bas': 'NL', netherlands: 'NL', luxembourg: 'LU', italie: 'IT', italy: 'IT', 'royaume uni': 'GB', portugal: 'PT', canada: 'CA' };
const iso2 = (c: string) => { const k = norm(c || 'France'); return k.length === 2 ? k.toUpperCase() : (ISO2[k] || 'FR'); };

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

    // (L1, v1.69) LECTURE SEULE du format réel d'un avoir dans l'API v2, avant tout import historique (demande d'Anthony du
    // 26/11/2026) : l'avoir (par son numéro, sinon le plus récent), sa facture d'origine et les virements rapprochés de celle-ci.
    // Aucune écriture, ni dans MATRICE ni dans Pennylane.
    if (body.action === 'lire_avoir') {
      const voulu = body.invoice_number ? norm(String(body.invoice_number)) : '';
      let cursor = '', avoir: any = null;
      for (let i = 0; i < 30 && !avoir; i++) {
        const page = await pl('GET', '/customer_invoices?limit=100&sort=-id' + (cursor ? '&cursor=' + cursor : ''));
        avoir = (page.items || []).find((x: any) => !x.draft && estAvoir(x) && (!voulu || norm(x.invoice_number || '') === voulu)) || null;
        if (!page.has_more) break; cursor = page.next_cursor;
      }
      if (!avoir) return json({ ok: true, avoir: null, message: 'Aucun avoir trouvé dans la liste des factures clients' });
      const origine = origineAvoir(avoir);
      let facture: any = null, virements: any = null, erreur: string | null = null;
      if (origine) {
        // message seul, jamais la pile d'appel (CodeQL, v1.69.1)
        const msg = (e: unknown) => e instanceof Error ? e.message : 'lecture impossible';
        try { facture = await pl('GET', `/customer_invoices/${origine}`); } catch (e) { erreur = 'facture d’origine : ' + msg(e); }
        try { virements = await pl('GET', `/customer_invoices/${origine}/matched_transactions`); } catch (e) { erreur = (erreur ? erreur + ' ; ' : '') + 'virements : ' + msg(e); }
      }
      let virementsAvoir: any = null;
      try { virementsAvoir = await pl('GET', `/customer_invoices/${avoir.id}/matched_transactions`); } catch (_) { /* */ }
      return json({ ok: true, origine_lue: origine, avoir, facture, virements, virementsAvoir, erreur });
    }

    // (v1.71, L2b, décision d'Anthony du 27/11/2026 — option B) FACTURE RÉÉMISE hors devis : la facture est LUE dans Pennylane (jamais
    // modifiée), puis la base enregistre le changement en une seule opération (facture_reemise_enregistrer) : la ligne suit la
    // réémission, l'ancienne facture reste visible, ses avoirs ne réduisent plus le net ; aucun encaissement créé ni touché.
    if (body.action === 'reemission') {
      const voulu = norm(String(body.invoice_number || ''));
      if (!voulu || !body.payment_id) return json({ error: 'Ligne et numéro de la facture réémise requis' }, 400);
      let cursor = '', x: any = null;
      for (let i = 0; i < 30 && !x; i++) {
        const page = await pl('GET', '/customer_invoices?limit=100&sort=-id' + (cursor ? '&cursor=' + cursor : ''));
        x = (page.items || []).find((d: any) => !d.draft && norm(d.invoice_number || '') === voulu) || null;
        if (!page.has_more) break; cursor = page.next_cursor;
      }
      if (!x) return json({ error: 'Facture introuvable dans Pennylane (finalisée, ce numéro)' }, 404);
      if (estAvoir(x)) return json({ error: 'Ce numéro est un avoir, pas une facture : rattache-le comme avoir' }, 400);
      if (x.status === 'cancelled') return json({ error: 'Facture annulée dans Pennylane : ce n’est pas une réémission' }, 400);
      const { data: me } = await user.auth.getUser();
      const { data, error } = await admin.rpc('facture_reemise_enregistrer', { p_payment: body.payment_id, p_pennylane_id: String(x.id), p_invoice_number: String(x.invoice_number),
        p_url: await invoicePage(x.id) || linkOf(x), p_amount_ht: Number(x.currency_amount_before_tax), p_motif: body.motif || null, p_auteur: me?.user?.email || null });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, remplacee: data, facture: { id: String(x.id), invoice_number: x.invoice_number, paid: x.paid === true, status: x.status } });
    }

    // Factures payées dans Pennylane → cochées « Payée » dans la Matrice (acomptes, soldes, autres lignes)
    if (body.action === 'sync') {
      const inv: Record<string, any> = {}, byId: Record<string, any> = {};
      let cursor = '', complet = false;   // complet : toute la liste lue (sinon aucun avoir n'est déclaré disparu)
      for (let i = 0; i < 30; i++) {
        const page = await pl('GET', '/customer_invoices?limit=100&sort=-id' + (cursor ? '&cursor=' + cursor : ''));
        for (const x of page.items || []) { if (x.draft) continue; byId[String(x.id)] = x; if (x.invoice_number) inv[norm(x.invoice_number)] = x; }
        if (!page.has_more) { complet = true; break; } cursor = page.next_cursor;
      }
      // factures créées depuis la Matrice : reconnues par leur identifiant Pennylane (le numéro n'est connu qu'une fois finalisées)
      // factures faites dans Pennylane depuis le devis créé par la Matrice (acompte puis solde) : reconnues par leur devis et leur montant HT
      const byQuote: Record<string, any[]> = {};
      for (const x of Object.values(byId)) if (x.quote?.id && x.status !== 'cancelled') (byQuote[String(x.quote.id)] ||= []).push(x);
      const linked: any[] = [], douteux: string[] = [], erreurs: string[] = [];
      let aRattacher = 0;   // erreurs : écritures refusées (jamais comptées comme faites)
      if (Object.keys(byQuote).length) {
        const open = (await readAll(() => admin.from('show_payments').select('id, show_id, kind, label, pct, amount, sort, invoice_number, pennylane_id, sent_at, paid_at, shows!inner(fee_ht, pennylane_quote_id, prod_mode)')
          .in('kind', ['acompte', 'solde']).is('invoice_number', null).is('pennylane_id', null).is('hors_calcul', null).not('shows.pennylane_quote_id', 'is', null)) || [])
          .filter((p: any) => relieAuDevis(p, p.shows?.prod_mode));   // booking : factures de l'artiste, jamais reliées (lot C1)
        // acomptes de ces dates (prévus et facturés) : le solde attendu = cession − acomptes de la date (décision du 10/11/2026)
        const ids = [...new Set(open.map((p: any) => p.show_id))];
        const acs = ids.length ? await readAll(() => admin.from('show_payments').select('show_id, kind, amount, pct, sent_at, paid_at, invoice_number, pennylane_id').in('kind', ['acompte', 'solde']).is('hors_calcul', null).in('show_id', ids)) : [];
        const facture: Record<string, number> = {};
        for (const id of ids) { const fee = Number((open.find((p: any) => p.show_id === id) as any)?.shows?.fee_ht) || 0; facture[id as string] = acomptesDeLaDate((acs || []).filter((a: any) => a.show_id === id), fee); }
        const taken = await readAll(() => admin.from('show_payments').select('id, pennylane_id, invoice_number').or('invoice_number.not.is.null,pennylane_id.not.is.null'));
        const used = new Set<string>(); for (const t of taken || []) { if (t.pennylane_id) used.add('id:' + t.pennylane_id); if (t.invoice_number) used.add('n:' + norm(t.invoice_number)); }
        // factures déjà choisies à la main (historique des rattachements) : plus jamais reliées automatiquement
        const manual = new Set(((await readAll(() => admin.from('pennylane_rattachements').select('id, pennylane_id'))) || []).map((r: any) => String(r.pennylane_id)));
        // (v1.71) factures d'origine remplacées par une réémission : plus jamais reliées automatiquement à une ligne
        for (const f of (await readAll(() => admin.from('factures_remplacees').select('id, pennylane_id').is('detache_at', null))) || []) manual.add(String(f.pennylane_id));
        const free = (c: any) => !used.has('id:' + c.id) && !(c.invoice_number && used.has('n:' + norm(c.invoice_number))) && !manual.has(String(c.id));
        const pending = new Map<string, { x: any; show_id: string; reason: string }>();
        const flag = (x: any, show_id: string, reason: string) => { if (!pending.has(String(x.id))) pending.set(String(x.id), { x, show_id, reason }); };
        // par date : une facture n'est reliée seule que si elle correspond à UNE seule ligne et que cette ligne n'a qu'UNE facture
        // possible (jamais sur le seul montant quand plusieurs correspondances existent — décision d'Anthony du 06/11/2026) ;
        // après chaque acompte relié (montant figé sur la facture), le solde attendu est recalculé (cession − acomptes) et on recommence
        const byShow: Record<string, any[]> = {};
        for (const p of open || []) (byShow[p.show_id] ||= []).push(p);
        for (const [sid, lines] of Object.entries(byShow)) {
          const sh = lines[0].shows, fee = Number(sh.fee_ht) || 0, acsDate = (acs || []).filter((a: any) => a.show_id === sid);
          const cands = (byQuote[String(sh.pennylane_quote_id)] || []).sort((a, b) => Number(a.id) - Number(b.id));
          let rest = [...lines];
          for (let round = 0; round < 6 && rest.length; round++) {
            const want = new Map(rest.map((p: any) => [p.id, montantAttendu(p, fee, facture[sid] || 0)]));
            const fits = (p: any, c: any) => { const w = want.get(p.id); return !!w && Math.abs(Number(c.currency_amount_before_tax) - w) < 0.05; };
            const pairs: [any, any][] = [];
            for (const p of rest) {
              const cs = cands.filter(c => free(c) && fits(p, c));
              if (cs.length !== 1) { if (cs.length > 1) cs.forEach(c => flag(c, sid, `Plusieurs factures du devis ont le montant attendu pour « ${p.label || p.kind} » : à choisir`)); continue; }
              const others = rest.filter((q: any) => q.id !== p.id && fits(q, cs[0]));
              if (others.length) { flag(cs[0], sid, `Le montant correspond à plusieurs lignes (${[p, ...others].map((q: any) => q.label || q.kind).join(', ')}) : à choisir`); continue; }
              pairs.push([p, cs[0]]);
            }
            if (!pairs.length) break;
            // un acompte à la fois (le solde dépend des acomptes facturés), sinon toutes les paires uniques du tour
            const step = pairs.some(([p]) => p.kind === 'acompte') ? [pairs.find(([p]) => p.kind === 'acompte')!] : pairs;
            for (const [p, x] of step) {
              rest = rest.filter((q: any) => q.id !== p.id);
              // (v1.61.1) plus d'acompte « caduc » : un acompte non facturé reste dû et se relie même si le solde est déjà facturé
              // facture qui peut être un acompte déjà noté à la main : jamais reliée au solde sans choix de l'utilisateur
              if (soldeDouteux(p, Number(x.currency_amount_before_tax), acsDate, fee)) { douteux.push(x.invoice_number || String(x.id)); flag(x, sid, 'Même montant qu’un acompte déjà noté à la main : est-ce cet acompte ou le solde ?'); continue; }
              // acompte / solde relié pas encore émis : montant figé sur celui de la facture (lots C1 et D1) ; déjà émis : inchangé (A1)
              const fige = figerMontant(p) ? { amount: Number(x.currency_amount_before_tax) } : {};
              const { data: done1, error: e1 } = await admin.from('show_payments').update({ pennylane_id: String(x.id), pennylane_url: await invoicePage(x.id) || linkOf(x), invoice_number: x.invoice_number || null, ...(x.date ? { invoiced_on: x.date } : {}), ...fige }).eq('id', p.id).is('pennylane_id', null).is('invoice_number', null).select('id');
              if (e1) { erreurs.push(`${x.invoice_number || x.id} : ${e1.message}`); continue; }   // refusée : ni reliée, ni comptée
              if (!done1?.length) continue;   // ligne prise entre-temps (rattachement manuel simultané) : rien de compté
              used.add('id:' + x.id); if (x.invoice_number) used.add('n:' + norm(x.invoice_number));
              // acompte déjà compté (prévu) : seul l'écart entre la facture et le montant prévu change le solde attendu
              if (p.kind === 'acompte' && 'amount' in fige) facture[sid] = (facture[sid] || 0) + Number((fige as any).amount) - (montantAcompte(p, fee) || 0);
              linked.push(x.invoice_number);
            }
          }
          // factures du devis restées sans ligne : signalées aussi (rien n'est relié sur un montant qui ne correspond à aucune ligne)
          for (const c of cands) if (free(c) && !c.credited_invoice && Number(c.currency_amount_before_tax) > 0 && !pending.has(String(c.id))) flag(c, sid, 'Aucune ligne d’acompte ou de solde de ce montant : à rattacher ou à vérifier');
        }
        // « à rattacher » : enregistrées pour l'action de l'onglet Factures (jamais un document Pennylane modifié) ;
        // une facture déjà traitée garde sa décision
        for (const { x, show_id, reason } of pending.values()) {
          const row = { pennylane_id: String(x.id), show_id, invoice_number: x.invoice_number || null, amount_ht: Number(x.currency_amount_before_tax),
            invoice_date: x.date || null, url: await invoicePage(x.id) || linkOf(x), reason, last_seen_at: new Date().toISOString() };
          const { error: e5 } = await admin.from('pennylane_a_rattacher').upsert(row, { onConflict: 'pennylane_id' });
          if (e5) erreurs.push(`${x.invoice_number || x.id} : signalement impossible (${e5.message})`);
        }
        aRattacher = pending.size;
      }
      // signalements à fermer (relecture v1.56.9, B1) : facture reliée depuis à une ligne (synchronisation ou rattachement), ou annulée
      // dans Pennylane — jamais laissés « à rattacher » à tort
      {
        const open2 = (await readAll(() => admin.from('pennylane_a_rattacher').select('id, pennylane_id').is('resolved_at', null))) || [];
        for (const r of open2) {
          const x = byId[String(r.pennylane_id)];
          const { data: line } = await admin.from('show_payments').select('id').eq('pennylane_id', String(r.pennylane_id)).limit(1).maybeSingle();
          if (line) await admin.from('pennylane_a_rattacher').update({ resolved_at: new Date().toISOString(), resolved_by: 'synchronisation', resolved_payment_id: line.id }).eq('id', r.id);
          else if (x?.status === 'cancelled') await admin.from('pennylane_a_rattacher').update({ resolved_at: new Date().toISOString(), resolved_by: 'annulée dans Pennylane', cancelled_at: new Date().toISOString() }).eq('id', r.id);
        }
      }
      // avoirs (L1, point 02, décisions d'Anthony du 26/11/2026) : importés sans doublon (clé = identifiant Pennylane de l'avoir),
      // rattachés à la ligne dont la facture d'ORIGINE a cet identifiant Pennylane ; sinon « À rattacher ». Aucun document Pennylane
      // modifié, aucun encaissement ni remboursement créé. Règles : regles.ts (planAvoir) ; application : js/calc.js (avoirsOf).
      const avoirs = { importes: 0, nouveaux: 0, rattaches: [] as string[], aRattacher: 0, disparus: 0, origineChangee: [] as string[] };
      {
        const vuLe = new Date().toISOString();
        const avoirsPl = Object.values(byId).filter(estAvoir);
        const deja = (await readAll(() => admin.from('pennylane_avoirs').select('id, pennylane_id, etat, payment_id, show_id, gone_at, rattache_origine, rattache_mode, reason'))) || [];
        const parId = new Map(deja.map((a: any) => [String(a.pennylane_id), a]));
        const origines = [...new Set(avoirsPl.map(origineAvoir).filter(Boolean))] as string[];
        const lignes: any[] = [];
        for (let i = 0; i < origines.length; i += 100) {
          const { data, error } = await admin.from('show_payments').select('id, show_id, pennylane_id, invoice_number').in('pennylane_id', origines.slice(i, i + 100));
          if (error) throw new Error('Lecture des factures d’origine des avoirs impossible : ' + error.message);
          lignes.push(...(data || []));
        }
        // (v1.71) factures remplacées par une réémission : une origine qui en est une concorde avec un rattachement manuel à leur ligne
        const remplacees = ((await readAll(() => admin.from('factures_remplacees').select('id, payment_id, pennylane_id').is('detache_at', null))) || [])
          .map((f: any) => ({ payment_id: String(f.payment_id), pennylane_id: String(f.pennylane_id) }));
        for (const x of avoirsPl) {
          const { nouveau_rattachement, origine_changee, ...rec } = planAvoir(x, parId.get(String(x.id)), lignes, vuLe, remplacees) as any;
          const { error: ea } = await admin.from('pennylane_avoirs').upsert({ ...rec, url: await invoicePage(x.id) || linkOf(x) }, { onConflict: 'pennylane_id' });
          if (ea) { erreurs.push(`Avoir ${x.invoice_number || x.id} : ${ea.message}`); continue; }
          avoirs.importes++; if (!parId.has(String(x.id))) avoirs.nouveaux++;
          if (nouveau_rattachement) avoirs.rattaches.push(x.invoice_number || String(x.id));
          if (rec.etat === 'a_rattacher') avoirs.aRattacher++;
          if (origine_changee) avoirs.origineChangee.push(x.invoice_number || String(x.id));
        }
        // avoir qui n'est plus dans Pennylane : gardé et marqué disparu (jamais effacé) — seulement si toute la liste a été lue
        if (complet) for (const a of deja) if (!a.gone_at && !byId[String(a.pennylane_id)]) {
          const { error: eg } = await admin.from('pennylane_avoirs').update({ gone_at: vuLe }).eq('id', a.id).is('gone_at', null);
          if (eg) erreurs.push(`Avoir ${a.pennylane_id} : ${eg.message}`); else avoirs.disparus++;
        }
      }
      // lignes couvertes par au moins un avoir : TTC de leurs avoirs (règle encaissementAvecAvoir, décision du 26/11/2026 17 h 21)
      const avoirsTtc = new Map<string, (number | null)[]>();
      // (v1.71) avoirs d'une facture remplacée par une réémission : visibles, mais ne réduisent plus le net de la ligne
      for (const a of (await readAll(() => admin.from('pennylane_avoirs').select('id, payment_id, amount_ttc').eq('etat', 'rattache').is('gone_at', null).eq('facture_remplacee', false))) || [])
        { const k = String(a.payment_id); avoirsTtc.set(k, [...(avoirsTtc.get(k) || []), a.amount_ttc == null ? null : Number(a.amount_ttc)]); }
      // virements déjà comptés pour une ligne : jamais comptés deux fois (pennylane_virements, migration v1.69)
      // virement → ligne pour laquelle il est compté (ou réservé). Réservé pour LA MÊME ligne (paiement pas écrit la fois précédente) :
      // réutilisable par elle à la reprise, jamais par une autre (demande d'Anthony du 26/11/2026, 17 h 42)
      const comptes = new Map<string, string>(((await readAll(() => admin.from('pennylane_virements').select('id, transaction_id, payment_id'))) || []).map((v: any) => [String(v.transaction_id), String(v.payment_id)]));
      // (v1.71, R3) virements groupés répartis à la main : jamais comptés par la synchronisation, pour aucune ligne
      const groupes = new Set<string>(((await readAll(() => admin.from('virements_groupes').select('id, transaction_id').not('transaction_id', 'is', null))) || []).map((v: any) => String(v.transaction_id)));
      const autresQue = (pid: string) => new Set([...[...comptes].filter(([, l]) => l !== pid).map(([t]) => t), ...groupes]);
      const payeesAvecAvoir: string[] = [], payeesSansTransaction: string[] = [], virementsPartiels: string[] = [], aVerifier: string[] = [];
      // paiements HISTORIQUES (notés avant L1, sans identifiant de virement) : avant de compter un virement pour une ligne, les virements
      // des lignes déjà PAYÉES de la même date (liées à Pennylane) sont relus et réservés pour elles (origine « historique ») ; une ligne
      // payée de la même date sans lien Pennylane (numéro seul) = doute : rien n'est noté, rapprochement à vérifier à la main
      const histoFait = new Set<string>(), doutesHisto = new Map<string, string[]>();
      const reserverHistorique = async (showId: string, sauf: string) => {
        if (histoFait.has(showId)) return; histoFait.add(showId);
        const payees = (pays || []).filter((q: any) => q.show_id === showId && q.id !== sauf && q.paid_at);
        doutesHisto.set(showId, payees.filter((q: any) => !q.pennylane_id && q.invoice_number).map((q: any) => `${q.label || q.kind} ${q.invoice_number}`));
        for (const q of payees.filter((q: any) => q.pennylane_id && ![...comptes.values()].includes(String(q.id)))) {
          let tv: any[] = [];
          try { tv = (await pl('GET', `/customer_invoices/${q.pennylane_id}/matched_transactions`)).items || []; }
          catch (e) { doutesHisto.get(showId)!.push(`${q.label || q.kind} ${q.invoice_number || ''} (virements illisibles)`); continue; }
          const rows = tv.filter((v: any) => (typeof v?.id === 'string' || typeof v?.id === 'number') && String(v.id).trim() && !comptes.has(String(v.id)) && !groupes.has(String(v.id)))
            .map((v: any) => ({ transaction_id: String(v.id), payment_id: q.id, pennylane_invoice_id: String(q.pennylane_id), origine: 'historique',
              amount: Number.isFinite(Number(v.amount)) ? Number(v.amount) : null, tx_date: v.date ? String(v.date).slice(0, 10) : null }));
          if (!rows.length) continue;
          const { error: eh } = await admin.from('pennylane_virements').upsert(rows, { onConflict: 'transaction_id', ignoreDuplicates: true });
          if (eh) { doutesHisto.get(showId)!.push(`${q.label || q.kind} ${q.invoice_number || ''} (virements non réservés : ${eh.message})`); continue; }
          rows.forEach(r => comptes.set(r.transaction_id, String(q.id)));
        }
      };
      // (L2a) mouvements déjà enregistrés par ligne ; avoirs rattachés (pour les remboursements)
      const reglementsParLigne = new Map<string, any[]>();
      for (const r of (await readAll(() => admin.from('reglements').select('*'))) || []) { const k = String(r.payment_id); reglementsParLigne.set(k, [...(reglementsParLigne.get(k) || []), r]); }
      const avoirsLignes = (await readAll(() => admin.from('pennylane_avoirs').select('id, pennylane_id, payment_id, show_id, invoice_number').eq('etat', 'rattache').is('gone_at', null))) || [];
      const encaissements: string[] = [], remboursements: string[] = [];
      /** virements réservés pour une ligne (avant toute écriture) ; erreur d'unicité = déjà comptés ailleurs */
      const reserver = async (ids: string[], pid: string, plId: string, vm: Map<string, any>) => {
        const nouveaux = ids.filter(id => comptes.get(id) !== pid);
        if (!nouveaux.length) return null;
        const { error } = await admin.from('pennylane_virements').insert(nouveaux.map(id => ({ transaction_id: id, payment_id: pid, pennylane_invoice_id: plId,
          amount: Number.isFinite(Number(vm.get(id)?.amount)) ? Number(vm.get(id)?.amount) : null, tx_date: vm.get(id)?.date ? String(vm.get(id).date).slice(0, 10) : null })));
        if (error) return error.code === '23505' ? 'virement déjà compté pour une autre ligne' : 'virement non mémorisé (' + error.message + ')';
        nouveaux.forEach(id => comptes.set(id, pid));
        return null;
      };
      /** réservations retirées si rien n'a pu être écrit (jamais une réservation « historique ») ; échec signalé : reprise au passage suivant */
      const rendre = async (ids: string[], pid: string, num: string) => {
        if (!ids.length) return;
        const { error: er } = await admin.from('pennylane_virements').delete().eq('payment_id', pid).in('transaction_id', ids).neq('origine', 'historique');
        if (er) erreurs.push(`${num} : réservation du virement non retirée (${er.message}) — reprise à la prochaine synchronisation`);
        else ids.forEach(id => { if (comptes.get(id) === pid) comptes.delete(id); });
      };
      const encaisserLigne = async (p: any, x: any, isPaid: boolean, where: string) => {
        const pid = String(p.id), num = p.invoice_number || x.invoice_number || '';
        const nom = `${p.label || p.kind} ${num} · ${where}`.replace(/\s+/g, ' ');
        const av = avoirsTtc.get(pid) || [], rs = reglementsParLigne.get(pid) || [];
        if (av.length && planEncaissement(x, av, [], new Set(), rs).signal === 'soldee') return;   // soldée par l'avoir : rien à encaisser
        let vs: any[] = [];
        try { const t = await pl('GET', `/customer_invoices/${x.id}/matched_transactions`); vs = t.items || []; }
        catch (e) { erreurs.push(`${num} : virements rapprochés illisibles, paiement non repris (${String(e).replace(/^Error: /, '')})`); return; }
        if (!vs.length && !rs.length) { if (isPaid) payeesSansTransaction.push(nom); return; }
        if (vs.length) await reserverHistorique(String(p.show_id), pid);
        const doute = doutesHisto.get(String(p.show_id)) || [];
        const plan = planEncaissement(x, av, vs, autresQue(pid), rs);
        if (plan.signal === 'a_verifier') { aVerifier.push(`${nom} : saisie manuelle non rapprochée et virement Pennylane de montant différent — rien de fait, rapprochement à vérifier`); return; }
        if (plan.signal === 'non_etabli') { if (vs.length) aVerifier.push(`${nom} : virement(s) plus grand(s) que le reste dû, ou montant non établi (virement groupé ?) — rien de noté ; à répartir à la main (« Virement groupé… » sous la facture), identifiant Pennylane : ${vs.map((v: any) => `${v.id} (${Number.isFinite(Number(v.amount)) ? money(Number(v.amount)) + ' €' : 'montant ?'}${v.date ? ' le ' + frDate(String(v.date).slice(0, 10)) : ''})`).join(', ')}`); return; }
        if (plan.signal === 'deja_compte') { (av.length ? payeesAvecAvoir : payeesSansTransaction).push(`${nom} : virement déjà compté pour une autre ligne`); return; }
        const agit = plan.creer.length || plan.rapprocher.length || plan.paid_at;
        if (!agit) { if (isPaid) (av.length ? payeesAvecAvoir : payeesSansTransaction).push(`${nom} : aucun virement établi`); return; }
        if (doute.length) { aVerifier.push(`${nom} : virement rapproché, mais paiement(s) noté(s) à la main sans lien Pennylane sur la même date (${doute.join(', ')}) — rien de noté, rapprochement à vérifier`); return; }
        const vm = new Map(vs.map((v: any) => [String(v.id), v]));
        const ids = [...plan.creer.map(c => c.transaction_id), ...plan.rapprocher.map(r => r.transaction_id)];
        const err = await reserver(ids, pid, String(x.id), vm);
        if (err) { (av.length ? payeesAvecAvoir : payeesSansTransaction).push(`${nom} : ${err} — rien de noté`); return; }
        // mouvements : saisies manuelles rapprochées (jamais dupliquées), virements nouveaux créés
        for (const r of plan.rapprocher) {
          const { data: up, error: e5 } = await admin.from('reglements').update({ transaction_id: r.transaction_id, rapproche_at: new Date().toISOString() })
            .eq('id', r.reglement_id).is('transaction_id', null).is('annule_at', null).select('id');
          if (e5 || !up?.length) { await rendre(ids, pid, num); erreurs.push(`${num} : rapprochement d'une saisie manuelle impossible (${e5?.message || 'saisie modifiée entre-temps'}) — rien de noté`); return; }
        }
        if (plan.creer.length) {
          const { error: e6 } = await admin.from('reglements').insert(plan.creer.map(c => ({ payment_id: p.id, show_id: p.show_id, sens: 'encaissement', etat: 'fait',
            montant_ttc: c.montant, date: c.date, compte: p.payee || null, source: 'pennylane', transaction_id: c.transaction_id, rapproche_at: new Date().toISOString(), created_by: 'synchronisation Pennylane' })));
          if (e6) { await rendre(plan.creer.map(c => c.transaction_id), pid, num); erreurs.push(`${num} : encaissement non enregistré (${e6.message})`); return; }
          encaissements.push(`${nom} : ${plan.creer.map(c => `${money(c.montant)} € TTC le ${frDate(c.date)}`).join(', ')}`);
        }
        if (plan.rapprocher.length) encaissements.push(`${nom} : ${plan.rapprocher.length} saisie(s) manuelle(s) rapprochée(s) de Pennylane (pas de doublon)`);
        if (!plan.paid_at) { if (plan.creer.length) virementsPartiels.push(`${nom} : ${money(plan.encaisse)} € TTC encaissés sur ${money(plan.reste ?? 0)} € TTC dus — encaissement partiel enregistré`); return; }
        const { data: up, error: e3 } = await admin.from('show_payments').update({ paid_at: plan.paid_at }).eq('id', p.id).is('paid_at', null).select('id');
        if (e3) { erreurs.push(`${num} : encaissements enregistrés, mais date « Payée » non notée (${e3.message})`); return; }
        if (up?.length) updated.push({ id: p.id, paid_at: plan.paid_at, label: `${p.label || p.kind} ${num} · ${where}` });
      };
      const { data: rembCfg } = await admin.from('settings').select('value').eq('key', 'pennylane_remboursements_auto').maybeSingle();
      const rembAuto = remboursementsAutoActifs(rembCfg?.value);
      const rembourserAvoir = async (a: any) => {
        const pid = String(a.payment_id), rs = reglementsParLigne.get(pid) || [];
        let vs: any[] = [];
        try { vs = (await pl('GET', `/customer_invoices/${a.pennylane_id}/matched_transactions`)).items || []; }
        catch (e) { erreurs.push(`Avoir ${a.invoice_number || a.pennylane_id} : virements illisibles (${String(e).replace(/^Error: /, '')})`); return; }
        const plan = planRemboursement(vs, autresQue(pid), rs);
        // format réel des remboursements non confirmé → rien n'est enregistré ni réservé, seulement signalé
        if (!rembAuto) { if (plan.creer.length || plan.rapprocher.length || plan.signal) aVerifier.push(`Avoir ${a.invoice_number || a.pennylane_id} : virement sortant rapproché — remboursement NON enregistré (remboursements automatiques désactivés tant que le format Pennylane n’est pas confirmé) ; à saisir à la main si besoin`); return; }
        if (plan.signal === 'a_verifier') { aVerifier.push(`Avoir ${a.invoice_number || a.pennylane_id} : remboursement saisi à la main et virement Pennylane de montant différent — rien de fait, à vérifier`); return; }
        if (!plan.creer.length && !plan.rapprocher.length) return;
        const vm = new Map(vs.map((v: any) => [String(v.id), v]));
        const ids = [...plan.creer.map(c => c.transaction_id), ...plan.rapprocher.map(r => r.transaction_id)];
        const err = await reserver(ids, pid, String(a.pennylane_id), vm);
        if (err) { aVerifier.push(`Avoir ${a.invoice_number || a.pennylane_id} : ${err} — rien de noté`); return; }
        for (const r of plan.rapprocher) {
          const { data: up, error: e7 } = await admin.from('reglements').update({ transaction_id: r.transaction_id, rapproche_at: new Date().toISOString(), ...(r.a_faire ? { etat: 'fait', date: r.date } : {}) })
            .eq('id', r.reglement_id).is('transaction_id', null).is('annule_at', null).select('id');
          if (e7 || !up?.length) { await rendre(ids, pid, a.invoice_number || ''); erreurs.push(`Avoir ${a.invoice_number || a.pennylane_id} : rapprochement du remboursement impossible (${e7?.message || 'saisie modifiée entre-temps'})`); return; }
        }
        if (plan.creer.length) {
          const { error: e8 } = await admin.from('reglements').insert(plan.creer.map(c => ({ payment_id: a.payment_id, show_id: a.show_id,
            sens: 'remboursement', etat: 'fait', montant_ttc: c.montant, date: c.date, source: 'pennylane', transaction_id: c.transaction_id, avoir_id: a.id, rapproche_at: new Date().toISOString(), created_by: 'synchronisation Pennylane' })));
          if (e8) { await rendre(plan.creer.map(c => c.transaction_id), pid, a.invoice_number || ''); erreurs.push(`Avoir ${a.invoice_number || a.pennylane_id} : remboursement non enregistré (${e8.message})`); return; }
        }
        remboursements.push(`Avoir ${a.invoice_number || a.pennylane_id} : ${[...plan.creer.map(c => `${money(c.montant)} € TTC le ${frDate(c.date)}`), ...plan.rapprocher.map(r => `remboursement ${r.a_faire ? 'à faire, maintenant fait' : 'saisi à la main, rapproché'}`)].join(', ')}`);
      };
      // paiements repris : acomptes / soldes / autres lignes de PRODUCTION, et factures de commission BOOKING (lot C1) ;
      // jamais les factures de l'artiste en booking, ni la commission de production (pas une facture)
      const pays = ((await readAll(() => admin.from('show_payments').select('id, show_id, kind, label, invoice_number, pennylane_id, paid_at, payee, drive_file_id, shows(date, city, venue, drive_folder_id, prod_mode)')
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
        // (L1 v1.69, L2a v1.70) ligne sans date de paiement : encaissements d'après les virements rapprochés dans Pennylane, un par
        // mouvement (reglements) ; jamais « paid = true » ni un avoir comme preuve ; une saisie manuelle n'est jamais dupliquée (R1) ;
        // paiement existant (historique) jamais touché (E1). Règle : regles.ts planEncaissement.
        if (!p.paid_at && x.status !== 'cancelled') { await encaisserLigne(p, x, isPaid, where); continue; }
        if (!isPaid && p.paid_at && x.status !== 'cancelled') {
          pennylaneLate.push(`${p.invoice_number} · ${where} (payée le ${frDate(p.paid_at)} dans la Matrice)`);
        }
      }
      // (L2a) remboursements d'après les virements SORTANTS rapprochés des avoirs rattachés (regles.ts planRemboursement)
      for (const a of avoirsLignes) await rembourserAvoir(a);
      const filed = await fileInvoices(toFile);
      return json({ ok: true, updated, pennylaneLate, linked, douteux, aRattacher, erreurs, filed, avoirs, payeesAvecAvoir, payeesSansTransaction, virementsPartiels, aVerifier, encaissements, remboursements });
    }

    if (body.action === 'quote') {
      const { data: s } = await admin.from('shows').select('*, projects(name)').eq('id', body.show_id).single();
      if (!s) return json({ error: 'Date introuvable' }, 404);
      if (isBooking(s.prod_mode)) return json({ error: 'Date en booking : pas de devis de cession (L’ArtBo ne facture que sa commission à l’artiste)' }, 400);
      // coproduction : jamais de devis tant que le résultat n'est pas connu (décision d'Anthony du 27/10/2026, v1.51)
      if (s.contract_type === 'Co-Production') return json({ error: 'Coproduction : pas de devis Pennylane (le résultat n’est pas connu) ; les factures se préparent après la clôture du résultat' }, 400);
      if (!s.structure_id) return json({ error: 'La date n’a pas de structure (organisateur) : impossible de choisir le client' }, 400);
      const fee = Number(s.fee_ht) || 0;
      if (!fee) return json({ error: 'Le cachet HT de la date est vide' }, 400);
      const { data: st } = await admin.from('structures').select('*').eq('id', s.structure_id).single();
      const artist = s.projects?.name || '', k = contractKind(s.contract_type), prod = await product(k as any);
      const country = st?.admin?.country || st?.country || 'France';
      const [customer_id, tpl] = await Promise.all([customerFor(st), templates()]);
      const { doc: q, headers } = await create('quotes', {
        customer_id, date: today(), deadline: plusDays(await delai('pennylane_quote_days')), external_reference: 'matrice-devis-' + s.id + '-' + Date.now(),
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
      // facture déjà émise (numéro, envoi, paiement ou lien Pennylane — même définition que l'application) : jamais de second brouillon
      if (emise(p)) return json({ error: 'Cette ligne a déjà une facture (numéro, envoi ou paiement noté) : aucun nouveau brouillon n’est créé dans Pennylane' }, 400);
      const { data: s } = await admin.from('shows').select('*, projects(*)').eq('id', p.show_id).single();
      if (!s) return json({ error: 'Date introuvable' }, 404);
      // booking : seulement la commission de L'ArtBo ; production : jamais la commission (pas une facture) — acompte / solde : depuis le devis
      if (!factureIsolee(p, s.prod_mode) && (isBooking(s.prod_mode) || !['acompte', 'solde'].includes(p.kind)))
        return json({ error: isBooking(s.prod_mode) ? 'Date en booking : seule la facture de commission de L’ArtBo se crée ici' : p.kind === 'artbo' ? 'En production, la commission de L’ArtBo n’est pas une facture : note seulement sa date de versement' : 'Cette ligne ne se facture pas depuis la Matrice' }, 400);
      const fee = Number(s.fee_ht) || 0, proj = s.projects || {}, artist = proj.name || '';
      let amount = p.amount != null ? Number(p.amount) : null;
      if (amount == null) {
        if (p.kind === 'artbo') {
          // % de la ligne > % de la date > % de l'artiste > Réglages selon le mode de la date (§6.3, v1.46 : plus de 15 en dur)
          const { data: defaut, error: eDef } = await admin.rpc('default_commission_pct', { p_show: s.id, p_mode: s.prod_mode });
          if (eDef) return json({ error: 'Commission par défaut illisible : ' + eDef.message }, 500);
          const pct = pctCommission(p.pct, s.artbo_pct, defaut);
          if (pct != null) amount = Math.round(baseCommission(s) * pct) / 100;   // coréalisation : MG + part validée (v1.51)
        }
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
        // lieu réel et code du lieu (v1.60.2) : même format que les devis et factures de cession (describe) ; nouvelles factures seulement
        const txt = texteCommission(s, artist);
        description = txt.description;
        line = { ...(prod ? { product_id: prod.id } : {}), label: prod?.label || 'Commission • Booking', quantity: 1, unit: 'no_unit', raw_currency_unit_price: money(amount),
          vat_rate: vatCode(p.vat_rate ?? 20, st?.admin?.country || st?.country || 'France'),
          description: txt.ligne };
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
        customer_id, date: today(), deadline: plusDays(await delai('pennylane_payment_days')), draft: true, external_reference: 'matrice-' + p.id + '-' + Date.now(),
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
