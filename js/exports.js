/**
 * 📤 Exports à envoyer aux partenaires : fichier Excel aux couleurs de L'ArtBoristerie (logo, titre, en-têtes),
 * ou CSV brut. Un CSV ne peut pas contenir d'image : le logo n'existe que dans la version Excel (.xlsx),
 * qui s'ouvre aussi dans Numbers et Google Sheets.
 */
import { STATUSES, isOff } from './constants.js';
import { projName, structName } from './selectors.js';
import { S } from './state.js';
import { openModal } from './ui/modal.js';
import { downloadCSV, toast, today } from './utils.js';

const BRAND = 'FF283C63', TINT = 'FFE8ECF3';
let EXCEL = null;
function loadExcel(){
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return EXCEL ||= new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    s.onload = () => ok(window.ExcelJS); s.onerror = () => { EXCEL = null; ko(new Error('Module Excel indisponible (connexion ?)')); };
    document.head.appendChild(s);
  });
}
async function logoBase64(){
  const blob = await (await fetch('assets/logo.png')).blob();
  return new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
}
const safe = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

/**
 * columns : [{header, key, width, type: 'text'|'date'|'eur'|'number'}] ; rows : objets {key: valeur}
 * format : 'xlsx' (avec logo) ou 'csv'
 */
export async function exportTable({name, title, subtitle = '', columns, rows, format = 'xlsx'}){
  const file = `${safe(name)}-${today()}`;
  if (format === 'csv'){
    const fmt = (c, v) => v == null ? '' : c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v;
    downloadCSV(file + '.csv', [columns.map(c => c.header), ...rows.map(r => columns.map(c => fmt(c, r[c.key])))]);
    return;
  }
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook(); wb.creator = "L'ArtBoristerie Productions"; wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), {views: [{state: 'frozen', ySplit: 6, showGridLines: false}],
    pageSetup: {orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0}});
  ws.columns = columns.map(c => ({key: c.key, width: c.width || 18}));
  // En-tête : logo, titre, sous-titre, date d'export
  try { const img = wb.addImage({base64: await logoBase64(), extension: 'png'}); ws.addImage(img, {tl: {col: 0, row: 0}, ext: {width: 136, height: 51}}); } catch {}
  const last = String.fromCharCode(64 + columns.length);
  ws.getRow(1).height = 24; ws.getRow(2).height = 18; ws.getRow(3).height = 18;
  // le titre commence à la première colonne libre à droite du logo (≈ 7 px par unité de largeur)
  let px = 0, ci = 0; while (ci < columns.length - 1 && px < 150){ px += (columns[ci].width || 18) * 7; ci++; }
  const tc = String.fromCharCode(65 + Math.max(ci, 1));
  ws.getCell(tc + '1').value = title; ws.getCell(tc + '1').font = {name: 'Geist', size: 16, bold: true, color: {argb: BRAND}};
  ws.getCell(tc + '2').value = subtitle; ws.getCell(tc + '2').font = {name: 'Geist', size: 11, color: {argb: 'FF5B677D'}};
  ws.getCell(tc + '3').value = `Export du ${new Date().toLocaleDateString('fr-FR')} · L'ArtBoristerie Productions · production@lartboristerie.com`;
  ws.getCell(tc + '3').font = {name: 'Geist', size: 9, color: {argb: 'FF8A94A6'}};
  // Ligne d'en-têtes
  const head = ws.getRow(6);
  columns.forEach((c, i) => { const cell = head.getCell(i + 1); cell.value = c.header;
    cell.font = {name: 'Geist', bold: true, color: {argb: 'FFFFFFFF'}}; cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: BRAND}};
    cell.alignment = {vertical: 'middle', wrapText: true}; cell.border = {bottom: {style: 'thin', color: {argb: BRAND}}}; });
  head.height = 30;
  rows.forEach((r, n) => {
    const row = ws.getRow(7 + n);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1); let v = r[c.key];
      if (c.type === 'date' && v && /^\d{4}-\d{2}-\d{2}$/.test(v)){ v = new Date(v + 'T12:00:00'); cell.numFmt = 'dd/mm/yyyy'; }
      if (c.type === 'eur' && v != null && v !== ''){ v = Number(v); cell.numFmt = '#,##0 €;-#,##0 €'; }
      if (c.type === 'number' && v != null && v !== '') v = Number(v);
      cell.value = v ?? null;
      cell.font = {name: 'Geist', size: 10};
      cell.alignment = {vertical: 'top', wrapText: c.type === 'text' || !c.type};
      if (n % 2) cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: TINT}};
      cell.border = {bottom: {style: 'hair', color: {argb: 'FFDCE1E8'}}};
    });
  });
  ws.autoFilter = {from: {row: 6, column: 1}, to: {row: 6 + rows.length, column: columns.length}};
  ws.headerFooter.oddFooter = `&L&8L'ArtBoristerie Productions&R&8Page &P / &N`;
  if (last > tc){ ws.mergeCells(`${tc}1:${last}1`); ws.mergeCells(`${tc}2:${last}2`); ws.mergeCells(`${tc}3:${last}3`); }
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  a.download = file + '.xlsx'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

