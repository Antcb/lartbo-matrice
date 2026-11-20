/**
 * Texte intégral d'un mail, SANS l'historique cité des échanges précédents (v1.66, demande d'Anthony du 20/11/2026).
 * Une seule règle pour tout le journal des suivis : mails synchronisés (HTML lu dans Gmail), mails importés (.eml, Apple Mail).
 * (Les mails envoyés depuis MATRICE gardent leur HTML : il ne contient jamais le message d'origine, ajouté par le script à l'envoi.)
 *
 * Principe : on ne retire QUE ce qui est clairement une citation ; en cas de doute, le passage est GARDÉ (rien du message n'est coupé).
 *  - HTML : blocs cités marqués par le logiciel de mail — Gmail (.gmail_quote dont l'attribution dit « a écrit / wrote »), Apple Mail
 *    et Thunderbird (blockquote type="cite"), Outlook web (#divRplyFwdMsg et ce qui suit), Yahoo (.yahoo_quoted) ;
 *  - texte : attribution datée « Le … a écrit : » / « On … wrote: » (date ou adresse dans la ligne) suivie UNIQUEMENT de lignes « > » ;
 *    en-tête Outlook complet (« De : », « Envoyé : » ou « Date : », « À : », « Objet : » en lignes consécutives) dont l'objet n'est
 *    pas un transfert ; « -----Original Message----- » ; attribution restée seule en fin de message (son bloc cité vient d'être retiré).
 *  - objet « TR: / Fwd: » : rien n'est retiré ; coupe Outlook annulée si les premières lignes annoncent explicitement un transfert
 *    (« je te transfère ») ou des réponses dans le texte (« mes réponses en rouge ci-dessous ») ;
 *  - jamais retirés (relecture v1.66) : messages transférés (« Message transféré », « Forwarded message », objet « TR: » / « Fwd: »),
 *    réponses intercalées (texte entre les blocs cités : Gmail, lignes « > »), lignes « > » sans attribution, signature, texte propre au message, sans limite de longueur.
 * Résultat vide (le message n'était qu'une citation ?) : le texte entier est rendu, jamais rien.
 * Aucun réseau, aucune écriture : DOMParser (document inerte, aucun script exécuté, aucune image chargée).
 */

// attribution d'un logiciel de mail : date (chiffre) ou adresse dans la ligne — « Le directeur a écrit : » n'en est pas une
const ATTRIB = /^(?:Le|On)\s(?=.*(?:\d|@|<)).{3,400}?(?:a\s+écrit|wrote)\s*:\s*$/i;
const FWD_SUBJECT = /^(?:Objet|Subject)\s*:\s*(?:TR|Tr|Fwd?|FW|Fw|WG)\s*:/i;
/** Annonce explicite, dans les premières lignes, d'un transfert (« je te transfère ») ou de réponses écrites DANS le message d'origine
 *  (« voir mes réponses en rouge ci-dessous ») : seule une coupe Outlook (en-tête identique pour réponse et transfert) est alors annulée.
 *  Tournures précises seulement (relecture v1.66, B4 : « transfert aéroport », « ci-dessous », « ne pas transférer » ne comptent pas) */
