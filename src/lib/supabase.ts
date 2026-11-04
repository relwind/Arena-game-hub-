import { createClient } from '@supabase/supabase-js'

// L'URL et la clé publique (publishable) sont faites pour être dans l'application :
// c'est la sécurité côté base (RLS) qui protège les données, pas le secret de cette clé.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://jabjjmdzduvfvtdoaexr.supabase.co'
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string) || 'sb_publishable_0XRbe4rR4Q4mb8CZ5HTzxg_Qc9oqclY'
const url = SUPABASE_URL
const key = SUPABASE_KEY

export const sb = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})
