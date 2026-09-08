import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

/**
 * Returns null when Supabase isn't configured. That is a supported mode, not
 * an error: solo play and private rooms over a shared code both work without a
 * ladder behind them, and a fresh clone should run with no secrets at all.
 */
export function supabase(): SupabaseClient | null {
  if (!url || !key) return null;
  cached ??= createClient(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return cached;
}

export const ladderEnabled = Boolean(url && key);
