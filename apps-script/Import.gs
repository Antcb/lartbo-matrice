/**
 * Import unique Notion → Supabase (à lancer une fois, depuis l'éditeur Apps Script).
 *
 * Propriétés du script supplémentaires :
 *   NOTION_TOKEN   jeton de l'intégration interne Notion (secret_… ou ntn_…)
 *
 * Lancer `importNotion` : le script avance table par table et se relance tout seul
 * toutes les minutes tant qu'il n'a pas fini (limite de 6 min d'Apps Script).
 * Suivre l'avancement dans « Exécutions ». Relançable sans créer de doublons
 * (chaque ligne garde son identifiant Notion).
 */

var NOTION = {
  projects:   'cd62db2b-8fd1-4441-bc10-53ce0c58899d',
  structures: '27590285-6b86-8178-9708-000b8d88e579',
  contacts:   '7d0431a5-563c-402a-9ca1-be975b937ebf',
  shows:      '27590285-6b86-806e-a6d7-000b988c784d',
  prospects:  '30690285-6b86-80ef-8633-000b6053243a',
  tasks:      '25190285-6b86-8069-8bdc-000bddff9583'
};
var STEPS = ['projects', 'structures', 'contacts', 'shows', 'prospects', 'tasks', 'done'];
var TEAM = ['anthony@lartboristerie.com', 'production@lartboristerie.com'];
var CONFIRMED = ['Confirmée Salle', 'Confirmée Festival', 'Confirmée Artiste'];

function importNotion() {
  var sp = PropertiesService.getScriptProperties();
  var started = Date.now();
  var step = sp.getProperty('IMPORT_STEP') || 'projects';
  if (step === 'projects' && !sp.getProperty('IMPORT_CURSOR')) setSetting_('import_mode', 'true');

  while (step !== 'done') {
    var maps = loadMaps_(step);
    var cursor = sp.getProperty('IMPORT_CURSOR') || null;
    do {
      var res = notionQuery_(NOTION[step], cursor);
      var pages = res.results || [];
      if (pages.length) IMPORTERS[step](pages, maps);
      cursor = res.has_more ? res.next_cursor : null;
      sp.setProperty('IMPORT_CURSOR', cursor || '');
      Logger.log(step + ' : +' + pages.length);
      if (Date.now() - started > 4.5 * 60 * 1000 && cursor) return scheduleNext_();
    } while (cursor);
    step = STEPS[STEPS.indexOf(step) + 1];
    sp.setProperty('IMPORT_STEP', step);
    sp.deleteProperty('IMPORT_CURSOR');
    if (Date.now() - started > 4 * 60 * 1000 && step !== 'done') return scheduleNext_();
  }
  setSetting_('import_mode', 'false');
  clearTriggers_();
  Logger.log('Import terminé ✔');
}

/** Pour tout recommencer depuis le début (sans doublons). */
function resetImport() {
  var sp = PropertiesService.getScriptProperties();
  sp.deleteProperty('IMPORT_STEP'); sp.deleteProperty('IMPORT_CURSOR');
  clearTriggers_();
}

function scheduleNext_() {
  clearTriggers_();
  ScriptApp.newTrigger('importNotion').timeBased().after(60 * 1000).create();
  Logger.log('Pause : reprise automatique dans 1 min');
}
function clearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importNotion') ScriptApp.deleteTrigger(t);
  });
}

// ─────────────── Importeurs par table ───────────────