const ANNONCE = new RegExp([
  String.raw`\bje\s+(?:te|vous)\s+(?:transf[eè]re|fais\s+suivre|renvoie)\b`,
  String.raw`\bréponses?\b.{0,40}(?:ci-dessous|ci-après|en\s+(?:rouge|bleu|vert|couleur|gras)|dans\s+(?:le\s+texte|votre\s+(?:message|mail))|au\s+fil)`,
  String.raw`\b(?:see|find)\s+(?:my|our)\s+(?:answers|replies|comments)\b.{0,20}(?:below|inline|in\s+red)`,
  String.raw`\bforwarding\s+(?:you|this)\b`,
].join('|'), 'i');
const TR_SUBJECT = /^\s*(?:TR|Tr|Fwd?|FW|Fw|WG)\s*:/;
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
function dropQuotedHtml(doc, outlook = true){
  const isForward = el => FORWARD.test((el.textContent || '').slice(0, 400));
  // Gmail : .gmail_quote = attribution (.gmail_attr « a écrit / wrote ») + blockquote(s) ; seuls l'attribution et les blocs cités
  // sont retirés — une réponse intercalée entre deux blocs cités reste (relecture v1.66, B1) ; un transfert utilise le même bloc : gardé
  for (const q of [...doc.querySelectorAll('div.gmail_quote, div.gmail_quote_container')]){
    if (!q.isConnected || isForward(q)) continue;
    const attr = q.querySelector('.gmail_attr');
    if (!attr || !/(a\s+écrit|wrote)\s*:/i.test(attr.textContent || '')) continue;
    attr.remove();
    for (const b of [...q.querySelectorAll('blockquote')]) if (b.isConnected) b.remove();
  }
  // Apple Mail, Thunderbird : blockquote type="cite" ; Yahoo
  for (const q of [...doc.querySelectorAll('blockquote[type="cite"], .yahoo_quoted, .moz-cite-prefix')]) if (q.isConnected && !isForward(q)) q.remove();
  // Outlook web / mobile : #divRplyFwdMsg (en-tête du message d'origine) et tout ce qui le suit ; la ligne de séparation juste avant
  // (relecture v1.66, B2) l'en-tête sert aussi au transfert (« TR: ») : alors tout est gardé
  if (!outlook) return;
  const rp = doc.querySelector('#divRplyFwdMsg') || doc.querySelector('#appendonsend');
  const fwdHead = el => (el.textContent || '').split(/\n|(?=(?:Objet|Subject)\s*:)/).some(t => FWD_SUBJECT.test(t.trim()));
  if (rp && !isForward(rp) && !fwdHead(rp)){
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
function dropQuotedText(text, outlook = true){
  const lines = text.replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  const rest = i => lines.slice(i).filter(l => l.trim());
  let cut = lines.length;
  for (let i = 0; i < lines.length && cut === lines.length; i++){
    const l = lines[i].trim();
    if (!l) continue;
    if (FORWARD.test(l) && /^[-–—\s]*/.test(l)) break;                     // transfert : tout est gardé à partir d'ici
    if (outlook && ORIGINAL.test(l)){ cut = i; break; }
    // en-tête Outlook complet : « De : » puis, en lignes consécutives (vides tolérées), Envoyé/Date, À, Objet
    if (outlook && HEAD[0].test(l)){
      const block = []; for (let j = i; j < lines.length && block.length < 8; j++){ const t = lines[j].trim(); if (!t) continue; if (!HEAD_ANY.test(t)) break; block.push(t); }
      // en-tête d'un VRAI message : adresse dans « De : », ou année dans « Envoyé / Date : » (une feuille de route « De : Paris,
      // Date : 12/03, À : Lyon, Objet : … » n'en est pas un) ; objet « TR: / Fwd: » = transfert : gardé
      const real = block.some(t => /^(?:De|From)\s*:.*[@<]/i.test(t)) || block.some(t => /^(?:Envoyé|Sent|Date)\s*:.*\b(19|20)\d\d\b/i.test(t));
      if (real && HEAD.every(re => block.some(t => re.test(t)))){ if (block.some(t => FWD_SUBJECT.test(t))) break; cut = i; break; }
    }
    // attribution (éventuellement sur deux lignes) suivie UNIQUEMENT de lignes « > » ou de rien
    const two = l + ' ' + (lines[i + 1] || '').trim();
    const att = ATTRIB.test(l) ? 1 : ATTRIB.test(two) ? 2 : 0;
    if (att){
      const after = rest(i + att);
      if (after.every(t => /^\s*>/.test(t))){ cut = i; break; }
    }
  }
  // (relecture v1.66, B3) des lignes « > » sans attribution reconnue ne sont jamais retirées (doute : gardées)
  const keep = lines.slice(0, cut);
  return keep.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Texte propre d'un mail : {html, plain} (l'un ou l'autre), subject (objet du mail : « TR: » = transfert, tout gardé) → texte sans l'historique cité, ou '' si le mail n'a aucun texte.
 * Le HTML est préféré (les blocs cités y sont marqués) ; sinon le texte brut.
 */
export function ownText({html = '', plain = '', subject = ''} = {}){
  // own : toutes les règles ; base : sans les coupes Outlook (blocs cités Gmail, Apple Mail, Thunderbird, Yahoo, lignes « > » seulement)
  let full = '', own = '', base = '';
  if (html && String(html).trim()){
    const parse = () => new DOMParser().parseFromString(String(html), 'text/html');
    const d1 = parse(), d2 = parse();
    full = htmlText(d1.body || d1.documentElement);
    dropQuotedHtml(d1, true);  own = dropQuotedText(htmlText(d1.body || d1.documentElement), true);
    dropQuotedHtml(d2, false); base = dropQuotedText(htmlText(d2.body || d2.documentElement), false);
  } else if (plain && String(plain).trim()){
    full = String(plain);
    own = dropQuotedText(full, true); base = dropQuotedText(full, false);
  }
  const clean = s => s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // coupe Outlook (en-tête identique pour une réponse et un transfert) annulée si le mail est un transfert (objet « TR: / Fwd: ») ou
  // l'annonce explicitement dans ses premières lignes (« je te transfère », « mes réponses en rouge ci-dessous ») : le contenu suivant
  // EST le message. Les blocs cités marqués par Gmail / Apple Mail restent retirés (relecture v1.66, B4).
  const head = own.split('\n').filter(t => t.trim()).slice(0, 5).join('\n');
  // objet « TR: / Fwd: » (pas « RE: TR: ») : le mail EST un transfert, tout ce qu'il contient est gardé, quel que soit le logiciel
  if (own && TR_SUBJECT.test(subject) && own !== clean(full)) return clean(full);
  if (own && base && own !== base && ANNONCE.test(head)) return base;
  return own || base || clean(full);
}
