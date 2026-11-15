// v1.61.1 — Solde prévu (décision d'Anthony du 10/11/2026) : règle écrite plusieurs fois (§8.4). Contrôle sans base ni navigateur :
//  - base (supabase/migrations/2026-11-10_v1.61.1_solde_prevu.sql) : payment_amount_for déduit TOUS les acomptes (hors calcul exclus),
//    show_payments_caduc_guard ne refuse plus rien (verrou seul), reminder_candidates = texte v1.64 + les deux seuls changements voulus ;
//  - application (js/calc.js) : soldeDue sans filtre « facturé », plus d'état « caduc », retrait (0 %) défini comme en base ;
//  - aucune instruction destructive dans la migration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const sql = read('supabase/migrations/2026-11-10_v1.61.1_solde_prevu.sql');
const v164 = read('supabase/migrations/2026-11-09_v1.64_delais.sql');
const v151 = read('supabase/migrations/2026-10-27_v1.51_corea_coprod_cnm.sql');
const calc = read('js/calc.js');
let n = 0; const t = (nom, f) => { f(); n++; };
const body = (txt, name) => { const i = txt.indexOf(`create or replace function public.${name}`); assert.ok(i >= 0, name); const j = txt.indexOf('$function$;', i) >= 0 && name !== 'show_payments_caduc_guard' ? txt.indexOf('$function$;', i) : txt.indexOf('end $$;', i); return txt.slice(i, j); };
const code = s => s.split('\n').map(l => l.replace(/\s+--.*$/, '')).filter(l => !/^\s*--/.test(l) && l.trim()).join('\n');

t('base : aucune instruction destructive, aucune donnée écrite', () => {
  const c = code(sql).toLowerCase();
  for (const w of ['drop ', 'delete ', 'truncate', 'alter table', 'insert into', 'update public.', 'update show_payments', 'create trigger'])
    assert.ok(!c.includes(w), 'interdit : ' + w);
});
t('base : payment_amount_for — solde = cession − tous les acomptes (prévus et facturés), lignes hors calcul exclues', () => {
  const f = body(sql, 'payment_amount_for');
  const done = f.match(/into done\s+from public\.show_payments a where ([^;]+);/)[1];
  assert.ok(!done.includes('payment_is_emitted'), 'plus de filtre « acompte facturé »');
  assert.ok(done.includes("a.kind = 'acompte'") && done.includes('a.hors_calcul is null') && done.includes('a.id <> p.id'));
  assert.ok(f.includes('greatest(0, round((fee - done - fixed) * 100) / 100)'), 'jamais négatif, arrondi au centime');
  // le reste de la fonction = texte v1.51 (commissions, CNM, autres lignes inchangées)
  const old = body(v151, 'payment_amount_for');
  for (const frag of ["if p.kind = 'artbo' then return round(base * coalesce(p.pct, pct_com)) / 100; end if;", "if p.kind = 'cnm' or p.pct is null then return null; end if;", 'base := fee + public.corea_share_of(p.show_id);'])
    assert.ok(old.includes(frag) && f.includes(frag), frag);
});
t('base : show_payments_caduc_guard — verrou par date gardé, plus aucun refus « caduc »', () => {
  const f = body(sql, 'show_payments_caduc_guard');
  assert.ok(f.includes("pg_advisory_xact_lock(hashtext('show_payments_emission'), hashtext(new.show_id::text))"));
  assert.ok(!/raise exception/i.test(code(f)));
});
t('base : reminder_candidates = v1.64 + acompte toujours réclamé (sauf retiré) — rien d’autre ne change', () => {
  const a = code(body(v164, 'reminder_candidates')), b = code(body(sql, 'reminder_candidates'));
  assert.ok(a.includes('not coalesce(so_emis, false)') && !b.includes('so_emis, false)'), 'le solde facturé ne coupe plus le rappel');
  assert.ok(b.includes('and a_id is not null and not a_emis and not a_retire'));
  const attendu = a.replace('and a_id is not null and not a_emis and not coalesce(so_emis, false)', 'and a_id is not null and not a_emis and not a_retire')
    .replace(/(a_emis,\n)/, '$1      coalesce(a.amount = 0 or (a.amount is null and a.pct = 0), false) a_retire,\n');
  assert.equal(b, attendu);
  assert.ok(sql.includes('v1.64 délais'), 'marqueur v1.64 gardé (garde de la migration v1.64)');
});
t('application : soldeDue déduit tous les acomptes ; plus d’état « caduc » ; retrait défini comme en base', () => {
  const sd = calc.slice(calc.indexOf('export function soldeDue'), calc.indexOf('export const multiSolde'));
  assert.ok(sd.includes("const done = pays.filter(p => p.kind === 'acompte').reduce("), 'tous les acomptes comptés (paymentsOf : hors calcul exclus)');
  assert.ok(!/'caduc'/.test(code(calc)), 'aucun état « caduc »');
  assert.match(calc, /export const acompteRetire = p => p\?\.kind === 'acompte' && !isInvoiced\(p\)\n\s+&& \(p\.amount != null && p\.amount !== '' \? Number\(p\.amount\) === 0 : p\.pct != null && p\.pct !== '' && Number\(p\.pct\) === 0\);/);
});
console.log(`Solde prévu (JS / SQL, sans base) : ${n}/5 réussis.`);
