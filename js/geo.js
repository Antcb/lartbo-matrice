/**
 * Cartographie : recherche de villes / adresses (Géoplateforme pour la France, OpenStreetMap ailleurs),
 * distances à vol d'oiseau, itinéraires routiers (OSRM).
 */
import { showCoords } from './selectors.js';
import { S } from './state.js';

/** Itinéraire routier entre deux dates (ou deux points [lat,lng]) : {km, time} */
export async function route(a, b){
  const ca = Array.isArray(a) ? a : showCoords(a), cb = Array.isArray(b) ? b : showCoords(b);
  if (!ca || !cb) return {error:'Lieu non localisé'};
  const key = ca.join(',')+'|'+cb.join(','); if (S.routeCache[key]) return S.routeCache[key];
  try{
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${ca[1]},${ca[0]};${cb[1]},${cb[0]}?overview=false`);
    const j = await r.json(); const rt = j.routes && j.routes[0];
    if (!rt) return (S.routeCache[key] = {error:'Pas d’itinéraire trouvé'});
    const h = Math.floor(rt.duration/3600), m = Math.round((rt.duration%3600)/60);
    return (S.routeCache[key] = {km: Math.round(rt.distance/1000), time: `${h}h${String(m).padStart(2,'0')}`});
  }catch(e){ return {error:'Service de calcul indisponible'}; }
}
export const routeCached = (a, b) => { const ca = Array.isArray(a) ? a : showCoords(a), cb = Array.isArray(b) ? b : showCoords(b); return ca && cb ? S.routeCache[ca.join(',')+'|'+cb.join(',')] : {error:'Lieu non localisé'}; };

function fromGeopf(f){
  const p = f.properties, ctx = (p.context||'').split(', ');
  return {lat:f.geometry.coordinates[1], lng:f.geometry.coordinates[0], city:p.city, postcode:p.postcode,
    street: p.type==='housenumber' || p.type==='street' ? p.name : null,
    department_code:ctx[0]||null, department_name:ctx[1]||null, region:ctx[ctx.length-1]||null, country:'France', country_code:'FR',
    label:p.label, type:p.type};
}

export async function geoFrance(q, type='municipality'){
  try{
    const r = await fetch(`https://data.geopf.fr/geocodage/search?limit=1&type=${type}&q=${encodeURIComponent(q)}`);
    const f = (await r.json()).features?.[0];
    if (!f || (f.properties.score||0) < 0.5) return null;
    return fromGeopf(f);
  }catch(e){ return null; }
}

export async function geocode(q, {france=true}={}){
  if (france){ const g = await geoFrance(q) || await geoFrance(q, 'street'); if (g) return g; }
  try{
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q));
    const j = await r.json(); return j[0] ? {lat:Number(j[0].lat), lng:Number(j[0].lon), label:j[0].display_name} : null;
  }catch(e){ return null; }
}

/**
 * Suggestions pendant la saisie d'une ville ou d'une adresse.
 * Renvoie [{id, label, hint, lat, lng, street, postcode, city, department_code, department_name, region, country}]
 * id = ce qui est enregistré dans le champ (la ville pour les villes, la rue pour les adresses).
 */
export async function searchPlaces(q, {cities=false}={}){
  if (q.length < 3) return [];
  const fr = fetch(`https://data.geopf.fr/geocodage/search?autocomplete=1&limit=6${cities?'&type=municipality':''}&q=${encodeURIComponent(q)}`)
    .then(r => r.json()).then(j => (j.features||[]).map(fromGeopf)).catch(() => []);
  const world = fetch(`https://photon.komoot.io/api/?limit=6&lang=fr&q=${encodeURIComponent(q)}${cities?'&layer=city':''}`)
    .then(r => r.json()).then(j => (j.features||[]).filter(f => f.properties.countrycode !== 'FR').map(f => {
      const p = f.properties;
      return {lat:f.geometry.coordinates[1], lng:f.geometry.coordinates[0], city:p.city || (['city','town','village'].includes(p.osm_value) ? p.name : null) || p.name,
        postcode:p.postcode||null, street: p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : null,
        region:p.state||null, country:p.country||null, country_code:p.countrycode||null,
        label:[p.name, p.street && p.name!==p.street ? p.street : null, p.postcode, p.city && p.city!==p.name ? p.city : null, p.country].filter(Boolean).join(', ')};
    })).catch(() => []);
  const [a, b] = await Promise.all([fr, world]);
  return a.concat(b.slice(0, a.length >= 4 ? 2 : 5)).map(p => ({...p,
    id: cities ? p.city : (p.street || ''),
    hint: cities ? [p.department_code ? `${p.department_code} ${p.department_name||''}` : '', p.country !== 'France' ? p.country : ''].filter(Boolean).join(' · ')
                 : [p.postcode, p.city, p.country !== 'France' ? p.country : ''].filter(Boolean).join(' '),
    label: cities ? p.city : p.label}));
}

export const distKm = (a, b) => { const R=6371, r=x=>x*Math.PI/180, dLat=r(b[0]-a[0]), dLng=r(b[1]-a[1]);
  const h=Math.sin(dLat/2)**2+Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };

export async function fillCoords(row, fallbackQuery){
  if (row.lat!=null && row.lng!=null) return;
  if (!fallbackQuery) return;
  const g = await geocode(fallbackQuery); if (g){ row.lat=g.lat; row.lng=g.lng; if (g.department_code && !row.department) row.department = g.department_code; }
}
