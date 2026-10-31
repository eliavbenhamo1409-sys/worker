import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

let client: SupabaseClient<Database> | null = null;

/**
 * Browser-side Supabase client (singleton).
 *
 * During `next build` the pages are prerendered on the server, where the
 * public env vars may be absent (e.g. a Vercel project without them set yet).
 * There we hand back a placeholder client so the build succeeds; in the
 * browser a missing configuration is a real error and is thrown.
 */
export function supabase(): SupabaseClient<Database> {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (typeof window === "undefined") {
      return createClient<Database>("https://placeholder.supabase.co", "placeholder-anon-key");
    }
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  client = createClient<Database>(url, key, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}
