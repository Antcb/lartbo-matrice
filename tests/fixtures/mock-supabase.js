/*
 * Fausse base Supabase pour les tests (remplace la bibliothèque supabase-js chargée par les pages).
 * Toutes les données sont FICTIVES : aucun nom, aucune adresse, aucun jeton réel. Aucun secret.
 * Les écritures restent en mémoire (window.__DB) et sont journalisées dans window.__calls.
 */
(function () {
  const uid = () => 'id-' + Math.random().toString(36).slice(2, 10);
  const iso = days => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  // dates des concerts dans l'année en cours (le filtre par année de l'application les affiche toutes)
  const Y = new Date().getFullYear(), inYear = md => `${Y}-${md}`;
  const ART = 'art-a', ART2 = 'art-b', PART = 'part-1';
  const USER = 'testeur@example.com';

  const seed = {
    app_users: [{ email: USER, display_name: 'Testeur' }, { email: 'collegue@example.com', display_name: 'Collègue' }],
    settings: [
      { key: 'default_acompte_pct', value: 50 }, { key: 'default_solde_pct', value: 50 },
      { key: 'default_artbo_pct', value: 15 }, { key: 'default_artbo_pct_booking', value: 15 }, { key: 'default_artbo_pct_production', value: 20 },
      { key: 'default_partner_pct', value: 5 }, { key: 'default_cnm_pct', value: 3.5 }, { key: 'movinmotion_payslip_cost', value: 20.3 },
    ],
    partners: [{ id: PART, name: 'Partenaire Fictif', default_pct: 5 }],
    projects: [
      { id: ART, name: 'Artiste Alpha', active: true, mode: 'production', default_partner_id: PART, artist_token: 'jeton-artiste-test-0001' },
      { id: ART2, name: 'Artiste Bêta', active: true, mode: 'booking' },
      { id: 'art-c', name: 'Artiste Gamma', active: false, mode: 'booking' },
    ],
    structures: [
      { id: 'st-1', name: 'Salle Exemple', city: 'Villeexemple', country: 'France', department_code: '75', tags: ['Salle'], lat: 48.85, lng: 2.35 },
      { id: 'st-2', name: 'Festival Fictif', city: 'Bourg-Test', country: 'France', department_code: '49', tags: ['Festival'], lat: 47.45, lng: -0.55 },
    ],
    contacts: [{ id: 'ct-1', first_name: 'Camille', last_name: 'Exemple', display_name: 'Camille Exemple', email: 'camille@example.com', roles: ['Programmation'] }],
    contact_structures: [{ contact_id: 'ct-1', structure_id: 'st-1' }],
    shows: [
      { id: 'sh-1', project_id: ART, structure_id: 'st-2', venue: 'Festival Fictif', date: inYear('06-15'), city: 'Bourg-Test', department: '49',
        status: 'Confirmée Festival', contract_type: 'Cession', fee_ht: 6000, artbo_pct: 15, partner_id: PART, partner_pct: 5, prod_mode: 'production',
        communication_enabled: true, ticketing_enabled: false, fiche_token: 'jeton-fiche-test-0001' },
      { id: 'sh-2', project_id: ART, structure_id: 'st-1', venue: 'Salle Exemple', date: inYear('09-20'), city: 'Villeexemple', department: '75',
        status: 'Option Salle', contract_type: 'Cession', fee_ht: 4000, communication_enabled: true },
      { id: 'sh-3', project_id: ART2, venue: 'Lieu Témoin', date: inYear('11-10'), city: 'Testville', department: '13', status: 'Intérêt Salle', prod_mode: 'booking' },
    ],
    show_payments: [
      { id: 'pa-1', show_id: 'sh-1', kind: 'acompte', label: 'Acompte', pct: 50, sort: 10 },
      { id: 'pa-2', show_id: 'sh-1', kind: 'solde', label: 'Solde', pct: 50, sort: 20 },
      { id: 'pa-3', show_id: 'sh-1', kind: 'artbo', label: "Commission L'ArtBo", sort: 30 },
      { id: 'pa-4', show_id: 'sh-1', kind: 'partner', label: 'Commission partenaire', sort: 40 },
    ],
    prospects: [{ id: 'pr-1', name: 'Suivi', project_id: ART, structure_id: 'st-1', status: 'Interest', summary: '- Échange fictif' }],
    prospect_logs: [
      { id: 'lg-1', prospect_id: 'pr-1', date: iso(-3), kind: 'Appel', contact_name: 'Camille', body: '- Note de test' },
      // mail envoyé depuis la Matrice (contenu HTML conservé), avec un lien et un tableau
      { id: 'lg-2', prospect_id: 'pr-1', date: iso(-1), kind: 'Mail', contact_name: 'camille@example.com',
        body: '**Confirmation envoyée** · Salle Exemple\n**Objet :** Confirmation Artiste Alpha\n\nBonjour Camille',
        body_html: '<div>Bonjour <b>Camille</b>,</div><table width="400" align="center"><tr><td colspan="2">Cachet : 4 000 € HT</td></tr></table><div><a href="https://example.com/fiche">Fiche de renseignements</a></div>' },
    ],
    prospect_files: [], budget_lines: [], structure_events: [], project_logs: [], project_members: [], attachments: [],
    notifications: [{ id: 'nt-1', title: 'Notification de test', body: 'Artiste Alpha', created_at: new Date().toISOString(), read_by: [], show_id: 'sh-1' }],
    employees: [{ id: 'em-1', last_name: 'EXEMPLE', first_name: 'Dominique', email: 'dominique@example.com', active: true, info: {}, docs: [], form_token: 'jeton-rh-test-00000001' }],
    mail_templates: [{ id: 'mt-1', project_id: ART, kind: 'confirmation', name: 'Confirmation (test)', subject: 'Confirmation {{artiste}}', html: '<div>Bonjour {{contact}}</div>', attachments: [] }],
    tasks: [
      { id: 'tk-1', title: 'Tâche en retard', status: 'To Do', deadline: iso(-2), project_id: ART, assigned_to: USER, tags: [] },
      { id: 'tk-2', title: 'Tâche à venir', status: 'In Progress', deadline: iso(5), project_id: ART, show_id: 'sh-2', tags: [] },
      { id: 'tk-3', title: 'Tâche terminée', status: 'Done', deadline: iso(-20), done_at: new Date(Date.now() - 20 * 864e5).toISOString(), tags: [] },
    ],
  };
  // Une table inconnue se comporte comme une table vide (client_errors, etc.)
  const DB = window.__DB = new Proxy(JSON.parse(JSON.stringify(seed)), { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' ? (o[k] = []) : undefined)) });
  window.__calls = [];
  const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const CONFIRMED = ['Confirmée Salle', 'Confirmée Festival'];

  function builder(table, url) {
    const st = { op: 'select', filters: [], single: false, patch: null, range: null };
    const match = r => st.filters.every(([c, v, how]) => how === 'in' ? v.includes(r[c]) : how === 'neq' ? r[c] !== v : (v === null ? r[c] == null : r[c] === v));
    const exec = () => {
      window.__calls.push({ table, op: st.op, patch: st.patch, filters: st.filters, url: url || null });
      const rows = DB[table];
      if (st.op === 'select') { let d = rows.filter(match); if (st.range) d = d.slice(st.range[0], st.range[1] + 1); return { data: clone(st.single ? d[0] : d), error: null }; }
      if (st.op === 'update') {
        const d = rows.filter(match);
        d.forEach(r => {
          const before = r.status; Object.assign(r, st.patch);
          // imitation du déclencheur serveur de confirmation : création des lignes de facturation
          if (table === 'shows' && CONFIRMED.includes(st.patch.status) && !CONFIRMED.includes(before) && !DB.show_payments.some(p => p.show_id === r.id))
            ['acompte', 'solde', 'artbo'].forEach((k, i) => DB.show_payments.push({ id: uid(), show_id: r.id, kind: k, label: k, pct: k === 'artbo' ? null : 50, sort: (i + 1) * 10 }));
        });
        return { data: clone(st.single ? d[0] : d), error: null };
      }
      if (st.op === 'insert') { const arr = (Array.isArray(st.patch) ? st.patch : [st.patch]).map(r => ({ id: uid(), ...r })); rows.push(...arr); return { data: clone(st.single ? arr[0] : arr), error: null }; }
      if (st.op === 'upsert') { const arr = Array.isArray(st.patch) ? st.patch : [st.patch]; arr.forEach(p => { const r = rows.find(x => (p.id && x.id === p.id) || (p.key && x.key === p.key)); r ? Object.assign(r, p) : rows.push({ ...p }); }); return { data: clone(arr), error: null }; }
      if (st.op === 'delete') { const keep = rows.filter(r => !match(r)); rows.length = 0; rows.push(...keep); return { data: null, error: null }; }
      return { data: null, error: null };
    };
    const b = new Proxy({}, {
      get(_, k) {
        if (k === 'then') return (res, rej) => Promise.resolve().then(exec).then(res, rej);
        if (k === 'select') return () => b;
        if (k === 'range') return (a, z) => { st.range = [a, z]; return b; };
        if (k === 'update' || k === 'insert' || k === 'upsert') return p => { st.op = k; st.patch = p; return b; };
        if (k === 'delete') return () => { st.op = 'delete'; return b; };
        if (k === 'eq' || k === 'is') return (c, v) => { st.filters.push([c, v, 'eq']); return b; };
        if (k === 'neq') return (c, v) => { st.filters.push([c, v, 'neq']); return b; };
        if (k === 'in') return (c, a) => { st.filters.push([c, a, 'in']); return b; };
        if (k === 'single' || k === 'maybeSingle') return () => { st.single = true; return b; };
        return () => b;   // order, limit, gt, lt, ilike, not, or… : sans effet dans la fausse base
      },
    });
    return b;
  }

  const RPC = {
    is_team: () => true,
    mail_vars: () => ({ artiste: 'Artiste Alpha', date: 'mardi 1er juin 2027', ville: 'Bourg-Test', lieu: 'Festival Fictif', cachet_ht: '6 000 €', contact: 'Camille',
      lien_fiche: 'https://exemple.invalid/fiche.html?t=jeton-fiche-test-0001' }),
    // v1.40 (A2) : fiche d'une date booking / production avec le mode transmis par le serveur (migration 2026-10-25_v1.40_fiche_mode)
    fiche_get: a => a.p_token === 'jeton-fiche-booking-vide' ? { artist: 'Artiste Bêta', date: inYear('11-12'), date_label: 'date de test', venue: 'Lieu Témoin',
      city: 'Testville', contract_type: 'Cession', fee_ht: 8000, vat: 5.5, fee_ttc: 8440, acompte_pct: 50, prod_mode: 'booking', payments: [],
      structure: { name: 'Lieu Témoin' }, fiche: {}, submitted_at: null, locked: false }
    : ['jeton-fiche-booking-001', 'jeton-fiche-prodmode-01'].includes(a.p_token) ? { artist: 'Artiste Bêta', date: inYear('11-10'), date_label: 'date de test',
      venue: 'Lieu Témoin', city: 'Testville', contract_type: 'Cession', fee_ht: 8000, vat: 5.5, fee_ttc: 8440, acompte_pct: 30,
      prod_mode: a.p_token === 'jeton-fiche-booking-001' ? 'booking' : 'production',
      payments: [{ label: 'Acompte', kind: 'acompte', pct: 30, ht: 2400, due_label: 'à la signature' }, { label: 'Solde', kind: 'solde', pct: 70, ht: 5600, due_label: 'le soir du concert' }],
      structure: { name: 'Lieu Témoin' }, fiche: {}, submitted_at: null, locked: false }
    : a.p_token === 'jeton-fiche-test-0001' ? { artist: 'Artiste Alpha', date: inYear('06-15'), date_label: 'date de test', venue: 'Festival Fictif', city: 'Bourg-Test',
      contract_type: 'Cession', fee_ht: 6000, vat: 5.5, fee_ttc: 6330, acompte_pct: 50, payments: [{ label: 'Acompte', kind: 'acompte', pct: 50, ht: 3000 }, { label: 'Solde', kind: 'solde', pct: 50, ht: 3000 }],
      structure: { name: 'Festival Fictif' }, fiche: {}, submitted_at: null, locked: false } : null,
    rh_get: a => a.p_token === 'jeton-rh-test-00000001' ? { first_name: 'Dominique', last_name: 'EXEMPLE', email: 'dominique@example.com', info: {}, docs: [], submitted_at: null } : null,
    artist_get: a => a.p_token === 'jeton-artiste-test-0001' ? { name: 'Artiste Alpha', info: {}, docs: [], submitted_at: null } : null,
  };

  window.supabase = {
    // Adresse du projet demandée par la page (production ou test) : relevée, jamais contactée (lot S0-R8)
    createClient(url) {
      (window.__clientUrls ||= []).push(String(url));
      return {
        from: table => builder(table, String(url)),
        rpc: async (name, args) => { window.__calls.push({ rpc: name, args, url: String(url) }); const f = RPC[name]; return { data: f ? clone(f(args || {})) : null, error: null }; },
        // window.__FN_ERROR = { nom: 'message' } : la fonction serveur répond par cette erreur (essais de la file des résumés IA)
        functions: { invoke: async (name, o) => { window.__calls.push({ fn: name, body: o && o.body, url: String(url) });
          const err = window.__FN_ERROR && window.__FN_ERROR[name];
          return err ? { data: null, error: { message: err } } : { data: { ok: true }, error: null }; } },
        storage: { from: bucket => ({ upload: async () => ({ data: {}, error: null }),
          // fichiers effacés notés dans window.__calls ({ storageRemove: bucket, paths }) pour vérifier qu'aucun fichier ne reste orphelin
          remove: async paths => { window.__calls.push({ storageRemove: bucket, paths: [...paths] }); return { data: [], error: null }; },
          createSignedUrl: async () => ({ data: { signedUrl: 'about:blank' }, error: null }), createSignedUrls: async p => ({ data: p.map(() => ({ signedUrl: 'about:blank' })), error: null }) }) },
        channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe: async () => 'ok' }; return c; },
        removeChannel: async () => 'ok',
        auth: {
          getSession: async () => ({ data: { session: window.__NO_SESSION ? null : { user: { email: USER } } } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({ error: null }), signInWithPassword: async () => ({ data: {}, error: null }), signInWithOtp: async () => ({ error: null }),
        },
      };
    },
  };
})();
