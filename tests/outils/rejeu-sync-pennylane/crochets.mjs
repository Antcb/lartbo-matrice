// Remplace le client Supabase de la fonction edge par le faux client en mémoire (aucun réseau, aucune base)
export async function resolve(s, c, n) { if (s.startsWith('npm:@supabase/supabase-js')) return { url: new URL('./faux-supabase.mjs', import.meta.url).href, shortCircuit: true }; return n(s, c); }
