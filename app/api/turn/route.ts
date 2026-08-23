import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return Response.json({ error: "Authentication is not configured" }, { status: 503, headers: noStoreHeaders });
  }

  const auth = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: { user }, error } = await auth.auth.getUser(token);
  if (error || !user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });

  const urls = process.env.TURN_URL;
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  const iceServers = urls && username && credential ? [{ urls, username, credential }] : [];
  return Response.json({ iceServers }, { headers: noStoreHeaders });
}
