// Règles des agendas des artistes (décisions d'Anthony du 06/11/2026), sans réseau ni base : testées par
// tests/static/agendas-regles.mjs (fausses réponses du service de lieux).

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** « Show » : le MOT entier, sans tenir compte de la casse, y compris entre crochets ou suivi d'une ponctuation ;
 *  jamais « Showroom », « Slideshow », « Showcase »… */
export const isShowTitle = (title: string | null | undefined) => !!title && /(^|[^\p{L}\p{N}])show(?![\p{L}\p{N}])/iu.test(title);

export const COUNTRIES: Record<string, string> = { france: 'FR', belgique: 'BE', suisse: 'CH', espagne: 'ES', italie: 'IT', allemagne: 'DE',
  'royaume uni': 'GB', angleterre: 'GB', portugal: 'PT', 'pays bas': 'NL', luxembourg: 'LU', canada: 'CA', 'etats unis': 'US', usa: 'US' };
const km = (a: number[], b: number[]) => { const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos((a[1] + b[1]) / 2 * r), y = (b[1] - a[1]) * r; return Math.sqrt(x * x + y * y) * 6371; };

export type Place = { city: string; lat: number; lng: number; country: string };
export type Photon = (q: string) => Promise<any[]>;   // résultats « ville » du service de lieux (features GeoJSON)

/**
 * Ville d'un lieu d'agenda (jamais de repère approximatif) :
 *  - pays : celui écrit dans le lieu, sinon le PAYS PAR DÉFAUT de l'agenda de l'artiste (France par défaut, réglable) ;
 *  - on essaie chaque élément du lieu, du dernier au premier (salle, adresse, ville…) ; une ville n'est retenue que si son nom
 *    est EXACTEMENT cet élément, dans ce pays ; un code postal présent doit concorder (même département / début de code) ;
 *  - homonymes éloignés (> 30 km) restants, ou éléments qui désignent des villes différentes → null : « localisation à préciser ».
 */
export async function chooseCity(location: string, defaultCountry: string | null, photon: Photon): Promise<Place | null> {
  const raw = String(location || '');
  const postcode = (raw.match(/\b\d{5}\b/) || raw.match(/\b\d{4}\b/) || [])[0] || null;
  let parts = raw.split(/[,\n;–—]| - /).map((x) => x.replace(/\b\d{4,5}\b/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  let country = (defaultCountry || '').toUpperCase() || null;
  const written = parts.map((p) => COUNTRIES[norm(p)]).filter(Boolean);
  if (written.length) { country = written[written.length - 1]; parts = parts.filter((p) => !COUNTRIES[norm(p)]); }
  const found: Place[] = [];
  for (const seg of [...parts].reverse()) {
    if (norm(seg).length < 2) continue;
    let c = (await photon(seg)).filter((f: any) => norm(f.properties?.name || '') === norm(seg));
    if (country) c = c.filter((f: any) => String(f.properties?.countrycode || '').toUpperCase() === country);
    if (postcode) {
      const withPc = c.filter((f: any) => f.properties?.postcode);
      const ok = withPc.filter((f: any) => String(f.properties.postcode).split(/[;,]/).some((pc: string) => pc.trim().slice(0, 2) === postcode.slice(0, 2)));
      if (withPc.length) c = ok;
    }
    if (!c.length) continue;
    const p0 = c[0].geometry.coordinates;
    if (c.some((f: any) => km(p0, f.geometry.coordinates) > 30)) return null;   // homonymes : à préciser
    found.push({ city: c[0].properties.name, lat: p0[1], lng: p0[0], country: String(c[0].properties.countrycode || country || '').toUpperCase() });
  }
  if (!found.length) return null;
  // deux éléments qui désignent des villes éloignées (« Salle Paris, Lille ») : incohérent → à préciser
  if (found.some((f) => km([found[0].lng, found[0].lat], [f.lng, f.lat]) > 30)) return null;
  return found[0];
}
