/**
 * Texte intégral d'un mail, SANS l'historique cité des échanges précédents (v1.66, demande d'Anthony du 20/11/2026).
 * Une seule règle pour tout le journal des suivis : mails synchronisés (HTML lu dans Gmail), mails importés (.eml, Apple Mail).
 * (Les mails envoyés depuis MATRICE gardent leur HTML : il ne contient jamais le message d'origine, ajouté par le script à l'envoi.)
 *
 * Principe : on ne retire QUE ce qui est clairement une citation ; en cas de doute, le passage est GARDÉ (rien du message n'est coupé).
 *  - HTML : blocs cités marqués par le logiciel de mail — Gmail (.gmail_quote dont l'attribution dit « a écrit / wrote »), Apple Mail
 *    et Thunderbird (blockquote type="cite"), Outlook web (#divRplyFwdMsg et ce qui suit), Yahoo (.yahoo_quoted) ;
 *  - texte : attribution « Le … a écrit : » / « On … wrote: » suivie UNIQUEMENT de lignes « > » ; en-tête Outlook complet
 *    (« De : », « Envoyé : » ou « Date : », « À : », « Objet : », en lignes consécutives) ; « -----Original Message----- » ;
 *    bloc final de lignes toutes « > » ; attribution restée seule en fin de message (son bloc cité vient d'être retiré).
 *  - jamais retirés : messages transférés (« Message transféré », « Forwarded message »), réponses intercalées (texte après
 *    des lignes « > »), signature, texte propre au message, sans limite de longueur.
 * Résultat vide (le message n'était qu'une citation ?) : le texte entier est rendu, jamais rien.
 * Aucun réseau, aucune écriture : DOMParser (document inerte, aucun script exécuté, aucune image chargée).
 */

