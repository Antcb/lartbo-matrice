/**
 * Cartographie : localisation des villes (Géoplateforme/OSM), distances, itinéraires (OSRM).
 */
import { showCoords } from './selectors.js';
import { S } from './state.js';

export async function route(a, b){
  const key = a.id+'|'+b.id; if (S.routeCache[key]) return S.routeCache[key];
  const ca = showCoords(a), cb = showCoords(b);
  if (!ca || !cb) return (S.routeCache[key] = {error:'Lieu non géolocalisé'});
  try{
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${ca[1]},${ca[0]};${cb[1]},${cb[0]}?overview=simplified&geometries=geojson`);
    const j = await r.json(); const rt = j.routes && j.routes[0];
    if (!rt) return (S.routeCache[key] = {error:'Pas d’itinéraire trouvé'});
    const h = Math.floor(rt.duration/3600), m = Math.round((rt.duration%3600)/60);
    return (S.routeCache[key] = {km: Math.round(rt.distance/1000), time: `${h}h${String(m).padStart(2,'0')}`, geometry: rt.geometry});
  }catch(e){ return {error:'Service de calcul indisponible'}; }
}

export async function geoFrance(q, type='municipality'){
  try{
    const r = await fetch(`https://data.geopf.fr/geocodage/search?limit=1&type=${type}&q=${encodeURIComponent(q)}`);
    const f = (await r.json()).features?.[0];
    if (!f || (f.properties.score||0) < 0.5) return null;
    const ctx = (f.properties.context||'').split(', ');
    return {lat:f.geometry.coordinates[1], lng:f.geometry.coordinates[0], city:f.properties.city, postcode:f.properties.postcode,
      department_code:ctx[0]||null, department_name:ctx[1]||null, region:ctx[ctx.length-1]||null, label:f.properties.label};
  }catch(e){ return null; }
}

export async function geocode(q, {france=true}={}){
  if (france){ const g = await geoFrance(q) || await geoFrance(q, 'street'); if (g) return g; }
  try{
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q));
    const j = await r.json(); return j[0] ? {lat:Number(j[0].lat), lng:Number(j[0].lon), label:j[0].display_name} : null;
  }catch(e){ return null; }
}

export const distKm = (a, b) => { const R=6371, r=x=>x*Math.PI/180, dLat=r(b[0]-a[0]), dLng=r(b[1]-a[1]);
  const h=Math.sin(dLat/2)**2+Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };

export async function fillCoords(row, fallbackQuery){
  if (row.lat!=null && row.lng!=null) return;
  if (!fallbackQuery) return;
  const g = await geocode(fallbackQuery); if (g){ row.lat=g.lat; row.lng=g.lng; }
}
