"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Message = { id: string; sender_id: string; body: string; created_at: string };
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
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    supabase.from("twf_couple_messages").select("id,sender_id,body,created_at")
      .eq("couple_id", coupleId).order("created_at").limit(300)
      .then(({ data }) => { if (active) { const rows = (data as Message[]) || []; setMessages(rows); setSeen(rows.length); } });
    const channel = supabase.channel(`twf-couple-chat:${coupleId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "twf_couple_messages", filter: `couple_id=eq.${coupleId}` }, ({ new: row }) => {
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row as Message]);
      }).subscribe();
    const show = () => setOpen(true);
    window.addEventListener("twofold:open-chat", show);
    return () => { active = false; window.removeEventListener("twofold:open-chat", show); supabase.removeChannel(channel); };
  }, [coupleId]);

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
    }
    setSending(false);
  }

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
      setNotice("Call alerts are enabled on this device.");
    } catch {
      setNotice("Call alerts could not be enabled. Try reinstalling Twofold.");
    }
  }

  const unread = open ? 0 : Math.max(0, messages.length - seen);
  return <div className={"coupleChatRoot" + (open ? " open" : "")}>
    {open && <aside className="coupleChatPanel" aria-label="Couple chat">
      <header><div><b>{partnerName}</b><span>Your private couple conversation</span></div><button onClick={() => setOpen(false)} aria-label="Close chat">×</button></header>
      <div className="coupleChatMessages">
        {!messages.length && <p>Start the conversation. Messages stay here between game nights.</p>}
        {messages.map((message) => <div key={message.id} className={message.sender_id === userId ? "mine" : "theirs"}>
          <span>{message.body}</span><time>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </div>)}
        <div ref={endRef} />
      </div>
      <div className="coupleChatComposer">
        {notice && <button className="alertNotice" onClick={() => setNotice("")}>{notice} ×</button>}
        {emojis && <div className="coupleEmojiTray">{EMOJIS.map((emoji) => <button key={emoji} onClick={() => setDraft((value) => value + emoji)}>{emoji}</button>)}</div>}
        <form onSubmit={send}><button type="button" onClick={() => setEmojis((value) => !value)} aria-label="Emojis">😊</button><input value={draft} maxLength={1000} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…"/><button disabled={!draft.trim() || sending}>{sending ? "Sending…" : "Send"}</button></form>
        <button className="enableAlerts" onClick={enableAlerts}>🔔 Enable call alerts on this device</button>
      </div>
    </aside>}
    <button className="coupleChatButton" onClick={() => setOpen((value) => !value)} aria-label="Open couple chat">💬<span>Chat</span>{unread > 0 && <b>{unread}</b>}</button>
  </div>;
}
