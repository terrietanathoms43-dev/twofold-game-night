import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:support@twofold.app";
  if (!url || !serviceKey || !vapidPublicKey || !vapidPrivateKey) {
    console.error(JSON.stringify({ event: "push_configuration_missing", function: "notify-call" }));
    return json({ error: "Push notifications are not configured" }, 503);
  }

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const body = await request.json().catch(() => ({})) as { coupleId?: string; mode?: string };
  if (!body.coupleId || !["audio", "video"].includes(body.mode || "")) {
    return json({ error: "A valid coupleId and call mode are required" }, 400);
  }

  const { data: couple, error: coupleError } = await admin.from("twf_couples")
    .select("member_one,member_two").eq("id", body.coupleId).maybeSingle();
  if (coupleError) return json({ error: "Couple lookup failed" }, 500);
  if (!couple || ![couple.member_one, couple.member_two].includes(user.id)) return json({ error: "Forbidden" }, 403);

  const recipientId = user.id === couple.member_one ? couple.member_two : couple.member_one;
  if (!recipientId) return json({ error: "Partner unavailable" }, 409);
  const [{ data: profile }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
    admin.from("twf_profiles").select("display_name").eq("id", user.id).maybeSingle(),
    admin.from("twf_push_subscriptions").select("endpoint,subscription").eq("user_id", recipientId),
  ]);
  if (subscriptionError) return json({ error: "Subscriptions could not be loaded" }, 500);

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const payload = {
    type: "call",
    title: `${profile?.display_name || "Your partner"} is calling`,
    body: `Incoming ${body.mode === "video" ? "video" : "voice"} call on Twofold`,
    tag: `twofold-call-${body.coupleId}`,
    url: "/?openChat=1",
  };
  let sent = 0;
  let failed = 0;
  for (const row of subscriptions || []) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("twf_push_subscriptions").delete().eq("endpoint", row.endpoint);
      }
    }
  }
  console.log(JSON.stringify({ event: "call_push_complete", sent, failed, subscriberCount: subscriptions?.length || 0 }));
  return json({ sent, failed });
});
