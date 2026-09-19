"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Message = { id: string; sender_id: string; body: string; created_at: string };
type CallEvent = { id: string; caller_id: string; mode: "audio" | "video"; status: string; created_at: string; expires_at: string; answered_at: string | null; ended_at: string | null };
type ToastNotice = { id: string; kind: "message" | "call"; title: string; body: string };
type Props = { coupleId: string; userId: string; partnerName: string };
const EMOJIS = ["♡", "😂", "🥰", "😊", "😭", "🎉", "🔥", "👏", "✨", "🎮", "🏆", "💭"];
// Public by design: browsers need this key to create push subscriptions.
const VAPID_PUBLIC_KEY = "BJiXaRBB0lugsmkftEY5Dynv1X5W7qGAg9O8vqHUkkie4XG1Vawc7uPKoLQ7O9bkJdMOaxlZp95E5MppybKWGdc";

function applicationKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function subscriptionUsesCurrentKey(subscription: PushSubscription) {
  const configured = subscription.options.applicationServerKey;
  if (!configured) return false;
  const current = new Uint8Array(configured);
  const expected = applicationKey(VAPID_PUBLIC_KEY);
  return current.length === expected.length && current.every((value, index) => value === expected[index]);
}

export default function CoupleChat({ coupleId, userId, partnerName }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [emojis, setEmojis] = useState(false);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [calls, setCalls] = useState<CallEvent[]>([]);
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const alertCheckComplete = useRef(false);
  const pushRefreshAt = useRef(0);
  const openRef = useRef(false);
  const knownMessageIds = useRef(new Set<string>());
  const knownCallIds = useRef(new Set<string>());
  const messagesLoaded = useRef(false);
  const callsLoaded = useRef(false);
  const readStorageKey = `twf-chat-read-${coupleId}-${userId}`;

  useEffect(() => {
    let active = true;
    supabase.from("twf_couple_messages").select("id,sender_id,body,created_at")
      .eq("couple_id", coupleId).order("created_at").limit(300)
      .then(({ data }) => {
        if (!active) return;
        const rows = (data as Message[]) || [];
        knownMessageIds.current = new Set(rows.map((item) => item.id));
        messagesLoaded.current = true;
        setMessages(rows);
        const saved = localStorage.getItem(readStorageKey);
        const initialReadAt = saved || new Date().toISOString();
        if (!saved) localStorage.setItem(readStorageKey, initialReadAt);
        setLastReadAt(initialReadAt);
      });
    supabase.from("twf_call_invites").select("id,caller_id,mode,status,created_at,expires_at,answered_at,ended_at")
      .eq("couple_id", coupleId).order("created_at").limit(100)
      .then(({ data }) => {
        if (!active) return;
        const rows = (data as CallEvent[]) || [];
        knownCallIds.current = new Set(rows.map((item) => item.id));
        callsLoaded.current = true;
        setCalls(rows);
      });
    void supabase.realtime.setAuth();
    const channel = supabase.channel(`twf-couple-chat:${coupleId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "twf_couple_messages", filter: `couple_id=eq.${coupleId}` }, ({ new: row }) => {
        const message = row as Message;
        const unseen = !knownMessageIds.current.has(message.id);
        knownMessageIds.current.add(message.id);
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message].slice(-300));
        if (unseen && message.sender_id !== userId && !openRef.current) {
          setToast({ id: message.id, kind: "message", title: partnerName, body: message.body });
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "twf_call_invites", filter: `couple_id=eq.${coupleId}` }, ({ new: row }) => {
        const next = row as CallEvent;
        const unseen = !knownCallIds.current.has(next.id);
        knownCallIds.current.add(next.id);
        setCalls((current) => current.some((item) => item.id === next.id) ? current.map((item) => item.id === next.id ? next : item) : [...current, next]);
        if (unseen && next.caller_id !== userId && next.status === "pending") {
          setToast({ id: next.id, kind: "call", title: `Incoming ${next.mode} call`, body: `${partnerName} is calling.` });
        }
      }).subscribe();
    const reconcile = async () => {
      const [{ data: messageRows }, { data: callRows }] = await Promise.all([
        supabase.from("twf_couple_messages").select("id,sender_id,body,created_at").eq("couple_id", coupleId).order("created_at").limit(300),
        supabase.from("twf_call_invites").select("id,caller_id,mode,status,created_at,expires_at,answered_at,ended_at").eq("couple_id", coupleId).order("created_at").limit(100),
      ]);
      if (!active) return;
      const nextMessages = (messageRows as Message[]) || [];
      const newestMessage = messagesLoaded.current
        ? [...nextMessages].reverse().find((item) => item.sender_id !== userId && !knownMessageIds.current.has(item.id))
        : undefined;
      nextMessages.forEach((item) => knownMessageIds.current.add(item.id));
      messagesLoaded.current = true;
      setMessages(nextMessages);
      const nextCalls = (callRows as CallEvent[]) || [];
      const newestCall = callsLoaded.current
        ? [...nextCalls].reverse().find((item) => item.caller_id !== userId && item.status === "pending" && !knownCallIds.current.has(item.id))
        : undefined;
      nextCalls.forEach((item) => knownCallIds.current.add(item.id));
      callsLoaded.current = true;
      setCalls(nextCalls);
      if (newestCall) setToast({ id: newestCall.id, kind: "call", title: `Incoming ${newestCall.mode} call`, body: `${partnerName} is calling.` });
      else if (newestMessage && !openRef.current) setToast({ id: newestMessage.id, kind: "message", title: partnerName, body: newestMessage.body });
    };
    const timer = window.setInterval(() => void reconcile(), 3000);
    const refreshVisible = () => { if (document.visibilityState === "visible") void reconcile(); };
    document.addEventListener("visibilitychange", refreshVisible);
    const show = (event: Event) => {
      setOpen(true);
      if ((event as CustomEvent<{ focusComposer?: boolean }>).detail?.focusComposer) {
        window.setTimeout(() => composerRef.current?.focus(), 100);
      }
    };
    window.addEventListener("twofold:open-chat", show);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("twofold:open-chat", show);
      supabase.removeChannel(channel);
    };
  }, [coupleId, partnerName, readStorageKey, userId]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!calls.some((call) => call.status === "accepted" || (call.status === "pending" && new Date(call.expires_at).getTime() > Date.now()))) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [calls]);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "auto" });
    const timer = window.setTimeout(() => {
      const readAt = new Date().toISOString();
      localStorage.setItem(readStorageKey, readAt);
      setLastReadAt(readAt);
      void navigator.clearAppBadge?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [messages, open, readStorageKey]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("twofold:chat-open-state", { detail: { open } }));
    return () => {
      window.dispatchEvent(new CustomEvent("twofold:chat-open-state", { detail: { open: false } }));
    };
  }, [open]);

  useEffect(() => {
    let active = true;
    async function checkAlerts() {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (active) setAlertsEnabled(false);
        return;
      }
      if (Notification.permission !== "granted") {
        if (active) setAlertsEnabled(false);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (subscription && !subscriptionUsesCurrentKey(subscription)) {
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription = subscription || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(VAPID_PUBLIC_KEY),
        });
        const { error } = await supabase.from("twf_push_subscriptions").upsert({
          user_id: userId,
          endpoint: subscription.endpoint,
          subscription: subscription.toJSON(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "endpoint" });
        if (error) throw error;
        if (active) {
          alertCheckComplete.current = true;
          pushRefreshAt.current = Date.now();
          setAlertsEnabled(true);
        }
      } catch {
        if (active) {
          setAlertsEnabled(false);
          setNotice("This browser could not refresh its notification subscription. Check the browser's site permissions, then try again.");
        }
      }
    }
    void checkAlerts();
    const refresh = () => {
      if (document.visibilityState === "visible" && Date.now() - pushRefreshAt.current > 5 * 60 * 1000) void checkAlerts();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", refresh);
    };
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
      void supabase.functions.invoke("notify-chat", { body: { coupleId, messageId: data.id } });
    }
    setSending(false);
  }

  function callLabel(call: CallEvent) {
    const expired = call.status === "pending" && new Date(call.expires_at).getTime() < clock;
    if (expired) return call.caller_id === userId ? "No answer" : "Missed call";
    if (call.status === "missed") return call.caller_id === userId ? "No answer" : "Missed call";
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

  const timeline = useMemo(() => [
    ...messages.map((item) => ({ kind: "message" as const, at: item.created_at, item })),
    ...calls.map((item) => ({ kind: "call" as const, at: item.created_at, item })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()), [messages, calls]);

  async function enableAlerts() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) { setNotice("Push notifications are not supported on this device."); return; }
    if (!VAPID_PUBLIC_KEY) { setNotice("Notifications are temporarily unavailable. Please try again shortly."); return; }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setNotice("Call alerts were not enabled."); return; }
    try {
      const registration = await navigator.serviceWorker.ready;
      let current = await registration.pushManager.getSubscription();
      if (current && !subscriptionUsesCurrentKey(current)) {
        await current.unsubscribe();
        current = null;
      }
      const subscription = current || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(VAPID_PUBLIC_KEY) });
      const json = subscription.toJSON();
      const { error } = await supabase.from("twf_push_subscriptions").upsert({ user_id: userId, endpoint: subscription.endpoint, subscription: json, updated_at: new Date().toISOString() }, { onConflict: "endpoint" });
      if (error) throw error;
      setAlertsEnabled(true);
      setNotice("Call alerts are enabled on this device.");
    } catch {
      setAlertsEnabled(false);
      setNotice("Notifications could not be enabled in this browser. Allow notifications for Twofold in the browser's site settings, then try again.");
    }
  }

  async function testAlerts() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNotice("Notifications are not supported by this browser.");
      return;
    }
    if (Notification.permission === "denied") {
      setAlertsEnabled(false);
      setNotice("Notifications are blocked. Open the browser's site settings for Twofold, change Notifications to Allow, then reload the page.");
      return;
    }
    if (Notification.permission !== "granted") {
      setAlertsEnabled(false);
      setNotice("Select Enable alerts first, then allow notifications when the browser asks.");
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
      await registration.showNotification("Twofold alerts are working", {
        body: "This laptop can receive Twofold messages and call alerts.",
        icon: "/twofold-icon-192-v2.png",
        badge: "/twofold-icon-192-v2.png",
        tag: "twofold-notification-test",
        data: { url: "/?openChat=1" },
      });
      setNotice("A test alert was sent. If it did not appear, allow notifications for your browser in the laptop's system notification settings.");
    } catch {
      setNotice("The laptop could not display a test alert. Check both the browser site permission and the laptop's system notification settings.");
    }
  }

  const unread = open || !lastReadAt ? 0 : messages.filter((message) => message.sender_id !== userId && message.created_at > lastReadAt).length;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("twofold:chat-unread", { detail: { count: unread } }));
  }, [unread]);
  return <div className={"coupleChatRoot" + (open ? " open" : "")}>
    {toast && <button className={`coupleToast ${toast.kind}`} onClick={() => {
      setToast(null);
      setOpen(true);
      window.setTimeout(() => composerRef.current?.focus(), 100);
    }} aria-label={`Open ${toast.kind} notification`}>
      <span>{toast.kind === "call" ? "☎" : "💬"}</span>
      <div><b>{toast.title}</b><p>{toast.body}</p></div>
      <i aria-hidden="true">×</i>
    </button>}
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
        <div className="coupleCallActions"><button onClick={() => window.dispatchEvent(new CustomEvent("twofold:check-call"))}>✓ Call check</button><button onClick={() => window.dispatchEvent(new CustomEvent("twofold:start-call", { detail: { mode: "audio" } }))}>☎ Voice call</button><button onClick={() => window.dispatchEvent(new CustomEvent("twofold:start-call", { detail: { mode: "video" } }))}>🎥 Video call</button></div>
        <form onSubmit={send}><button type="button" onClick={() => setEmojis((value) => !value)} aria-label="Emojis">😊</button><input ref={composerRef} value={draft} maxLength={1000} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…"/><button disabled={!draft.trim() || sending}>{sending ? "Sending…" : "Send"}</button></form>
        {alertsEnabled === null
          ? <div className="alertsStatus">Checking notification status…</div>
          : alertsEnabled
            ? <div className="alertsStatus enabled"><span>✓ Message &amp; call alerts enabled</span><button type="button" onClick={testAlerts}>Send test alert</button></div>
            : <button className="enableAlerts" onClick={enableAlerts}>🔔 Enable message &amp; call alerts</button>}
      </div>
    </aside>}
  </div>;
}
