import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!url || !serviceKey || !vapidPublicKey || !vapidPrivateKey) return json({ error: "Push notifications are not configured" }, 503);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({})) as { coupleId?: string; messageId?: string };
  if (!body.coupleId) return json({ error: "coupleId is required" }, 400);

  const { data: couple } = await admin.from("twf_couples").select("member_one,member_two").eq("id", body.coupleId).maybeSingle();
  if (!couple || ![couple.member_one, couple.member_two].includes(user.id)) return json({ error: "Forbidden" }, 403);
  const recipientId = user.id === couple.member_one ? couple.member_two : couple.member_one;
  if (!recipientId) return json({ error: "Partner unavailable" }, 409);
  const [{ data: profile }, { data: subscriptions, error: subscriptionError }, { data: latestMessage }] = await Promise.all([
    admin.from("twf_profiles").select("display_name").eq("id", user.id).maybeSingle(),
    admin.from("twf_push_subscriptions").select("endpoint,subscription").eq("user_id", recipientId),
    body.messageId
      ? admin.from("twf_couple_messages").select("body").eq("id", body.messageId).eq("couple_id", body.coupleId).eq("sender_id", user.id).maybeSingle()
      : admin.from("twf_couple_messages").select("body").eq("couple_id", body.coupleId).eq("sender_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (subscriptionError) return json({ error: "Subscriptions could not be loaded" }, 500);

  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:support@twofold.app", vapidPublicKey, vapidPrivateKey);
  const messagePreview = String(latestMessage?.body || "Your partner sent a message.").slice(0, 240);
  const payload = { type: "chat", title: `New message from ${profile?.display_name || "your partner"}`, body: messagePreview, tag: `twofold-chat-${body.coupleId}`, url: "/?openChat=1" };
  const results = await Promise.all((subscriptions || []).map(async (row) => {
    try { await webpush.sendNotification(row.subscription, JSON.stringify(payload)); return true; }
    catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) await admin.from("twf_push_subscriptions").delete().eq("endpoint", row.endpoint);
      return false;
    }
  }));
  const sent = results.filter(Boolean).length;
  const failed = results.length - sent;
  console.log(JSON.stringify({ event: "chat_push_complete", sent, failed, subscriberCount: subscriptions?.length || 0 }));
  return json({ sent, failed });
});