var IMPORTERS = {
  projects: function (pages) {
    upsert_('projects', pages.map(function (p) {
      var status = val_(p, 'Status');
      return { notion_id: p.id, name: val_(p, 'Nom du projet') || 'Sans nom', status: status, active: status !== 'Done' };
    }));
  },

  structures: function (pages) {
    upsert_('structures', pages.map(function (p) {
      var place = place_(p, 'Adresse');
      var cp = val_(p, 'Code Postal');
      return {
        notion_id: p.id,
        name: val_(p, 'Structure') || 'Sans nom',
        tags: val_(p, 'Tag') || [],
        address: place ? place.address : null,
        lat: place ? place.lat : null, lng: place ? place.lng : null,
        postal_code: cp == null ? null : String(cp),
        city: val_(p, 'Ville'), region: val_(p, 'Région'), country: val_(p, 'Pays'),
        capacity_1: int_(val_(p, 'Jauge 1')), capacity_2: int_(val_(p, 'Jauge 2')),
        pricing: val_(p, 'Payant'), website: val_(p, 'Website')
      };
    }));
  },

  contacts: function (pages, maps) {
    var rows = pages.map(function (p) {
      var first = val_(p, 'Prénom'), last = val_(p, 'Nom');
      return {
        notion_id: p.id,
        display_name: val_(p, 'Nom du client') || [first, last].filter(Boolean).join(' ') || val_(p, 'Mail') || 'Sans nom',
        first_name: first, last_name: last,
        email: val_(p, 'Mail'), email_2: val_(p, 'Mail 2'),
        phone: val_(p, 'Téléphone'), phone_2: val_(p, 'Téléphone 2'),
        roles: val_(p, 'Poste') || []
      };
    });
    var saved = upsert_('contacts', rows);
    var idByNotion = {};
    saved.forEach(function (r) { idByNotion[r.notion_id] = r.id; });
    var links = [];
    pages.forEach(function (p) {
      (val_(p, 'Structures') || []).forEach(function (sid) {
        var s = maps.structures[sid];
        if (s && idByNotion[p.id]) links.push({ contact_id: idByNotion[p.id], structure_id: s });
      });
    });
    if (links.length) upsert_('contact_structures', links, 'contact_id,structure_id', true);
  },

  shows: function (pages, maps) {
    var pyrprod = maps.partners['Pyrprod'];
    var rows = pages.map(function (p) {
      var place = place_(p, 'Ville');
      var d = dateRange_(p, 'Date');
      var status = val_(p, 'Status') || 'Booking';
      var hasPyr = !!(val_(p, 'N° Facture Pyrprod') || dateRange_(p, 'Facture Pyrprod Envoyée').start);
      return {
        notion_id: p.id,
        venue: (val_(p, 'Festival/Salle') || 'Sans nom').replace(/\*\*/g, '').trim(),
        project_id: maps.projects[first_(val_(p, 'Projects'))] || null,
        structure_id: maps.structures[first_(val_(p, 'Structures'))] || null,
        date: d.start, date_end: d.end,
        city: place && place.name ? place.name.split(',')[0].trim() : null,
        lat: place ? place.lat : null, lng: place ? place.lng : null,
        department: val_(p, 'Département'),
        status: status,
        contract_type: val_(p, 'Type de Contrat'),
        ticketing_type: val_(p, 'Billetterie'),
        fee_ht: val_(p, 'Cachet HT'),
        partner_id: hasPyr ? pyrprod : null,
        conf_kit_sent: dateRange_(p, 'Conf + FT + kit promo').start,
        contract_sent: dateRange_(p, 'Contrat envoyé').start,
        contract_signed: dateRange_(p, 'Contrat Signé').start,
        contract_cosigned_sent: dateRange_(p, 'Contrat Co-Signé Envoyé').start,
        boucle_tech: dateRange_(p, 'Boucle Technique').start,
        boucle_com: dateRange_(p, 'Boucle Communication').start,
        poster_request_date: dateRange_(p, 'Date de la demande').start,
        poster_status: val_(p, 'Suivi Affiche'),
        poster_a3: int_(val_(p, 'A3')), poster_a2: int_(val_(p, 'A2')), poster_b1: int_(val_(p, 'B1')),
        poster_contact_id: maps.contacts[first_(val_(p, 'Référent Affiche'))] || null,
        poster_delivery: val_(p, 'Livraison affiche'),
        capacity: int_(val_(p, 'Capacity')), comps: int_(val_(p, 'break')), tickets_sold: int_(val_(p, 'Tickets Sold')),
        ticketing_url: val_(p, 'Lien Billetterie'), instagram_url: val_(p, 'Liens Insta'), facebook_url: val_(p, 'Liens Facebook'),
        ticketing_enabled: ['Production', 'Co-Production', 'Co-Réalisation'].indexOf(val_(p, 'Type de Contrat')) >= 0 && CONFIRMED.indexOf(status) >= 0,
        communication_enabled: val_(p, 'Suivi Affiche') !== 'Non concerné'
      };
    });
    var saved = upsert_('shows', rows);
    var idByNotion = {};
    saved.forEach(function (r) { idByNotion[r.notion_id] = r.id; });

    // Lignes financières des dates confirmées
    var pays = [];
    pages.forEach(function (p) {
      var sid = idByNotion[p.id];
      if (!sid || CONFIRMED.indexOf(val_(p, 'Status')) < 0) return;
      function line(kind, label, sort, amount, num, sent, paid, pct, declared) {
        pays.push({ import_key: p.id + ':' + kind, show_id: sid, kind: kind, label: label, sort: sort,
          amount: amount == null ? null : amount, pct: pct == null ? null : pct, invoice_number: num || null,
          sent_at: sent || null, paid_at: paid || null, declared_at: declared || null });
      }
      line('acompte', 'Acompte', 10, val_(p, 'Facture Acompte réelle'), val_(p, 'N° Acompte'),
        dateRange_(p, 'Acompte Envoyé').start, dateRange_(p, 'Acompte Payé').start, 20);
      line('solde', 'Solde', 20, val_(p, 'Montant Solde réel'), val_(p, 'N° Facture de Solde'),
        dateRange_(p, 'Facture de Solde Envoyée').start, dateRange_(p, 'Facture de Solde Payée').start, 80);
      line('artbo', "Commission L'ArtBo", 30, null, val_(p, "N° Facture L'ArtBo"),
        dateRange_(p, "Facture L'ArtBo Envoyée").start, dateRange_(p, "Facture L'ArtBo Payée").start);
      if (val_(p, 'N° Facture Pyrprod') || dateRange_(p, 'Facture Pyrprod Envoyée').start) {
        line('partner', 'Commission Pyrprod', 40, null, val_(p, 'N° Facture Pyrprod'),
          dateRange_(p, 'Facture Pyrprod Envoyée').start, dateRange_(p, 'Facture Pyrprod Payée').start);
      }
      if (val_(p, 'Montant Taxe') || dateRange_(p, 'Date Déclaration').start) {
        line('cnm', 'Taxe CNM', 50, val_(p, 'Montant Taxe'), null, null, null, null, dateRange_(p, 'Date Déclaration').start);
      }
    });
    if (pays.length) upsert_('show_payments', pays, 'import_key');
  },

  prospects: function (pages, maps) {
    var allowed = ['Mailed', 'Interest', 'Option', 'Confirmed', 'Closed'];
    upsert_('prospects', pages.map(function (p) {
      var st = val_(p, 'Status');
      return {
        notion_id: p.id, name: val_(p, 'Nom') || 'Sans nom',
        status: allowed.indexOf(st) >= 0 ? st : 'Mailed',
        structure_id: maps.structures[first_(val_(p, 'Structure'))] || null,
        contact_id: maps.contacts[first_(val_(p, 'Clients'))] || null,
        project_id: maps.projects[first_(val_(p, 'Projects'))] || null,
        last_contact: (p.last_edited_time || '').substring(0, 10) || null
      };
    }));
  },

  tasks: function (pages, maps) {
    upsert_('tasks', pages.map(function (p) {
      var who = (val_(p, 'Assigned to') || []).filter(function (e) { return TEAM.indexOf(e) >= 0; })[0] || null;
      var st = val_(p, 'Status');
      return {
        notion_id: p.id, title: val_(p, 'Title') || 'Sans titre',
        status: ['To Do', 'In Progress', 'Done', 'Cancelled'].indexOf(st) >= 0 ? st : 'To Do',
        priority: val_(p, 'Priority'), deadline: dateRange_(p, 'Deadline').start,
        department: val_(p, 'Department'), tags: val_(p, 'Tags') || [],
        assigned_to: who,
        project_id: maps.projects[first_(val_(p, 'Projects'))] || null,
        structure_id: maps.structures[first_(val_(p, 'Structures'))] || null,
        notes: val_(p, 'Files'),
        done_at: dateRange_(p, 'Done Time').start
      };
    }));
  }
};

