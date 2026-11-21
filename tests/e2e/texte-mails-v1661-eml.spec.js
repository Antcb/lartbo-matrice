// v1.66.1 (relecture du 21/11/2026) : de vrais mails à deux parties (texte + HTML) passent par parseEml puis emlEntry, comme dans l’application ;
// la partie texte (ancien résumé) diffère du HTML par ses liens, images de signature, téléphones, guillemets et puces.
import { expect, test } from '@playwright/test';
import { openApp } from './helpers.js';
const alt = (plain, html, extra = '') => `From: Marie Prog <marie@salle-fictive.fr>\r\nTo: anthony@example.com\r\nSubject: Re: Date du 12 mars\r\nDate: Mon, 16 Nov 2026 10:00:00 +0100\r\nMessage-ID: <z1@salle-fictive.fr>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="B"\r\n\r\n--B\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n${extra}\r\n${plain}\r\n--B\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n--B--\r\n`;
const CASES = {
  gmail_image_liens: alt(
`Bonjour Anthony,

OK pour le 12 mars. Voici la fiche technique
<https://drive.google.com/fiche> et le rider. La balance est prévue à 16h, le
concert à 21h, merci de confirmer l’horaire d’arrivée de l’équipe technique.

   - Catering pour 6
   - Parking : 2 places

Bien à toi,
--
*Marie Prog*
Programmatrice
[image: logo salle]
https://salle-fictive.fr
06 00 00 00 00 <+33600000000>

Le lun. 9 nov. 2026 à 10:00, Anthony <anthony@example.com> a écrit :
> vieux`,
`<div dir="ltr">Bonjour Anthony,<div><br></div><div>OK pour le 12 mars. Voici la <a href="https://drive.google.com/fiche">fiche technique</a> et le rider. La balance est prévue à 16h, le concert à 21h, merci de confirmer l’horaire d’arrivée de l’équipe technique.</div><div><br></div><ul><li>Catering pour 6</li><li>Parking : 2 places</li></ul><div>Bien à toi,</div><div>-- <br><div class="gmail_signature"><b>Marie Prog</b><br>Programmatrice<br><img src="cid:logo" alt="logo salle"><br><a href="https://salle-fictive.fr">https://salle-fictive.fr</a><br><a href="tel:+33600000000">06 00 00 00 00</a></div></div></div><br><div class="gmail_quote"><div class="gmail_attr">Le lun. 9 nov. 2026 à 10:00, Anthony &lt;anthony@example.com&gt; a écrit :<br></div><blockquote class="gmail_quote">vieux</blockquote></div>`),
  apple_flowed: alt(
`Salut Anthony,

Je confirme : 1 500 € HT pour la date du 12, avec l’hébergement pris en =
charge.

Marie
`.replace(' =\n', ' '),
`<html><body><div>Salut Anthony,</div><div><br></div><div>Je confirme&nbsp;: 1&nbsp;500&nbsp;€ HT pour la date du 12, avec l’hébergement pris en charge.</div><div><br></div><div>Marie</div></body></html>`, ''),
  outlook_cid_table: alt(
`Bonjour,

Merci pour votre message. Nous confirmons la date du 12 mars.

Cordialement,

Marie Prog
[cid:image001.png@01DB1234.56789AB0]
Salle Fictive\t|\t12 rue X\t|\tParis
www.salle-fictive.fr<https://www.salle-fictive.fr/>
`,
`<div class="WordSection1"><p class="MsoNormal">Bonjour,</p><p class="MsoNormal">Merci pour votre message. Nous confirmons la date du 12 mars.</p><p class="MsoNormal">Cordialement,</p><p class="MsoNormal">Marie Prog</p><p><img src="cid:image001.png@01DB1234.56789AB0"></p><table><tr><td>Salle Fictive</td><td>|</td><td>12 rue X</td><td>|</td><td>Paris</td></tr></table><p><a href="https://www.salle-fictive.fr/">www.salle-fictive.fr</a></p></div>`),
  guillemets: alt(
`Bonjour,
On garde "la formule" habituelle - comme d'habitude.
Marie`,
`<div>Bonjour,</div><div>On garde « la formule » habituelle – comme d’habitude.</div><div>Marie</div>`),
};
test('v1.66.1 mails reconstitués (Gmail, Apple Mail, Outlook, guillemets) → entrée du journal de l’application → aucune note fantôme, vraie note toujours affichée', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(async (CASES) => {
    const { parseEml } = await import('./js/eml.js');
    const { emlEntry } = await import('./js/data.js');
    const { manualNote } = await import('./js/textes-journal.js');
    const bytes = s => Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join('');
    const r = {};
    for (const [k, raw] of Object.entries(CASES)){
      const m = parseEml(bytes(raw));
      const body = emlEntry('pr-1', m).row.body;
      r[k] = { sans: manualNote({author: 'anthony@example.com', body}, m.full),
               note: manualNote({author: 'anthony@example.com', body: body + '\n\nRappeler Marie lundi'}, m.full),
               lien: manualNote({author: 'anthony@example.com', body: body + '\n\n<https://docs.google.com/contrat>'}, m.full),
               full: m.full.slice(0, 120), text: m.text.slice(0, 120) };
    }
    return r;
  }, CASES);
  for (const [k, v] of Object.entries(out)){
    expect(v.sans, k).toBe('');                                      // l'ancien résumé n'est jamais répété en « Note »
    expect(v.note, k).toBe('Rappeler Marie lundi');                  // une vraie note est toujours affichée, seule
    expect(v.lien, k).toBe('<https://docs.google.com/contrat>');     // un lien noté à la main n'est jamais caché (relecture B7)
  }
});