export const FORMAT_FIELD = {k:'format', label:'Format', type:'select', blank:false, options:[['xlsx','Excel avec logo L’ArtBoristerie (.xlsx)'], ['csv','CSV brut (sans mise en forme)']]};

// ─────────────── Dates (Booking) ───────────────

export function exportShows(){
  const y = new Date().getFullYear();
  const years = [...new Set(S.db.shows.map(s => (s.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  if (!years.includes(String(y))) years.unshift(String(y));
  openModal({title: 'Exporter les dates', saveLabel: 'Télécharger',
    values: {project: S.project || '', mode: 'year', year: String(S.year || y), statuses: STATUSES.filter(st => !isOff(st)), price: true, format: 'xlsx'},
    fields: [
      {k:'project', label:'Artiste', type:'project', full:true},
      {k:'mode', label:'Période', type:'select', blank:false, options:[['year','Une année complète'], ['range','Des dates précises']]},
      {k:'year', label:'Année', type:'select', blank:false, options: years},
      {k:'from', label:'Du', type:'date'}, {k:'to', label:'Au', type:'date'},
      {k:'statuses', label:'Statuts', type:'checks', options: STATUSES.map(x => [x, x]), full:true},
      {k:'price', label:'Inclure les cachets', type:'checkbox'},
      FORMAT_FIELD,
    ],
    onSave: async v => {
      if (!v.project){ toast('Choisis un artiste', true); return false; }
      if (!v.statuses.length){ toast('Coche au moins un statut', true); return false; }
      const from = v.mode === 'year' ? `${v.year}-01-01` : v.from, to = v.mode === 'year' ? `${v.year}-12-31` : v.to;
      if (v.mode === 'range' && (!from || !to)){ toast('Indique le début et la fin de la période', true); return false; }
      const list = S.db.shows.filter(s => s.project_id === v.project && v.statuses.includes(s.status) && s.date && s.date >= from && s.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date));
      const artist = projName(v.project).replace(/\s*•.*$/, '');
      const columns = [
        {header:'Date', key:'date', type:'date', width:12}, {header:'Jour', key:'day', width:10}, {header:'Jusqu’au', key:'date_end', type:'date', width:12},
        {header:'Salle / festival', key:'venue', width:30}, {header:'Ville', key:'city', width:20}, {header:'Dépt / pays', key:'department', width:11},
        {header:'Structure', key:'structure', width:26}, {header:'Statut', key:'status', width:18}, {header:'Contrat', key:'contract_type', width:15},
        {header:'Jauge', key:'capacity', type:'number', width:9},
        ...(v.price ? [{header:'Cachet HT', key:'fee_ht', type:'eur', width:13}] : []),
      ];
      const rows = list.map(s => ({...s, venue: String(s.venue || '').replace(/\*\*/g, '').replace(/\s*•\s*[A-Z/]{1,5}\s*$/, ''),
        day: new Date(s.date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday: 'long'}), structure: structName(s.structure_id),
        date_end: s.date_end && s.date_end !== s.date ? s.date_end : ''}));
      const period = v.mode === 'year' ? `année ${v.year}` : `du ${from.split('-').reverse().join('/')} au ${to.split('-').reverse().join('/')}`;
      try { await exportTable({name: `dates-${artist}-${v.mode === 'year' ? v.year : from + '_' + to}`, title: `${artist} — Dates`,
        subtitle: `${list.length} date${list.length > 1 ? 's' : ''} · ${period}`, columns, rows, format: v.format}); }
      catch (err){ toast(err.message, true); return false; }
      toast(`${list.length} date(s) exportée(s)`);
    }});
  // Année ou dates précises : n'afficher que les champs utiles
  const dlg = document.querySelector('#modal');
  const sync = () => { const range = dlg.querySelector('[name=mode]').value === 'range';
    dlg.querySelector('[name=year]').closest('.field').hidden = range;
    ['from', 'to'].forEach(k => { const f = dlg.querySelector(`[name=${k}]`)?.closest('.field'); if (f) f.hidden = !range; }); };
  dlg.querySelector('[name=mode]').addEventListener('change', sync); sync();
}
