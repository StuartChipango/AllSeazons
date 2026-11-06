import { createClient } from '../vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT-ID');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export function imageUrl(path) {
  if (!path) return new URL('../img/placeholder.svg', import.meta.url).href;
  return supabase.storage.from('toys').getPublicUrl(path).data.publicUrl;
}

// Turn a database error into a sentence people can act on.
export function friendlyError(error) {
  if (!error) return '';
  if (error.message?.includes('Failed to fetch')) return 'No connection. Check your internet and try again.';
  return error.message || String(error);
}
