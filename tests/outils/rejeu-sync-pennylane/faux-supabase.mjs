// Faux client Supabase en mémoire (données FICTIVES) pour rejeu-sync-pennylane : juste ce que la synchronisation Pennylane utilise.
// Contraintes reproduites : unicité show_payments.pennylane_id pour acompte / solde (migration v1.56.9).
export const DB = globalThis.__DB ||= { show_payments: [], shows: [], pennylane_rattachements: [], pennylane_a_rattacher: [], settings: [] };
export const LOG = globalThis.__LOG ||= [];
const TEAM = 'Bearer jeton-equipe';

function embed(table, cols, row) {
  const out = { ...row };
  const m = /shows(!inner)?\(([^)]*)\)/.exec(cols || '');
  if (m && table === 'show_payments') out.shows = DB.shows.find(s => s.id === row.show_id) || null;
  return out;
}
function getv(row, col) {
  if (col.includes('.')) { const [a, b] = col.split('.'); return row[a]?.[b]; }
  return row[col];
}
function builder(table) {
  const st = { filters: [], op: 'select', cols: '*', vals: null, ret: false, single: null, lim: null };
  const rows = () => DB[table] || (DB[table] = []);
  const match = (r) => st.filters.every(f => f(r));
  const b = {
    select(c) { if (st.op === 'select') st.cols = c; else st.ret = true; return b; },
    in(c, v) { st.filters.push(r => v.includes(getv(r, c))); return b; },
    is(c, v) { st.filters.push(r => (getv(r, c) ?? null) === v); return b; },
    not(c, op, v) { st.filters.push(r => (getv(r, c) ?? null) !== v); return b; },
    eq(c, v) { st.filters.push(r => getv(r, c) === v); return b; },
    or(s) { const parts = s.split(',').map(p => p.split('.')); st.filters.push(r => parts.some(([c, n, i]) => n === 'not' ? (r[c] ?? null) !== null : false)); return b; },
    order() { return b; }, range(a, z) { st.range = [a, z]; return b; }, limit(n) { st.lim = n; return b; },
    maybeSingle() { st.single = 'maybe'; return b; }, single() { st.single = 'one'; return b; },
    update(v) { st.op = 'update'; st.vals = v; return b; },
    upsert(v, o) { st.op = 'upsert'; st.vals = v; st.conf = o?.onConflict; return b; },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  function run() {
    if (st.op === 'upsert') {
      const t = rows(); const k = st.conf; const ex = t.find(r => r[k] === st.vals[k]);
      if (ex) Object.assign(ex, st.vals); else t.push({ id: 'ar-' + (t.length + 1), resolved_at: null, ...st.vals });
      LOG.push(['upsert', table, st.vals]); return { data: null, error: null };
    }
    if (st.op === 'update') {
      const hit = rows().filter(r => match(embed(table, 'shows()', r)));
      for (const r of hit) {
        const after = { ...r, ...st.vals };
        if (table === 'show_payments' && after.pennylane_id && ['acompte', 'solde'].includes(after.kind)
            && rows().some(o => o !== r && o.pennylane_id === after.pennylane_id && ['acompte', 'solde'].includes(o.kind))) {
          LOG.push(['refus', table, r.id, st.vals]);
          return { data: null, error: { message: 'duplicate key value violates unique constraint "show_payments_pennylane_unique_bill"' } };
        }
      }
      for (const r of hit) Object.assign(r, st.vals);
      LOG.push(['update', table, hit.map(r => r.id), st.vals]);
      return { data: st.ret ? hit.map(r => ({ id: r.id })) : null, error: null };
    }
    let out = rows().map(r => embed(table, st.cols, r)).filter(match);
    if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
    if (st.lim != null) out = out.slice(0, st.lim);
    if (st.single) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
  return b;
}
export function createClient(url, key, o = {}) {
  const auth = o.global?.headers?.Authorization ?? null;
  return {
    from: builder,
    rpc: async (fn) => {
      if (fn === 'is_team') return { data: auth === TEAM };
      if (fn === 'import_secret') return { data: 'jeton-fictif' };
      return { data: null };
    },
  };
}
