// Conversion d'une page Notion « Suivi » en : résumé, journal, fichiers, contenu restant.

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export function richText(rt = [], { users = {} } = {}) {
  return rt.map((t) => {
    let s;
    if (t.type === 'mention' && t.mention?.type === 'date') s = fmtDate(t.mention.date.start);
    else if (t.type === 'mention' && t.mention?.type === 'user') s = '@' + (users[t.mention.user.id] || t.mention.user.name || 'quelqu’un');
    else s = t.plain_text || '';
    if (!s.trim()) return s;
    const a = t.annotations || {};
    if (a.code) s = '`' + s + '`';
    if (a.bold) s = '**' + s.trim() + '**' + (s.endsWith(' ') ? ' ' : '');
    if (a.italic) s = '_' + s.trim() + '_';
    if (t.href && !s.includes(t.href)) s = `[${s}](${t.href})`;
    return s;
  }).join('');
}

const firstDate = (rt = []) => rt.find((t) => t.type === 'mention' && t.mention?.type === 'date')?.mention.date.start?.slice(0, 10) || null;
const plain = (rt = []) => rt.map((t) => t.plain_text || '').join('');

export function blocksToMd(blocks = [], depth = 0, ctx = {}) {
  const pad = '  '.repeat(depth);
  const out = [];
  let n = 0;
  for (const b of blocks) {
    const v = b[b.type] || {};
    const txt = richText(v.rich_text, ctx);
    const kids = b.children?.length ? blocksToMd(b.children, depth + 1, ctx) : '';
    if (b.type !== 'numbered_list_item') n = 0;
    switch (b.type) {
      case 'paragraph': out.push(txt ? pad + txt : ''); break;
      case 'heading_1': out.push(`# ${txt}`); break;
      case 'heading_2': out.push(`## ${txt}`); break;
      case 'heading_3': out.push(`### ${txt}`); break;
      case 'bulleted_list_item': out.push(`${pad}- ${txt}`); break;
      case 'numbered_list_item': out.push(`${pad}${++n}. ${txt}`); break;
      case 'to_do': out.push(`${pad}- [${v.checked ? 'x' : ' '}] ${txt}`); break;
      case 'quote': out.push(`${pad}> ${txt}`); break;
      case 'callout': out.push(`${pad}> ${txt}`); break;
      case 'toggle': out.push(`${pad}▸ ${txt}`); break;
      case 'code': out.push('```\n' + plain(v.rich_text) + '\n```'); break;
      case 'divider': out.push('---'); break;
      case 'child_page': out.push(`${pad}[Sous-page : ${v.title}]`); break;
      case 'bookmark': case 'link_preview': case 'embed': out.push(`${pad}${v.url || ''}`); break;
      default: if (txt) out.push(pad + txt);
    }
    if (kids) out.push(kids);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function logKind(title) {
  if (/📞|☎|appel|call/i.test(title)) return 'Appel';
  if (/✉|📧|📨|mail/i.test(title)) return 'Mail';
  if (/🤝|rdv|rendez|réunion|meeting/i.test(title)) return 'RDV';
  return 'Note';
}

const isFileBlock = (b) => ['file', 'pdf', 'image', 'video', 'audio'].includes(b.type);
export function fileInfo(b) {
  const v = b[b.type] || {};
  const url = v.type === 'external' ? v.external?.url : v.file?.url;
  let name = v.name || plain(v.caption) || '';
  if (!name && url) name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'fichier');
  return { id: b.id, url, name: name || 'fichier', external: v.type === 'external' };
}

/**
 * Découpe une page Suivi.
 * Retourne { summary, logs: [{date, kind, contact_name, body, key}], files: [{id,url,name}], content }
 */
export function splitSuivi(blocks, ctx = {}) {
  let summary = null;
  const logs = [];
  const files = [];
  const rest = [];
  let section = 'top';

  const collectFiles = (list) => list.forEach((b) => {
    if (isFileBlock(b)) files.push(fileInfo(b));
    if (b.children) collectFiles(b.children);
  });

  blocks.forEach((b, i) => {
    const v = b[b.type] || {};
    const title = plain(v.rich_text);
    if (b.type === 'callout' && /résumé|resume/i.test(title) && !/prompt/i.test(title)) {
      summary = blocksToMd(b.children || [], 0, ctx) || null;
      return;
    }
    if (b.type === 'callout' && /prompt/i.test(title)) return;          // prompt IA : ignoré
    if (/^heading_/.test(b.type)) {
      if (/journal|échange|echange|historique/i.test(title)) { section = 'journal'; return; }
      if (/pdf|pièce|piece|fichier|mail/i.test(title)) { section = 'files'; return; }
      section = 'other';
    }
    if (isFileBlock(b)) { files.push(fileInfo(b)); return; }
    if (b.children) collectFiles(b.children);
    if (b.type === 'toggle' && (section === 'journal' || firstDate(v.rich_text))) {
      const who = title.split(/—|–| - /).slice(1).join(' ').trim() || null;
      logs.push({
        key: b.id, date: firstDate(v.rich_text), kind: logKind(title),
        contact_name: who, body: blocksToMd((b.children || []).filter((c) => !isFileBlock(c)), 0, ctx) || null, sort: i,
      });
      return;
    }
    if (section === 'files' && b.type === 'bulleted_list_item' && /ajouter ici/i.test(title)) return; // consigne du modèle
    rest.push(b);
  });
  const content = blocksToMd(rest, 0, ctx).trim() || null;
  return { summary, logs, files, content };
}
