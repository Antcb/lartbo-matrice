// Rejoue la synchronisation Pennylane (action « sync ») de la fonction edge sur le cas Brise Glace, données FICTIVES, faux Pennylane.
// AUCUN accès à Pennylane ni à Supabase : faux Pennylane (fetch) et faux client Supabase en mémoire (faux-supabase.mjs).
// Usage (depuis ce dossier) : node --experimental-strip-types --no-warnings --import ./enregistrer.mjs rejeu.mjs <dossier de la fonction> <scénario>
//   fonction actuelle : ../../../supabase/functions/pennylane
//   fonction du 06/11 (v1.51.0) : mkdir -p /tmp/pl-ancien && for f in index.ts regles.ts; do git show 2cbd65e:supabase/functions/pennylane/$f > /tmp/pl-ancien/$f; done
// Scénarios : 06-11-sans-libelle, 06-11-libelle-acompte, 06-11-acompte-envoye-sans-numero, etat-actuel, apres-correction,
//             apres-correction-vraie-facture-solde
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [, , dossier, scenario] = process.argv;
const version = dossier;
const DB = globalThis.__DB = { show_payments: [], shows: [], pennylane_rattachements: [], pennylane_a_rattacher: [], settings: [] };
const SHOW = 'b021e7d4-0000-4000-a000-000000000001', AC = 'd83eda31-0000-4000-a000-000000000001', SO = '7ac2937a-0000-4000-a000-000000000001';
const PID = '34170228875264';
DB.shows.push({ id: SHOW, fee_ht: 457.98, pennylane_quote_id: '9001', prod_mode: 'production', date: '2026-12-02', city: 'Ville', venue: 'Brise Glace (fictif)' });
const base = { show_id: SHOW, hors_calcul: null, paid_at: null, pennylane_url: null, drive_file_id: null };
const acompte = { ...base, id: AC, kind: 'acompte', label: 'Acompte', pct: 50, amount: 228.99, sort: 1, sent_at: '2026-11-05', invoiced_on: '2026-11-05', invoice_number: 'F-AB-2026-11-33', pennylane_id: null };
const solde = { ...base, id: SO, kind: 'solde', label: 'Solde', pct: 50, amount: null, sort: 2, sent_at: null, invoiced_on: null, invoice_number: null, pennylane_id: null };
const f107 = { id: Number(PID), invoice_number: 'F-AB-2026-11-107', label: 'Facture Brise Glace (fictif) - F-AB-2026-11-107', quote: { id: 9001 },
  currency_amount_before_tax: '228.99', date: '2026-11-05', status: 'upcoming', paid: false, draft: false, public_file_url: null, credited_invoice: null,
  // lignes de la facture : la fonction ne les lit pas (test des deux libellés)
  invoice_lines: [{ label: 'Production de Spectacles • Cession' }] };
let facturesPL = [f107];
switch (scenario) {
  case '06-11-sans-libelle': break;                                                    // état du 06/11 avant 13:59 (faits relevés)
  case '06-11-libelle-acompte': f107.invoice_lines = [{ label: 'Acompte 50 % — Production de Spectacles • Cession' }]; f107.label = 'Facture acompte Brise Glace - F-AB-2026-11-107'; break;
  case '06-11-acompte-envoye-sans-numero': acompte.invoice_number = null; break;     // variante : seul l'envoi est noté à la main
  case 'etat-actuel': Object.assign(acompte, { invoice_number: 'F-AB-2026-11-107' });  // état relevé le 09/11 (après 14:03:19 le 06/11)
    Object.assign(solde, { amount: 228.99, invoice_number: 'F-AB-2026-11-107', pennylane_id: PID, invoiced_on: '2026-11-05', pennylane_url: 'u' }); break;
  case 'apres-correction':                                                              // après l'opération : acompte relié, solde libre
    Object.assign(acompte, { invoice_number: 'F-AB-2026-11-107', pennylane_id: PID, pennylane_url: 'u' });
    DB.pennylane_rattachements.push({ id: 1, pennylane_id: PID }); break;
  case 'apres-correction-vraie-facture-solde':                                          // plus tard : la vraie facture de solde est faite depuis le devis
    Object.assign(acompte, { invoice_number: 'F-AB-2026-11-107', pennylane_id: PID, pennylane_url: 'u' });
    DB.pennylane_rattachements.push({ id: 1, pennylane_id: PID });
    facturesPL.push({ ...f107, id: 34170228899999, invoice_number: 'F-AB-2026-11-250', label: 'Facture Brise Glace (fictif) - F-AB-2026-11-250', date: '2026-11-25' }); break;
  default: throw new Error('scénario inconnu');
}
DB.show_payments.push(acompte, solde);

globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://fictif.invalid', SUPABASE_SERVICE_ROLE_KEY: 'SRV', SUPABASE_ANON_KEY: 'ANON' })[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url) => {
  const u = String(url); let body;
  if (u.includes('/customer_invoices?')) body = { items: facturesPL, has_more: false };
  else if (u.endsWith('/me')) body = { company: { id: 22190862 } };
  else if (u.includes('/matched_transactions')) body = { items: [] };
  else throw new Error('appel réseau inattendu : ' + u);
  return new Response(JSON.stringify(body), { status: 200 });
};
await import(pathToFileURL(resolve(dossier, 'index.ts')).href);
const r = await globalThis.__h(new Request('https://fictif.invalid/pennylane', { method: 'POST', headers: { Authorization: 'Bearer jeton-equipe' }, body: JSON.stringify({ action: 'sync' }) }));
const out = await r.json();
const ligne = (p) => `${p.kind.padEnd(7)} n°=${p.invoice_number ?? '—'} pennylane_id=${p.pennylane_id ?? '—'} montant=${p.amount ?? '(calculé)'} envoi=${p.sent_at ?? '—'} facturée_le=${p.invoiced_on ?? '—'}`;
console.log(`== ${dossier} / ${scenario}`);
console.log('réponse :', JSON.stringify({ linked: out.linked, douteux: out.douteux, aRattacher: out.aRattacher, erreurs: out.erreurs, error: out.error }));
for (const p of DB.show_payments) console.log('  ' + ligne(p));
for (const a of DB.pennylane_a_rattacher) console.log(`  à rattacher : ${a.invoice_number} ${a.amount_ht} € — ${a.reason}`);
