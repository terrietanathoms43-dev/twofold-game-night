import { createClient } from "@supabase/supabase-js";

// NEXT_PUBLIC values are intentionally client-visible. The fallbacks keep
// direct source deployments functional when a host has not copied env vars.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://hqfytiivqtilyhizcdhr.supabase.co";
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_wANQcjmmf3DNZl7vXvj9hw_ZEOr59py";

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