const ATTRIB = /^(?:Le|On)\s.{3,400}?(?:a\s+écrit|wrote)\s*:\s*$/i;
const FORWARD = /(?:message\s+transféré|forwarded\s+message|message\s+d['’]origine\s+transféré|début\s+du\s+message\s+réexpédié|begin\s+forwarded\s+message)/i;
const ORIGINAL = /^-{2,}\s*(?:original\s+message|message\s+d['’]origine)\s*-{2,}\s*$/i;
const HEAD = [/^(?:De|From)\s*:/i, /^(?:Envoyé|Sent|Date)\s*:/i, /^(?:À|A|To)\s*:/i, /^(?:Objet|Subject)\s*:/i];
const HEAD_ANY = /^(?:De|From|Envoyé|Sent|Date|À|A|To|Cc|Objet|Subject)\s*:/i;

/** HTML → texte lisible (blocs et retours à la ligne conservés) */
function htmlText(root){
  const BLOCK = /^(P|DIV|LI|TR|H[1-6]|BLOCKQUOTE|PRE|TABLE|UL|OL|SECTION|ARTICLE|HEADER|FOOTER|ADDRESS)$/;
  let out = '';
  const walk = n => {
    if (n.nodeType === 3){ out += n.nodeValue.replace(/[ \t\r\n]+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (/^(STYLE|SCRIPT|HEAD|TITLE|META|LINK|TEMPLATE|NOSCRIPT)$/.test(tag)) return;
    if (tag === 'BR'){ out += '\n'; return; }
    if (tag === 'PRE'){ out += '\n' + n.textContent + '\n'; return; }
    const block = BLOCK.test(tag);
    if (block) out += '\n';
    if (tag === 'LI') out += '- ';
    for (const c of n.childNodes) walk(c);
    if (block) out += '\n';
    if (tag === 'TD' || tag === 'TH') out += ' ';
  };
  walk(root);
  return out;
}

/** Retire du document les blocs cités clairement marqués (jamais un transfert) */
function dropQuotedHtml(doc){
  const isForward = el => FORWARD.test((el.textContent || '').slice(0, 400));
  // Gmail : .gmail_quote = attribution (.gmail_attr « a écrit / wrote ») + blockquote ; un transfert utilise le même bloc : gardé
  for (const q of [...doc.querySelectorAll('.gmail_quote, .gmail_quote_container')]){
    if (!q.isConnected || isForward(q)) continue;
    const attr = q.querySelector('.gmail_attr');
    if ((attr && /(a\s+écrit|wrote)\s*:/i.test(attr.textContent || '')) || q.querySelector('blockquote')) q.remove();
  }
  // Apple Mail, Thunderbird : blockquote type="cite" ; Yahoo
  for (const q of [...doc.querySelectorAll('blockquote[type="cite"], .yahoo_quoted, .moz-cite-prefix')]) if (q.isConnected && !isForward(q)) q.remove();
  // Outlook web / mobile : #divRplyFwdMsg (en-tête du message d'origine) et tout ce qui le suit ; la ligne de séparation juste avant
  const rp = doc.querySelector('#divRplyFwdMsg, #appendonsend');
  if (rp && !isForward(rp)){
    let n = rp;
    while (n && n !== doc.body){
      const parent = n.parentNode;
      while (n.nextSibling) n.nextSibling.remove();
      if (n.previousElementSibling?.tagName === 'HR') n.previousElementSibling.remove();
      n.remove();
      n = parent;
      if (n && (n.textContent || '').trim()) break;   // ce qui précède dans le parent est le message : on s'arrête
    }
  }
}

/** Règles sur le texte (aussi pour un mail en texte brut) ; renvoie le texte propre au message */
function dropQuotedText(text){
  const lines = text.replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  const rest = i => lines.slice(i).filter(l => l.trim());
  let cut = lines.length;
  for (let i = 0; i < lines.length && cut === lines.length; i++){
    const l = lines[i].trim();
    if (!l) continue;
    if (FORWARD.test(l) && /^[-–—\s]*/.test(l)) break;                     // transfert : tout est gardé à partir d'ici
    if (ORIGINAL.test(l)){ cut = i; break; }
    // en-tête Outlook complet : « De : » puis, en lignes consécutives (vides tolérées), Envoyé/Date, À, Objet
    if (HEAD[0].test(l)){
      const block = []; for (let j = i; j < lines.length && block.length < 8; j++){ const t = lines[j].trim(); if (!t) continue; if (!HEAD_ANY.test(t)) break; block.push(t); }
      if (HEAD.every(re => block.some(t => re.test(t)))){ cut = i; break; }
    }
    // attribution (éventuellement sur deux lignes) suivie UNIQUEMENT de lignes « > » ou de rien
    const two = l + ' ' + (lines[i + 1] || '').trim();
    const att = ATTRIB.test(l) ? 1 : ATTRIB.test(two) ? 2 : 0;
    if (att){
      const after = rest(i + att);
      if (after.every(t => /^\s*>/.test(t))){ cut = i; break; }
    }
  }
  let keep = lines.slice(0, cut);
  // bloc final de lignes toutes « > » (citation en bas de message, sans attribution)
  let k = keep.length; while (k > 0 && !keep[k - 1].trim()) k--;
  let q = k; while (q > 0 && (/^\s*>/.test(keep[q - 1]) || !keep[q - 1].trim())) q--;
  if (q < k && keep.slice(q, k).some(t => /^\s*>/.test(t)) && keep.slice(0, q).some(t => t.trim())) keep = keep.slice(0, q);
  return keep.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Texte propre d'un mail : {html, plain} (l'un ou l'autre) → texte sans l'historique cité, ou '' si le mail n'a aucun texte.
 * Le HTML est préféré (les blocs cités y sont marqués) ; sinon le texte brut.
 */
export function ownText({html = '', plain = ''} = {}){
  let full = '', own = '';
  if (html && String(html).trim()){
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    full = htmlText(doc.body || doc.documentElement);
    dropQuotedHtml(doc);
    own = dropQuotedText(htmlText(doc.body || doc.documentElement));
  } else if (plain && String(plain).trim()){
    full = String(plain);
    own = dropQuotedText(full);
  }
  const clean = s => s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return own || clean(full);
}
