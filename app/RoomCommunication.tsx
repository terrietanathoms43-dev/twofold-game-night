"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type Props = {
  nightId: string;
  userId: string;
  partnerId: string;
  partnerName: string;
  chatEnabled?: boolean;
};

type CallOffer = {
  inviteId?: string;
  sender: string;
  mode: "audio" | "video";
  description: RTCSessionDescriptionInit;
};

const CHAT_EMOJIS = ["♡", "😂", "🥰", "😊", "😭", "🎉", "🔥", "👏", "✨", "🎮", "🏆", "💭"];
const STICKERS = [
  { key: "love", icon: "💗", label: "Sending love" },
  { key: "gg", icon: "🏆", label: "Good game!" },
  { key: "laugh", icon: "🤣", label: "Too funny!" },
  { key: "wow", icon: "🤩", label: "Wow!" },
  { key: "team", icon: "🙌", label: "Dream team" },
  { key: "hype", icon: "🎉", label: "Let’s go!" },
];

function stickerFrom(body: string) {
  const match = body.match(/^::sticker:([a-z]+)::$/);
  return match ? STICKERS.find((item) => item.key === match[1]) : null;
}

export default function RoomCommunication({ nightId, userId, partnerId, partnerName, chatEnabled = true }: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [callMode, setCallMode] = useState<"audio" | "video" | null>(null);
  const [incoming, setIncoming] = useState<CallOffer | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callMinimized, setCallMinimized] = useState(false);
  const [callStatus, setCallStatus] = useState("");
  const [tray, setTray] = useState<"emoji" | "sticker" | null>(null);
  const [replying, setReplying] = useState<Message | null>(null);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const [quality, setQuality] = useState("Checking connection");
  const [globalChatOpen, setGlobalChatOpen] = useState(false);
  const [speakerActive, setSpeakerActive] = useState(false);
  const [callPosition, setCallPosition] = useState<{ x: number; y: number } | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const endCallRef = useRef<(notify?: boolean) => void>(() => undefined);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const update = (event: Event) => {
      const isOpen = Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open);
      setGlobalChatOpen(isOpen);
      if (isOpen && callMode) setCallMinimized(true);
    };
    window.addEventListener("twofold:chat-open-state", update);
    return () => window.removeEventListener("twofold:chat-open-state", update);
  }, [callMode]);

  useEffect(() => {
    let active = true;
    supabase
      .from("twf_room_messages")
      .select("id,sender_id,body,created_at")
      .eq("game_night_id", nightId)
      .order("created_at")
      .limit(200)
      .then(({ data }) => setMessages((data as Message[]) || []));
    supabase.from("twf_call_invites").select("id,caller_id,mode,description")
      .eq("game_night_id", nightId).eq("recipient_id", userId).eq("status", "pending")
      .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (active && data) setIncoming({ inviteId: data.id, sender: data.caller_id, mode: data.mode, description: data.description } as CallOffer); });

    void supabase.realtime.setAuth();
    const channel = supabase
      .channel(`twf-room:${nightId}:call`, {
        config: { private: true, broadcast: { ack: true } },
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "twf_room_messages",
          filter: "game_night_id=eq." + nightId,
        },
        ({ new: row }) =>
          setMessages((current) =>
            current.some((item) => item.id === row.id)
              ? current
              : [...current, row as Message],
          ),
      )
      .on("broadcast", { event: "call-offer" }, ({ payload }) => {
        if (payload.sender !== userId) {
          setIncoming(payload as CallOffer);
          void showIncomingNotification((payload as CallOffer).mode);
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "twf_call_invites", filter: "game_night_id=eq." + nightId }, ({ new: row }) => {
        if (row.recipient_id === userId && row.status === "pending") {
          setIncoming({ inviteId: row.id, sender: row.caller_id, mode: row.mode, description: row.description } as CallOffer);
          void showIncomingNotification(row.mode as "audio" | "video");
        }
      })
      .on("broadcast", { event: "call-answer" }, async ({ payload }) => {
        if (payload.sender === userId || !peerRef.current) return;
        await peerRef.current.setRemoteDescription(payload.description);
        for (const candidate of pendingIceRef.current)
          await peerRef.current.addIceCandidate(candidate);
        pendingIceRef.current = [];
        setCallStatus("Connected");
      })
      .on("broadcast", { event: "call-ice" }, async ({ payload }) => {
        if (payload.sender === userId || !payload.candidate) return;
        if (!peerRef.current?.remoteDescription) {
          pendingIceRef.current.push(payload.candidate);
          return;
        }
        try {
          await peerRef.current.addIceCandidate(payload.candidate);
        } catch {
          setCallStatus("Reconnecting…");
        }
      })
      .on("broadcast", { event: "call-end" }, ({ payload }) => {
        if (payload.sender !== userId) endCallRef.current(false);
      })
      .subscribe((status) => {
        if (!active) return;
        setChannelReady(status === "SUBSCRIBED");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setCallStatus("Private call service is reconnecting…");
      });
    channelRef.current = channel;

    return () => {
      active = false;
      stopMedia();
      peerRef.current?.close();
      supabase.removeChannel(channel);
    };
  }, [nightId, userId, partnerName]); // eslint-disable-line react-hooks/exhaustive-deps -- channel is intentionally recreated only when room identity changes

  useEffect(() => {
    if (chatOpen) {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
      const markRead = window.setTimeout(() => setLastSeenCount(messages.length), 0);
      return () => window.clearTimeout(markRead);
    }
  }, [messages, chatOpen]);

  useEffect(() => {
    if (!callMode) return;
    const inspect = window.setInterval(async () => {
      const reports = await peerRef.current?.getStats();
      let next = "Connecting";
      reports?.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded" && report.currentRoundTripTime != null) {
          next = report.currentRoundTripTime < 0.15 ? "Strong connection" : report.currentRoundTripTime < 0.35 ? "Fair connection" : "Weak connection";
        }
      });
      setQuality(next);
    }, 3000);
    return () => window.clearInterval(inspect);
  }, [callMode]);

  function stopMedia() {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }

  async function showIncomingNotification(mode: "audio" | "video") {
    if (document.visibilityState === "visible" || !("Notification" in window) || Notification.permission !== "granted") return;
    const registration = await navigator.serviceWorker?.ready;
    await registration?.showNotification(`${partnerName} is calling`, {
      body: `Incoming ${mode === "video" ? "video" : "voice"} call on Twofold`,
      icon: "/twofold-icon-192-v2.png",
      badge: "/twofold-icon-192-v2.png",
      tag: `twofold-call-${nightId}`,
      requireInteraction: true,
      data: { url: `/?callNight=${nightId}` },
    });
  }

  async function createPeer() {
    const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
    const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
    const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.l.google.com:19302" },
        ...(turnUrl && turnUsername && turnCredential
          ? [{ urls: turnUrl, username: turnUsername, credential: turnCredential }]
          : []),
      ],
    });
    peer.onicecandidate = ({ candidate }) => {
      if (candidate)
        channelRef.current?.send({
          type: "broadcast",
          event: "call-ice",
          payload: { sender: userId, candidate },
        });
    };
    peer.ontrack = ({ streams }) => {
      const remote = remoteVideoRef.current;
      if (remote) {
        remote.srcObject = streams[0];
        remote.muted = false;
        remote.volume = 1;
        void remote.play().catch(() => setCallStatus("Tap Speaker to hear your partner."));
      }
    };
    peer.onconnectionstatechange = () => {
      const status = peer.connectionState;
      setCallStatus(
        status === "connected"
          ? "Connected"
          : status === "failed"
            ? "Call connection interrupted — retrying…"
            : "Connecting…",
      );
      if (status === "failed") peer.restartIce();
    };
    peerRef.current = peer;
    return peer;
  }

  async function getMedia(mode: "audio" | "video") {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: mode === "video" ? { facingMode: "user" } : false,
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }

  async function startCall(mode: "audio" | "video") {
    try {
      setCallMode(mode);
      setCallStatus("Calling " + partnerName + "…");
      const stream = await getMedia(mode);
      const peer = await createPeer();
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const description = await peer.createOffer();
      await peer.setLocalDescription(description);
      if (peer.iceGatheringState !== "complete") {
        await new Promise<void>((resolve) => {
          let settled = false;
          let timeoutId = 0;
          const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            peer.removeEventListener("icegatheringstatechange", check);
            resolve();
          };
          const check = () => { if (peer.iceGatheringState === "complete") finish(); };
          peer.addEventListener("icegatheringstatechange", check);
          timeoutId = window.setTimeout(finish, 1800);
        });
      }
      const completeDescription = peer.localDescription?.toJSON() || description;
      const { data: invite, error: inviteError } = await supabase.from("twf_call_invites").insert({
        game_night_id: nightId, caller_id: userId, recipient_id: partnerId, mode, description: completeDescription,
      }).select("id").single();
      if (inviteError) throw inviteError;
      await channelRef.current?.send({
        type: "broadcast",
        event: "call-offer",
        payload: { inviteId: invite.id, sender: userId, mode, description: completeDescription },
      });
      void supabase.functions.invoke("notify-call", { body: { nightId, mode } });
    } catch {
      endCall(false);
      setCallStatus("Camera or microphone permission was not granted.");
    }
  }

  async function acceptCall() {
    const offer = incoming;
    if (!offer) return;
    try {
      setIncoming(null);
      setCallMode(offer.mode);
      setCallStatus("Connecting…");
      const stream = await getMedia(offer.mode);
      const peer = await createPeer();
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      await peer.setRemoteDescription(offer.description);
      for (const candidate of pendingIceRef.current)
        await peer.addIceCandidate(candidate);
      pendingIceRef.current = [];
      const description = await peer.createAnswer();
      await peer.setLocalDescription(description);
      await channelRef.current?.send({
        type: "broadcast",
        event: "call-answer",
        payload: { sender: userId, description },
      });
      if (offer.inviteId) await supabase.from("twf_call_invites").update({ status: "accepted" }).eq("id", offer.inviteId);
    } catch {
      endCall(true);
      setCallStatus("Camera or microphone permission was not granted.");
    }
  }

  async function declineCall() {
    if (incoming?.inviteId) await supabase.from("twf_call_invites").update({ status: "declined" }).eq("id", incoming.inviteId);
    endCall(true);
  }

  function endCall(notify = true) {
    if (notify)
      channelRef.current?.send({
        type: "broadcast",
        event: "call-end",
        payload: { sender: userId },
      });
    stopMedia();
    peerRef.current?.close();
    peerRef.current = null;
    pendingIceRef.current = [];
    setIncoming(null);
    setCallMode(null);
    setMuted(false);
    setCameraOff(false);
    setCallStatus("");
    setSpeakerActive(false);
    setCallPosition(null);
  }
  endCallRef.current = endCall;

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }

  function toggleCamera() {
    const next = !cameraOff;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !next;
    });
    setCameraOff(next);
  }

  async function routeToSpeaker() {
    const remote = remoteVideoRef.current;
    if (!remote) return;
    try {
      const devices = navigator.mediaDevices as MediaDevices & {
        selectAudioOutput?: () => Promise<MediaDeviceInfo>;
      };
      const output = devices.selectAudioOutput ? await devices.selectAudioOutput() : null;
      const sink = remote as HTMLVideoElement & { setSinkId?: (deviceId: string) => Promise<void> };
      if (sink.setSinkId) await sink.setSinkId(output?.deviceId || "default");
      remote.muted = false;
      remote.volume = 1;
      await remote.play();
      setSpeakerActive(true);
      setCallStatus("Connected · speaker on");
    } catch {
      setCallStatus("Turn up media volume or choose Speaker in your phone audio controls.");
    }
  }

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!callMinimized) return;
    const stage = event.currentTarget.closest(".callStage")?.getBoundingClientRect();
    if (!stage) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { offsetX: event.clientX - stage.left, offsetY: event.clientY - stage.top };
  }

  function dragCall(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || !callMinimized) return;
    const width = event.currentTarget.closest(".callStage")?.getBoundingClientRect().width || 180;
    const x = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - drag.offsetX));
    const y = Math.max(8, Math.min(window.innerHeight - 88, event.clientY - drag.offsetY));
    setCallPosition({ x, y });
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    const body = replying ? `↪ ${replying.body.slice(0, 80)}\n${text}` : text;
    if (!body) return;
    setDraft("");
    setReplying(null);
    const { error } = await supabase.from("twf_room_messages").insert({
      game_night_id: nightId,
      sender_id: userId,
      body,
    });
    if (error) setCallStatus("Message could not be sent.");
  }

  async function sendSticker(key: string) {
    setTray(null);
    const { error } = await supabase.from("twf_room_messages").insert({
      game_night_id: nightId,
      sender_id: userId,
      body: `::sticker:${key}::`,
    });
    if (error) setCallStatus("Sticker could not be sent.");
  }

  function toggleChat() {
    setChatOpen((open) => {
      const next = !open;
      if (next && callMode) setCallMinimized(true);
      return next;
    });
  }

  return (
    <div className={"roomComms" + (chatOpen ? " chat-open" : "") + (globalChatOpen ? " global-chat-open" : "")}>
      {incoming && !callMode && (
        <div className="incomingCall" role="dialog" aria-label="Incoming call">
          <b>{incoming.mode === "video" ? "Video" : "Voice"} call</b>
          <span>{partnerName} is calling…</span>
          <button className="acceptCall" onClick={acceptCall}>Accept</button>
          <button className="declineCall" onClick={declineCall}>Decline</button>
        </div>
      )}

      {callMode && (
        <div
          className={"callStage " + callMode + (callMinimized ? " minimized" : "")}
          style={callMinimized && callPosition ? { left: callPosition.x, top: callPosition.y, right: "auto", bottom: "auto" } : undefined}
        >
          {callMinimized && <button className="callDragHandle" onPointerDown={beginDrag} onPointerMove={dragCall} onPointerUp={() => { dragRef.current = null; }} aria-label="Move minimized call">Move</button>}
          <video ref={remoteVideoRef} autoPlay playsInline aria-label={partnerName + " video"} />
          <video ref={localVideoRef} autoPlay muted playsInline aria-label="Your video" />
          <div className="callIdentity">
            <b>{partnerName}</b>
            <span>{callStatus} · {quality}</span>
          </div>
          <div className="callControls">
            <button onClick={() => setCallMinimized((value) => !value)}>
              {callMinimized ? "Expand" : "Minimize"}
            </button>
            {chatEnabled && <button onClick={toggleChat}>Chat</button>}
            <button onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
            <button onClick={routeToSpeaker}>{speakerActive ? "Speaker on" : "Speaker"}</button>
            {callMode === "video" && (
              <button onClick={toggleCamera}>{cameraOff ? "Camera on" : "Camera off"}</button>
            )}
            <button className="hangup" onClick={() => endCall(true)}>End call</button>
          </div>
        </div>
      )}

      {chatEnabled && chatOpen && (
        <aside className="chatPanel" aria-label="Game-night chat">
          <header>
            <div><b>Room chat</b><span>Private to both partners</span></div>
            <button onClick={() => setChatOpen(false)} aria-label="Close chat">×</button>
          </header>
          <div className="chatMessages">
            {messages.length === 0 && <p>Start the conversation.</p>}
            {messages.map((message) => (
              <div key={message.id} className={message.sender_id === userId ? "mine" : "theirs"}>
                {stickerFrom(message.body) ? (
                  <span className="chatSticker" aria-label={stickerFrom(message.body)!.label}>
                    <b>{stickerFrom(message.body)!.icon}</b>
                    <small>{stickerFrom(message.body)!.label}</small>
                  </span>
                ) : <span>{message.body}</span>}
                <time>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                <button className="replyMessage" onClick={() => setReplying(message)}>Reply</button>
              </div>
            ))}
            <div ref={messageEndRef} />
          </div>
          <div className="chatComposer">
            {replying && <div className="replyPreview"><span>Replying to {replying.sender_id === userId ? "your message" : partnerName}</span><button onClick={() => setReplying(null)}>×</button></div>}
            {tray && (
              <div className={tray === "emoji" ? "emojiTray" : "stickerTray"}>
                {tray === "emoji" ? CHAT_EMOJIS.map((emoji) => (
                  <button key={emoji} onClick={() => setDraft((value) => value + emoji)} aria-label={`Add ${emoji}`}>{emoji}</button>
                )) : STICKERS.map((sticker) => (
                  <button key={sticker.key} onClick={() => sendSticker(sticker.key)} aria-label={`Send ${sticker.label}`}>
                    <b>{sticker.icon}</b><small>{sticker.label}</small>
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={sendMessage}>
              <button type="button" className="trayButton" onClick={() => setTray((value) => value === "emoji" ? null : "emoji")} aria-label="Open emojis">😊</button>
              <button type="button" className="trayButton" onClick={() => setTray((value) => value === "sticker" ? null : "sticker")} aria-label="Open stickers">Sticker</button>
              <input value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message…" aria-label="Chat message" />
              <button disabled={!draft.trim()} aria-label="Send message">Send</button>
            </form>
          </div>
        </aside>
      )}

      <div className={"commDock" + (callMode ? " inCall" : "")} aria-label="Room communication controls">
        {chatEnabled && <button onClick={toggleChat}>
          Chat{Math.max(0, messages.length - lastSeenCount) > 0 ? ` (${Math.max(0, messages.length - lastSeenCount)})` : ""}
        </button>}
        {!callMode && (
          <>
          <button disabled={!channelReady} onClick={() => startCall("audio")}>
            Voice
          </button>
          <button disabled={!channelReady} onClick={() => startCall("video")}>
            Video
          </button>
          </>
        )}
      </div>
      {callStatus && !callMode && <div className="commNotice">{callStatus}</div>}
    </div>
  );
}
