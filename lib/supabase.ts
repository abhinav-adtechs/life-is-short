import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/** Supabase is optional: without it the app runs on this browser's storage. */
export const hasSupabase = () => Boolean(url && anon);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }
  return client;
}

/**
 * A separate client that keeps its session in memory only, for a sign-in that mustn't replace yours: Face ID's
 * passkey sign-in, which only vouches for this device's session and then signs out (lib/faceid.ts).
 */
let side: SupabaseClient | null = null;
export function sideClient(): SupabaseClient {
  if (!side) {
    side = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'lis-side' },
    });
  }
  return side;
}
