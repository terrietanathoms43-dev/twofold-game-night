"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Message = { id: string; sender_id: string; body: string; created_at: string };
type CallEvent = { id: string; caller_id: string; mode: "audio" | "video"; status: string; created_at: string; expires_at: string; answered_at: string | null; ended_at: string | null };
type Props = { coupleId: string; userId: string; partnerName: string };
const EMOJIS = ["♡", "😂", "🥰", "😊", "😭", "🎉", "🔥", "👏", "✨", "🎮", "🏆", "💭"];
const VAPID_PUBLIC_KEY = "BITnVm39DbDcqCgHJGV4DpzCqJopyJwRVT5E5klhuzpSKZgLWAzIsHd98ccl__EtAhdtWPqrSWEo7pxZi-tueN0";

function applicationKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export default function CoupleChat({ coupleId, userId, partnerName }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [emojis, setEmojis] = useState(false);
  const [seen, setSeen] = useState(0);
  const [notice, setNotice] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [calls, setCalls] = useState<CallEvent[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    supabase.from("twf_couple_messages").select("id,sender_id,body,created_at")
      .eq("couple_id", coupleId).order("created_at").limit(300)
      .then(({ data }) => { if (active) { const rows = (data as Message[]) || []; setMessages(rows); setSeen(rows.length); } });
    supabase.from("twf_call_invites").select("id,caller_id,mode,status,created_at,expires_at,answered_at,ended_at")
      .eq("couple_id", coupleId).order("created_at").limit(100)
      .then(({ data }) => { if (active) setCalls((data as CallEvent[]) || []); });
    const channel = supabase.channel(`twf-couple-chat:${coupleId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "twf_couple_messages", filter: `couple_id=eq.${coupleId}` }, ({ new: row }) => {
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row as Message]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "twf_call_invites", filter: `couple_id=eq.${coupleId}` }, ({ new: row }) => {
        const next = row as CallEvent;
        setCalls((current) => current.some((item) => item.id === next.id) ? current.map((item) => item.id === next.id ? next : item) : [...current, next]);
      }).subscribe();
    const show = () => setOpen(true);
    window.addEventListener("twofold:open-chat", show);
    return () => { active = false; window.removeEventListener("twofold:open-chat", show); supabase.removeChannel(channel); };
  }, [coupleId]);

  useEffect(() => {
    if (!calls.some((call) => call.status === "accepted" || call.status === "pending")) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [calls]);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    const timer = window.setTimeout(() => setSeen(messages.length), 0);
    return () => window.clearTimeout(timer);
  }, [messages, open]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("twofold:chat-open-state", { detail: { open } }));
    return () => {
      window.dispatchEvent(new CustomEvent("twofold:chat-open-state", { detail: { open: false } }));
    };
  }, [open]);

  useEffect(() => {
    let active = true;
    async function checkAlerts() {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission !== "granted") {
        if (active) setAlertsEnabled(false);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          if (active) setAlertsEnabled(false);
          return;
        }
        const { data, error } = await supabase.from("twf_push_subscriptions")
          .select("endpoint")
          .eq("user_id", userId)
          .eq("endpoint", subscription.endpoint)
          .maybeSingle();
        if (active) setAlertsEnabled(!error && Boolean(data));
      } catch {
        if (active) setAlertsEnabled(false);
      }
    }
    void checkAlerts();
    return () => { active = false; };
  }, [userId]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setDraft("");
    setSending(true);
    const { data, error } = await supabase.from("twf_couple_messages")
      .insert({ couple_id: coupleId, sender_id: userId, body })
      .select("id,sender_id,body,created_at")
      .single();
    if (error) {
      setDraft(body);
      setNotice("Message could not be sent.");
    } else if (data) {
      setMessages((current) => current.some((item) => item.id === data.id) ? current : [...current, data as Message]);
      void supabase.functions.invoke("notify-chat", { body: { coupleId } });
    }
    setSending(false);
  }

  function callLabel(call: CallEvent) {
    const expired = call.status === "pending" && new Date(call.expires_at).getTime() < clock;
    if (expired) return call.caller_id === userId ? "No answer" : "Missed call";
    if (call.status === "accepted") return "Ongoing call";
    if (call.status === "declined") return call.caller_id === userId ? "Call declined" : "Declined call";
    if (call.status === "ended") return "Call ended";
    return call.caller_id === userId ? "Outgoing call" : "Incoming call";
  }

  function callDuration(call: CallEvent) {
    if (!call.answered_at) return "";
    const end = call.ended_at ? new Date(call.ended_at).getTime() : clock;
    const seconds = Math.max(0, Math.floor((end - new Date(call.answered_at).getTime()) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  const timeline = [
    ...messages.map((item) => ({ kind: "message" as const, at: item.created_at, item })),
    ...calls.map((item) => ({ kind: "call" as const, at: item.created_at, item })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  async function enableAlerts() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) { setNotice("Push notifications are not supported on this device."); return; }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setNotice("Call alerts were not enabled."); return; }
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      const subscription = current || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(VAPID_PUBLIC_KEY) });
      const json = subscription.toJSON();
      const { error } = await supabase.from("twf_push_subscriptions").upsert({ user_id: userId, endpoint: subscription.endpoint, subscription: json, updated_at: new Date().toISOString() }, { onConflict: "endpoint" });
      if (error) throw error;
      setAlertsEnabled(true);
      setNotice("Call alerts are enabled on this device.");
    } catch {
      setAlertsEnabled(false);
      setNotice("Call alerts could not be enabled. Try reinstalling Twofold.");
    }
  }

  const unread = open ? 0 : Math.max(0, messages.length - seen);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("twofold:chat-unread", { detail: { count: unread } }));
  }, [unread]);
  return <div className={"coupleChatRoot" + (open ? " open" : "")}>
    {open && <aside className="coupleChatPanel" aria-label="Couple chat">
      <header><div><b>{partnerName}</b><span>Your private couple conversation</span></div><button onClick={() => setOpen(false)} aria-label="Close chat">×</button></header>
      <div className="coupleChatMessages">
        {!messages.length && <p>Start the conversation. Messages stay here between game nights.</p>}
        {timeline.map((entry) => entry.kind === "message" ? <div key={`message-${entry.item.id}`} className={entry.item.sender_id === userId ? "mine" : "theirs"}>
          <span>{entry.item.body}</span><time>{new Date(entry.item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </div> : <div key={`call-${entry.item.id}`} className="coupleCallEvent">
          <span>{entry.item.mode === "video" ? "🎥" : "☎"}</span><div><b>{callLabel(entry.item)}</b><small>{entry.item.caller_id === userId ? "You called" : `${partnerName} called`}{callDuration(entry.item) ? ` · ${callDuration(entry.item)}` : ""}</small></div><time>{new Date(entry.item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </div>)}
        <div ref={endRef} />
      </div>
      <div className="coupleChatComposer">
        {notice && <button className="alertNotice" onClick={() => setNotice("")}>{notice} ×</button>}
        {emojis && <div className="coupleEmojiTray">{EMOJIS.map((emoji) => <button key={emoji} onClick={() => setDraft((value) => value + emoji)}>{emoji}</button>)}</div>}
        <div className="coupleCallActions"><button onClick={() => window.dispatchEvent(new CustomEvent("twofold:start-call", { detail: { mode: "audio" } }))}>☎ Voice call</button><button onClick={() => window.dispatchEvent(new CustomEvent("twofold:start-call", { detail: { mode: "video" } }))}>🎥 Video call</button></div>
        <form onSubmit={send}><button type="button" onClick={() => setEmojis((value) => !value)} aria-label="Emojis">😊</button><input value={draft} maxLength={1000} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…"/><button disabled={!draft.trim() || sending}>{sending ? "Sending…" : "Send"}</button></form>
        {alertsEnabled === null
          ? <div className="alertsStatus">Checking notification status…</div>
          : alertsEnabled
            ? <div className="alertsStatus enabled">✓ Message &amp; call alerts enabled</div>
            : <button className="enableAlerts" onClick={enableAlerts}>🔔 Enable message &amp; call alerts</button>}
      </div>
    </aside>}
  </div>;
}
