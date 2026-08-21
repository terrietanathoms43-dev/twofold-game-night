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
  partnerName: string;
};

type CallOffer = {
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

export default function RoomCommunication({ nightId, userId, partnerName }: Props) {
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
  const channelRef = useRef<RealtimeChannel | null>(null);
  const endCallRef = useRef<(notify?: boolean) => void>(() => undefined);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from("twf_room_messages")
      .select("id,sender_id,body,created_at")
      .eq("game_night_id", nightId)
      .order("created_at")
      .limit(200)
      .then(({ data }) => setMessages((data as Message[]) || []));

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
        if (payload.sender !== userId) setIncoming(payload as CallOffer);
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
  }, [nightId, userId]);

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
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = streams[0];
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
      audio: true,
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
      await channelRef.current?.send({
        type: "broadcast",
        event: "call-offer",
        payload: { sender: userId, mode, description },
      });
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
    } catch {
      endCall(true);
      setCallStatus("Camera or microphone permission was not granted.");
    }
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
    <div className="roomComms">
      {incoming && !callMode && (
        <div className="incomingCall" role="dialog" aria-label="Incoming call">
          <b>{incoming.mode === "video" ? "Video" : "Voice"} call</b>
          <span>{partnerName} is calling…</span>
          <button className="acceptCall" onClick={acceptCall}>Accept</button>
          <button className="declineCall" onClick={() => endCall(true)}>Decline</button>
        </div>
      )}

      {callMode && (
        <div className={"callStage " + callMode + (callMinimized ? " minimized" : "")}>
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
            <button onClick={toggleChat}>Chat</button>
            <button onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
            {callMode === "video" && (
              <button onClick={toggleCamera}>{cameraOff ? "Camera on" : "Camera off"}</button>
            )}
            <button className="hangup" onClick={() => endCall(true)}>End call</button>
          </div>
        </div>
      )}

      {chatOpen && (
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
        <button onClick={toggleChat}>
          Chat{Math.max(0, messages.length - lastSeenCount) > 0 ? ` (${Math.max(0, messages.length - lastSeenCount)})` : ""}
        </button>
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
