/**
 * État de l'application en mémoire (données chargées, onglet, filtres) et préférences du navigateur.
 */
export const S = {
  user:null, view: localGet('view') || 'booking',
  year: Number(localGet('year')) || new Date().getFullYear(),
  project: localGet('project') || '',
  db: {structures:[], contacts:[], contact_structures:[], projects:[], partners:[], shows:[], show_payments:[], prospects:[], prospect_logs:[], prospect_files:[], tasks:[], settings:[]},
  openProd: new Set(), routePick: {a:null,b:null}, routeCache: {}, search:{},
  showCancelled:false, projectPage:null, structurePage:null, focusProspect:null,
};

export function localGet(k){ try { return localStorage.getItem('artbo.'+k); } catch(e){ return null; } }

export function localSet(k,v){ try { localStorage.setItem('artbo.'+k, v); } catch(e){} }
