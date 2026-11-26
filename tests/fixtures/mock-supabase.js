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
    prospect_files: [], budget_lines: [], spectacles: [], structure_events: [], project_logs: [], project_members: [], attachments: [],
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
  // outil de rapprochement (tests/outils) : un extrait JSON remplace les données fictives ; tout reste en mémoire, rien n'est envoyé
  const DB = window.__DB = new Proxy(JSON.parse(JSON.stringify(window.__SEED_OVERRIDE || seed)), { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' ? (o[k] = []) : undefined)) });
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
      // window.__INSERT_ERROR = { table: {code, message} } : création refusée par la base (ex. doublon d'une clé unique, code 23505 — v1.60.4)
      // (v1.60.7) ou une fonction (ligne insérée → erreur ou rien) : refus selon le contenu (ex. colonne pas encore créée)
      if (st.op === 'insert' && window.__INSERT_ERROR && window.__INSERT_ERROR[table]){ const ie = window.__INSERT_ERROR[table], err = typeof ie === 'function' ? ie(st.patch) : ie;
        if (err) return { data: null, error: err }; }
      // window.__MISSING_COL = { table: 'colonne' } : colonne absente de la base (migration pas encore appliquée), comme PostgREST (PGRST204)
      if ((st.op === 'insert' || st.op === 'update') && window.__MISSING_COL && window.__MISSING_COL[table] && [].concat(st.patch).some(r => r && window.__MISSING_COL[table] in r))
        return { data: null, error: { code: 'PGRST204', message: `Could not find the '${window.__MISSING_COL[table]}' column of '${table}' in the schema cache` } };
      if (st.op === 'insert') { const arr = (Array.isArray(st.patch) ? st.patch : [st.patch]).map(r => ({ id: uid(), ...r }));
        // imitation du déclencheur budget_lines_mark_created (v1.67) : première ligne d'une date sans budget → shows.budget_created_at
        if (table === 'budget_lines') for (const r of arr){ const sh = r.show_id && DB.shows.find(x => x.id === r.show_id);
          if (sh && !sh.budget_created_at && !rows.some(x => x.show_id === r.show_id)) sh.budget_created_at = window.__SERVER_NOW || new Date().toISOString();
          rows.push(r); }
        else rows.push(...arr);
        return { data: clone(st.single ? arr[0] : arr), error: null }; }
      // imitation du déclencheur settings_delais_instant (v1.64) : marqueur « @enregistrement » des versions ajoutées → instant du serveur
      if (st.op === 'upsert' && table === 'settings') { const now = window.__SERVER_NOW || new Date().toISOString(), arr = Array.isArray(st.patch) ? st.patch : [st.patch];
        st.patch = arr.map(p => p.key !== 'delais' || !p.value || typeof p.value !== 'object' ? p : { ...p, value: Object.fromEntries(Object.entries(p.value).map(([k, l]) =>
          [k, Array.isArray(l) ? l.map(v => v && typeof v === 'object' ? { ...v, ...(v.from === '@enregistrement' ? { from: now } : {}), ...(v.at === '@enregistrement' ? { at: now } : {}) } : v) : l])) }); }
      if (st.op === 'upsert') { const arr = Array.isArray(st.patch) ? st.patch : [st.patch]; arr.forEach(p => { const r = rows.find(x => (p.id && x.id === p.id) || (p.key && x.key === p.key)); r ? Object.assign(r, p) : rows.push({ ...p }); }); return { data: clone(arr), error: null }; }
      // window.__DELETE_ERROR = { table: {code, message} } : suppression refusée par la base (ex. clé étrangère, v1.60.3)
      if (st.op === 'delete' && window.__DELETE_ERROR && window.__DELETE_ERROR[table]) return { data: null, error: window.__DELETE_ERROR[table] };
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

  // v1.60.3 : suppression contrôlée d'une date (migration 2026-11-07_v1.60.3_suppression_date) — refus du résultat clôturé
  // (les autres refus sont essayés sur une vraie base PostgreSQL), copie dans show_deletions, tâches détachées
  const deletionState = id => { const s = DB.shows.find(x => x.id === id); if (!s) return null;
    const devis = !!s.pennylane_quote_id, emis = DB.show_payments.some(p => p.show_id === id && (p.sent_at || p.paid_at || p.invoice_number || p.pennylane_id));
    return { blocked: [s.result_closed_at && 'Le résultat de cette date est clôturé : rouvre-le d’abord (bouton « Rouvrir », avec un motif), puis supprime la date.',
        emis && 'Cette date a des factures émises : elle ne se supprime pas (ses factures et son budget seraient effacés avec elle).',
        devis && 'Cette date est liée à un document Pennylane (devis ou facture) : elle ne se supprime pas (rien n’est jamais supprimé dans Pennylane, le document resterait sans sa date).'].filter(Boolean),
      archive_blocked: [s.result_closed_at && 'Le résultat de cette date est clôturé : rouvre-le d’abord (bouton « Rouvrir », avec un motif).', s.archived_at && 'Cette date est déjà archivée.',
        emis && 'Cette date a des factures émises ou des versements : elle reste dans les listes, les comptes et les relances (pas d’archivage).'].filter(Boolean),
      payments: DB.show_payments.filter(r => r.show_id === id).length, budget_lines: DB.budget_lines.filter(r => r.show_id === id).length,
      tasks: DB.tasks.filter(r => r.show_id === id).length, closures: DB.result_closures.filter(r => r.show_id === id).length }; };
  const RPC = {
    // messagerie : boîte anthony@ réservée à son propriétaire (window.__MAILBOX_OWNER = false : autre membre de l'équipe)
    is_mailbox_owner: () => window.__MAILBOX_OWNER ?? true,
    is_team: () => true,
    // v1.66 : textes des mails privés (private.mail_textes) — lus / écrits seulement par le titulaire, jamais écrasés
    mail_texte_lire: ({ p_ids = [] }) => (window.__MAILBOX_OWNER ?? true) ? (window.__DB.mail_textes || []).filter(t => p_ids.includes(t.message_id)) : [],
    mail_texte_ecrire: ({ p_id, p_text }) => { if (!(window.__MAILBOX_OWNER ?? true) || !p_text) return false;
      const T = (window.__DB.mail_textes ||= []); if (T.some(t => t.message_id === p_id)) return false;
      T.push({ message_id: p_id, body_text: p_text }); return true; },
    // v1.70 (L2a) : encaissements et remboursements réels — mêmes contrôles que les fonctions SQL reglement_saisir / reglement_effectuer /
    // reglement_annuler (essayées sur une vraie base PostgreSQL : supabase/repetitions/2026-11-26_v1.70_encaissements_essai.sql)
    reglement_saisir: ({ p_payment, p_sens, p_etat, p_montant, p_date, p_compte, p_reference, p_motif }) => {
      const D = window.__DB, err = m => { throw Object.assign(new Error(m), { code: 'P0001' }); };
      const p = (D.show_payments || []).find(x => x.id === p_payment); if (!p) err('Ligne de facturation introuvable');
      const s = (D.shows || []).find(x => x.id === p.show_id) || {}, mode = s.prod_mode || 'production';
      if (p.hors_calcul != null) err('Ligne hors calcul : aucun encaissement ni remboursement');
      if (!((mode !== 'booking' && ['acompte', 'solde', 'autre'].includes(p.kind)) || (mode === 'booking' && p.kind === 'artbo'))) err('Cette ligne n\'est pas une facture suivie (encaissements : acompte, solde, autre ligne ; en booking, la commission)');
      const t = v => String(v ?? '').trim();
      if (!(p.sent_at || p.paid_at || t(p.invoice_number) || t(p.pennylane_id))) err('Facture pas encore émise : rien à encaisser ni à rembourser');
      if (!['encaissement', 'remboursement'].includes(p_sens) || !['a_faire', 'fait'].includes(p_etat) || (p_etat === 'a_faire' && p_sens !== 'remboursement')) err('Type de mouvement invalide');
      if (p_sens === 'encaissement' && p.paid_at) err('Facture déjà notée payée : son paiement est conservé tel quel');
      const m = Number(p_montant); if (!(m > 0 && m < 1e8)) err('Montant TTC à saisir (positif)');
      if (p_etat === 'fait' && !p_date) err('Date du mouvement à saisir');
      if (p_compte != null && !['compte', 'artbo', 'artiste', 'autre'].includes(p_compte)) err('Compte inconnu');
      const r = { id: 'reg-' + Math.random().toString(36).slice(2, 10), payment_id: p.id, show_id: p.show_id, sens: p_sens, etat: p_etat, montant_ttc: Math.round(m * 100) / 100,
        date: p_etat === 'fait' ? p_date : null, compte: p_compte ?? null, reference: t(p_reference) || null, motif: t(p_motif) || null, source: 'manuel', transaction_id: null,
        avoir_id: null, created_at: new Date().toISOString(), created_by: USER, rapproche_at: null, annule_at: null, annule_par: null, annule_motif: null };
      (D.reglements ||= []).push(r); return r;
    },
    reglement_effectuer: ({ p_id, p_date, p_compte, p_reference }) => {
      const err = m => { throw Object.assign(new Error(m), { code: 'P0001' }); };
      if (!p_date) err('Date du remboursement à saisir');
      if (p_compte != null && !['compte', 'artbo', 'artiste', 'autre'].includes(p_compte)) err('Compte inconnu');
      const r = (window.__DB.reglements || []).find(x => x.id === p_id && x.etat === 'a_faire' && !x.annule_at);
      if (!r) err('Remboursement introuvable, déjà fait ou annulé');
      Object.assign(r, { etat: 'fait', date: p_date, compte: p_compte ?? r.compte, reference: String(p_reference ?? '').trim() || r.reference }); return r;
    },
    reglement_annuler: ({ p_id, p_motif }) => {
      const err = m => { throw Object.assign(new Error(m), { code: 'P0001' }); };
      const m = String(p_motif ?? '').trim(); if (!m || m.length > 500) err('Motif obligatoire (500 caractères au plus)');
      const r = (window.__DB.reglements || []).find(x => x.id === p_id && x.source === 'manuel' && !x.transaction_id && !x.annule_at);
      if (!r) err('Seule une saisie manuelle non rapprochée de Pennylane, pas encore annulée, peut être annulée');
      Object.assign(r, { annule_at: new Date().toISOString(), annule_par: USER, annule_motif: m });
      // statut de la ligne recalculé (décision du 26/11/2026, relecture B1) — même calcul que le SQL : ligne payée PAR SES ENCAISSEMENTS
      const D = window.__DB, p = (D.show_payments || []).find(x => x.id === r.payment_id), rs = (D.reglements || []).filter(x => x.payment_id === r.payment_id);
      if (p && p.paid_at && rs.some(x => x.sens === 'encaissement')) {
        const sh = (D.shows || []).find(x => x.id === p.show_id) || {};
        const vat = Number(p.vat_rate ?? (['artbo', 'partner'].includes(p.kind) ? 20 : sh.vat_rate ?? 5.5)), c = v => Math.round(v * 100) / 100;
        const av = (D.pennylane_avoirs || []).filter(a => a.payment_id === p.id && a.etat === 'rattache' && !a.gone_at).reduce((t, a) => t + (a.amount_ttc != null ? Number(a.amount_ttc) : c(Number(a.amount_ht) * (1 + vat / 100))), 0);
        const net = Math.max(0, c(Number(p.amount) * (1 + vat / 100)) - av), ok = rs.filter(x => x.etat === 'fait' && !x.annule_at);
        const enc = ok.reduce((t, x) => t + (x.sens === 'encaissement' ? 1 : -1) * Number(x.montant_ttc), 0), dernier = ok.filter(x => x.sens === 'encaissement').map(x => x.date).sort().pop() || null;
        p.paid_at = dernier && enc >= net - 0.01 ? dernier : null;
      }
      return r;
    },
    // v1.68 : correction d'une facture émise (déverrouillage explicite) — mêmes contrôles que la fonction SQL facture_corriger
    // (essayée sur une vraie base PostgreSQL : supabase/repetitions/2026-11-26_v1.68_correction_facture_essai.sql)
    facture_corriger: ({ p_payment, p_amount, p_pct, p_vat, p_motif }) => {
      const D = window.__DB, err = (m, code = 'P0001') => { throw Object.assign(new Error(m), { code }); };
      const m = String(p_motif ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''); if (!m) err('Motif obligatoire pour corriger une facture émise', '22023');
      if (m.length > 500) err('Motif trop long (500 caractères au plus)', '22023');
      const r = D.show_payments.find(x => x.id === p_payment); if (!r) err('Ligne de facturation introuvable');
      const sh = D.shows.find(x => x.id === r.show_id), selfPaid = r.kind === 'artbo' && (sh?.prod_mode ?? 'production') !== 'booking';
      if (r.hors_calcul != null) err('Ligne hors calcul (gardée pour la traçabilité) : elle ne se corrige pas');
      if (selfPaid) err('Commission de production : ce n’est pas une facture, ses règles de versement restent inchangées');
      if (['acompte', 'solde', 'autre'].includes(r.kind) && sh?.prod_mode === 'booking') err('Date en booking : les factures d’acompte et de solde sont celles de l’artiste, elles ne se corrigent pas ici');
      const f = v => v != null && String(v).trim() !== '';
      if (!['sent_at', 'paid_at', 'invoice_number', 'pennylane_id'].some(k => f(r[k]))) err('Facture pas encore émise : elle se modifie directement dans le tableau');
      if (p_amount == null || !Number.isFinite(Number(p_amount)) || p_amount < 0 || p_amount >= 1e8) err('Montant HT à saisir (0 ou plus, moins de 100 millions)', '22023');
      const amount = Math.round(p_amount * 100) / 100, n = v => v == null ? null : Number(v);
      if (amount === n(r.amount) && n(p_pct) === n(r.pct) && n(p_vat) === n(r.vat_rate)) err('Aucun changement à enregistrer', '22023');
      const before = { amount: n(r.amount), pct: n(r.pct), vat_rate: n(r.vat_rate) };
      Object.assign(r, { amount, pct: n(p_pct), vat_rate: n(p_vat) });
      D.facture_corrections.push({ id: D.facture_corrections.length + 1, at: new Date().toISOString(), actor: USER, payment_id: r.id, show_id: r.show_id,
        invoice_number: r.invoice_number ?? null, motif: m, before, after: { amount, pct: n(p_pct), vat_rate: n(p_vat) } });
      return { ok: true, row: r }; },
    // v1.67 : ligne Movinmotion posée seulement s'il y a une ligne de salaire AU CACHET (même règle que la fonction SQL)
    ensure_movinmotion: ({ p_show }) => { const D = window.__DB, sh = (D.shows || []).find(x => x.id === p_show); if (!sh || sh.prod_mode === 'booking') return null;
      const ls = (D.budget_lines || []).filter(l => l.show_id === p_show);
      if (!ls.some(l => l.category === 'Staff' && (l.pay_mode ?? 'cachet') === 'cachet') || ls.some(l => l.auto === 'movinmotion')) return null;
      const cost = (D.settings || []).find(x => x.key === 'movinmotion_payslip_cost')?.value ?? 20.3;
      D.budget_lines.push({ id: 'mm-' + p_show, project_id: sh.project_id, show_id: p_show, category: 'Movinmotion', label: 'Commission bulletins de paie', supplier: 'Movinmotion', auto: 'movinmotion', payer: 'compte', unit_cost: Number(cost), sort: 99 });
      return null; },
    // v1.66.5 : liens des textes déjà enregistrés — remplacés seulement si le nouveau texte, sans ses adresses de liens, est l'ancien
    mail_texte_liens: ({ p_log, p_old, p_new }) => { const sans = String(p_new).replace(/\[([^\[\]\n]+)\]\(((?:https?:\/\/|mailto:|tel:)[^() \t\n\r\f\v<>]+)\)/gi, '$1');
      if (p_new === p_old) return false; if (sans !== p_old) throw Object.assign(new Error('texte différent'), { code: '22023' });
      const l = window.__DB.prospect_logs.find(x => x.id === p_log && x.mail_text === p_old); if (!l) return false; l.mail_text = p_new; return true; },
    mail_texte_liens_prive: ({ p_id, p_old, p_new }) => { if (!(window.__MAILBOX_OWNER ?? true)) throw Object.assign(new Error('réservé au titulaire'), { code: '42501' });
      const sans = String(p_new).replace(/\[([^\[\]\n]+)\]\(((?:https?:\/\/|mailto:|tel:)[^() \t\n\r\f\v<>]+)\)/gi, '$1');
      if (p_new === p_old) return false; if (sans !== p_old) throw Object.assign(new Error('texte différent'), { code: '22023' });
      const t = (window.__DB.mail_textes || []).find(x => x.message_id === p_id && x.body_text === p_old); if (!t) return false; t.body_text = p_new; return true; },
    // messagerie : boîte anthony@ réservée à son propriétaire (window.__MAILBOX_OWNER = false : autre membre de l'équipe)
    is_mailbox_owner: () => window.__MAILBOX_OWNER ?? true,
    show_deletion_state: a => deletionState(a.p_show),
    delete_show: a => { const id = a.p_show, st = deletionState(id);
      DB.show_deletions.push({ id: DB.show_deletions.length + 1, show_id: id, actor: USER, snapshot: { show: DB.shows.find(x => x.id === id), result_closures: DB.result_closures.filter(r => r.show_id === id) } });
      const show = DB.shows.find(x => x.id === id), ids = DB.tasks.filter(t => t.show_id === id).map(t => t.id);
      DB.tasks.forEach(t => { if (t.show_id === id){ t.show_id = null; t.notes = ['Date supprimée le 07/11/2026 : ' + [show.date, show.venue].join(' · '), t.notes].filter(Boolean).join('\n'); } });
      for (const t of ['result_closures', 'show_payments', 'budget_lines']) { const keep = DB[t].filter(r => r.show_id !== id); DB[t].length = 0; DB[t].push(...keep); }
      const keep = DB.shows.filter(x => x.id !== id); DB.shows.length = 0; DB.shows.push(...keep);
      return { ...st, task_ids: ids }; },
    // archivage : notifications de la date retirées (gardées) ; restauration : relances suspendues jusqu'à leur réactivation explicite
    archive_show: a => { const s = DB.shows.find(x => x.id === a.p_show); Object.assign(s, { archived_at: new Date().toISOString(), archived_by: USER, archived_reason: a.p_reason });
      DB.notifications.forEach(n => { if (n.show_id === a.p_show && !n.withdrawn_at) Object.assign(n, { withdrawn_at: new Date().toISOString(), withdrawn_reason: 'Date archivée' }); }); return null; },
    restore_show: a => { const s = DB.shows.find(x => x.id === a.p_show); Object.assign(s, { archived_at: null, archived_by: null, archived_reason: null, restored_at: new Date().toISOString(), reminders_suspended_at: new Date().toISOString(), reminders_next: null }); return null; },
    reactivate_reminders: a => { const s = DB.shows.find(x => x.id === a.p_show); Object.assign(s, { reminders_suspended_at: null, reminders_reactivated_at: new Date().toISOString(), reminders_next: a.p_next }); return null; },
    // décisions du 09/11/2026 : exclusion manuelle de la prospection (même effet que la fonction SQL set_prospection, sans Brevo)
    // remise d'une adresse partagée : p_avec = autres contacts exclus confirmés, remis aussi (même motif, une trace chacun)
    set_prospection: a => { const at = new Date().toISOString(), tous = a.p_exclure ? [a.p_contact] : [a.p_contact, ...(a.p_avec || [])];
      for (const id of tous) { const c = DB.contacts.find(x => x.id === id);
        const e = { at, action: a.p_exclure ? 'exclusion' : 'remise', origine: 'manuelle', par: USER, motif: a.p_motif + (id === a.p_contact ? '' : ' (adresse partagée)') };
        Object.assign(c, a.p_exclure ? { prospection_exclue_at: at } : { prospection_exclue_at: null, hors_prospection_at: null },
          { prospection_history: [...(c.prospection_history || []), e] }); }
      const c = DB.contacts.find(x => x.id === a.p_contact);
      return { hors_prospection_at: c.hors_prospection_at || null, prospection_exclue_at: c.prospection_exclue_at || null, prospection_history: c.prospection_history, remis: a.p_exclure ? [] : tous }; },
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
    // v1.60.2 : adresse et code postal du LIEU DE LA DATE renvoyés par fiche_get (différents de ceux de la structure)
    : a.p_token === 'jeton-fiche-lieu-00001' ? { artist: 'Artiste Alpha', date: inYear('06-16'), date_label: 'date de test', venue: 'Salle du Lieu Réel', city: 'Villelieu',
      address: '12 rue du Lieu Réel', postal_code: '30200', cp: '75011', contract_type: 'Cession', fee_ht: 6000, vat: 5.5, fee_ttc: 6330, acompte_pct: 50, payments: [],
      structure: { name: 'Structure Organisatrice', address: '1 avenue du Siège', postal_code: '75011', city: 'Paris' }, fiche: {}, submitted_at: null, locked: false }
    // décision du 07/11/2026 : date sans adresse propre — adresse de la structure reprise seulement si venue_is_structure (case cochée)
    : ['jeton-fiche-lieu-00002', 'jeton-fiche-lieu-00003'].includes(a.p_token) ? { artist: 'Artiste Alpha', date: inYear('06-17'), date_label: 'date de test', venue: 'Salle Sans Adresse', city: null, department: null,
      address: null, postal_code: null, venue_is_structure: a.p_token === 'jeton-fiche-lieu-00003', cp: a.p_token === 'jeton-fiche-lieu-00003' ? '75' : null, contract_type: 'Cession', fee_ht: 6000, vat: 5.5, fee_ttc: 6330, acompte_pct: 50, payments: [],
      structure: { name: 'Structure Organisatrice', address: '1 avenue du Siège', postal_code: '75011', city: 'Paris', admin: { address: '1 avenue du Siège', postal_code: '75011' } }, fiche: {}, submitted_at: null, locked: false }
    : a.p_token === 'jeton-fiche-test-0001' ? { artist: 'Artiste Alpha', date: inYear('06-15'), date_label: 'date de test', venue: 'Festival Fictif', city: 'Bourg-Test',
      contract_type: 'Cession', fee_ht: 6000, vat: 5.5, fee_ttc: 6330, acompte_pct: 50, payments: [{ label: 'Acompte', kind: 'acompte', pct: 50, ht: 3000 }, { label: 'Solde', kind: 'solde', pct: 50, ht: 3000 }],
      structure: { name: 'Festival Fictif' }, fiche: {}, submitted_at: null, locked: false } : null,
    rh_get: a => a.p_token === 'jeton-rh-test-00000001' ? { first_name: 'Dominique', last_name: 'EXEMPLE', email: 'dominique@example.com', info: {}, docs: [], submitted_at: null } : null,
    artist_get: a => a.p_token === 'jeton-artiste-test-0001' ? { name: 'Artiste Alpha', info: {}, docs: [], submitted_at: null }
      // v1.60 : structure administrative liée (référence) — données fictives
      : a.p_token === 'jeton-artiste-admin-01' ? { name: 'Artiste Gamma', info: { adm_city: 'Ancienneville' }, docs: [], submitted_at: null,
          admin: { legal_name: 'ASSOCIATION FICTIVE', siret: '00000000000000', city: 'Villefictive', vat_subject: 'Non' } } : null,
  };

  window.supabase = {
    // Adresse du projet demandée par la page (production ou test) : relevée, jamais contactée (lot S0-R8)
    createClient(url) {
      (window.__clientUrls ||= []).push(String(url));
      return {
        from: table => builder(table, String(url)),
        // window.__RPC_ERROR = { nom: {code, message} } : la fonction de la base répond par cette erreur (fonction absente, refus…)
        rpc: async (name, args) => { window.__calls.push({ rpc: name, args, url: String(url) }); const e = window.__RPC_ERROR && window.__RPC_ERROR[name];
          if (e) return { data: null, error: e };
          // (v1.66.5) refus d'une fonction (exception levée par sa garde) : rendu comme la base, en erreur avec son code
          const f = RPC[name]; try { return { data: f ? clone(f(args || {})) : null, error: null }; } catch (err) { if (!err?.code) throw err; return { data: null, error: { code: err.code, message: err.message } }; } },
        // window.__FN_ERROR = { nom: 'message' } : la fonction serveur répond par cette erreur (essais de la file des résumés IA)
        functions: { invoke: async (name, o) => { window.__calls.push({ fn: name, body: o && o.body, url: String(url) });
          const err = window.__FN_ERROR && window.__FN_ERROR[name];
          // window.__FN_DATA = { nom: réponse | (body) => réponse } : réponse simulée de la fonction serveur (agendas des artistes…)
          const d = window.__FN_DATA && window.__FN_DATA[name];
          if (!err && d) return { data: clone(typeof d === 'function' ? d(o && o.body) : d), error: null };
          // window.__FN_REPLY = { nom: corps => réponse } : réponse simulée d'une fonction serveur (messagerie v1.61 : script-google, mail-sync)
          const rep = window.__FN_REPLY && window.__FN_REPLY[name];
          return err ? { data: null, error: { message: err } } : { data: rep ? clone(await rep(o && o.body)) : { ok: true }, error: null }; } },
        storage: { from: bucket => ({ upload: async () => ({ data: {}, error: null }),
          // fichiers effacés notés dans window.__calls ({ storageRemove: bucket, paths }) pour vérifier qu'aucun fichier ne reste orphelin
          remove: async paths => { window.__calls.push({ storageRemove: bucket, paths: [...paths] }); return { data: [], error: null }; },
          // liens temporaires notés à part (window.__signed : stockage, chemin, durée) — messagerie v1.63 : pièces jointes des projets
          createSignedUrl: async (path, expires) => { (window.__signed ||= []).push({ bucket, path, expires }); return { data: { signedUrl: 'about:blank#' + bucket + '/' + path }, error: null }; },
          // window.__STORAGE_LIST = { bucket: [{name, metadata: {size}}] } : contenu simulé d'un dossier (tailles des documents)
          list: async () => ({ data: (window.__STORAGE_LIST && window.__STORAGE_LIST[bucket]) || [], error: null }),
          // window.__STORED = { 'bucket/chemin': contenu texte } : fichier stocké lisible (v1.65 : .eml lu en entier) ; absent → erreur
          download: async path => { const t = (window.__STORED || {})[bucket + '/' + path];
            return t == null ? { data: null, error: { message: 'Object not found' } } : { data: new Blob([Uint8Array.from(t, c => c.charCodeAt(0) & 255)]), error: null }; },
          createSignedUrls: async p => ({ data: p.map(() => ({ signedUrl: 'about:blank' })), error: null }) }) },
        channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe: async () => 'ok' }; return c; },
        removeChannel: async () => 'ok',
        auth: {
          getSession: async () => ({ data: { session: window.__NO_SESSION ? null : { user: { email: USER } } } }),
          onAuthStateChange: cb => { window.__AUTH_CB = cb; return { data: { subscription: { unsubscribe() {} } } }; },   // window.__AUTH_CB(ev, session) : événement simulé
          signOut: async () => ({ error: null }), signInWithPassword: async () => ({ data: {}, error: null }), signInWithOtp: async () => ({ error: null }),
        },
      };
    },
  };
})();