// Tables de correspondance identifiant Notion → identifiant Supabase
function loadMaps_(step) {
  var need = { contacts: ['structures'], shows: ['projects', 'structures', 'contacts', 'partners'],
               prospects: ['projects', 'structures', 'contacts'], tasks: ['projects', 'structures'] }[step] || [];
  var maps = {};
  need.forEach(function (t) {
    maps[t] = {};
    var key = t === 'partners' ? 'name' : 'notion_id';
    var from = 0;
    while (true) {
      var rows = sbRange_(t + '?select=id,' + key, from, from + 999);
      rows.forEach(function (r) { if (r[key]) maps[t][r[key]] = r.id; });
      if (rows.length < 1000) break;
      from += 1000;
    }
  });
  return maps;
}

// ─────────────── Notion ───────────────

function notionQuery_(dataSourceId, cursor) {
  var body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  for (var attempt = 0; attempt < 5; attempt++) {
    var res = UrlFetchApp.fetch('https://api.notion.com/v1/data_sources/' + dataSourceId + '/query', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + props_().NOTION_TOKEN, 'Notion-Version': '2025-09-03' },
      payload: JSON.stringify(body)
    });
    var code = res.getResponseCode();
    if (code === 429 || code >= 500) { Utilities.sleep(1500 * (attempt + 1)); continue; }
    if (code >= 300) throw new Error('Notion ' + code + ' : ' + res.getContentText());
    Utilities.sleep(350); // ~3 requêtes/s max
    return JSON.parse(res.getContentText());
  }
  throw new Error('Notion indisponible après 5 essais');
}

function prop_(page, name) { return page.properties ? page.properties[name] : null; }

/** Valeur "simple" d'une propriété Notion, quel que soit son type. */
function val_(page, name) {
  var p = prop_(page, name);
  if (!p) return null;
  switch (p.type) {
    case 'title': case 'rich_text':
      var t = (p[p.type] || []).map(function (x) { return x.plain_text; }).join('').trim();
      return t || null;
    case 'number': return p.number;
    case 'select': return p.select ? p.select.name : null;
    case 'status': return p.status ? p.status.name : null;
    case 'multi_select': return (p.multi_select || []).map(function (x) { return x.name; });
    case 'relation': return (p.relation || []).map(function (x) { return x.id; });
    case 'people': return (p.people || []).map(function (x) { return x.person && x.person.email ? x.person.email.toLowerCase() : null; }).filter(Boolean);
    case 'email': return p.email; case 'phone_number': return p.phone_number; case 'url': return p.url;
    case 'checkbox': return p.checkbox;
    case 'formula': var f = p.formula || {}; return f[f.type];
    case 'date': return p.date ? p.date.start : null;
    default: return null;
  }
}
function dateRange_(page, name) {
  var p = prop_(page, name);
  if (!p || p.type !== 'date' || !p.date) return { start: null, end: null };
  return { start: (p.date.start || '').substring(0, 10) || null, end: p.date.end ? p.date.end.substring(0, 10) : null };
}
function place_(page, name) {
  var p = prop_(page, name);
  if (!p) return null;
  var v = p.place || p[p.type];
  if (!v || typeof v !== 'object') return null;
  return {
    name: v.name || v.address || null, address: v.address || v.name || null,
    lat: v.lat != null ? v.lat : (v.latitude != null ? v.latitude : null),
    lng: v.lon != null ? v.lon : (v.lng != null ? v.lng : (v.longitude != null ? v.longitude : null))
  };
}
function first_(arr) { return arr && arr.length ? arr[0] : null; }
function int_(v) { return v == null || v === '' ? null : Math.round(Number(v)); }

// ─────────────── Supabase ───────────────

function upsert_(table, rows, onConflict, ignoreDuplicates) {
  var out = [];
  for (var i = 0; i < rows.length; i += 500) {
    var chunk = rows.slice(i, i + 500);
    var p = props_();
    var res = UrlFetchApp.fetch(p.SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=' + encodeURIComponent(onConflict || 'notion_id'), {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: {
        apikey: p.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + p.SUPABASE_SERVICE_KEY,
        Prefer: (ignoreDuplicates ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates') + ',return=representation'
      },
      payload: JSON.stringify(chunk)
    });
    if (res.getResponseCode() >= 300) throw new Error(table + ' : ' + res.getContentText().substring(0, 800));
    out = out.concat(JSON.parse(res.getContentText() || '[]'));
  }
  return out;
}

function sbRange_(path, from, to) {
  var p = props_();
  var res = UrlFetchApp.fetch(p.SUPABASE_URL + '/rest/v1/' + path, {
    muteHttpExceptions: true,
    headers: { apikey: p.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + p.SUPABASE_SERVICE_KEY, Range: from + '-' + to }
  });
  if (res.getResponseCode() >= 300) throw new Error(path + ' : ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

function setSetting_(key, value) {
  sb_('PATCH', 'settings?key=eq.' + key, { value: value });
}
