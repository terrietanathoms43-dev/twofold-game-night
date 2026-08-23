"use client";
import { FormEvent, useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import { supabase } from "../lib/supabase";
import { GAMES } from "../lib/games";
import RoomCommunication from "./RoomCommunication";
import CoupleChat from "./CoupleChat";
type Profile = {
  id: string;
  display_name: string;
  avatar_color: string;
  avatar_key: string;
  avatar_url?: string | null;
};
type Couple = {
  id: string;
  member_one: string;
  member_two: string | null;
  invite_code: string;
};
type Night = {
  id: string;
  couple_id: string;
  room_code: string;
  status: string;
  current_game_index: number;
  current_round: number;
  created_by: string;
  winner_id: string | null;
  play_style?: "competitive" | "cooperative";
  difficulty?: "easy" | "standard" | "hard";
};
type Round = {
  id: string;
  selected_game_id: string;
  round_number: number;
  prompt: { text?: string };
  status: string;
  ends_at: string | null;
  state?: Record<string, string>;
};
type View =
  | "home"
  | "games"
  | "setup"
  | "lobby"
  | "play"
  | "results"
  | "history"
  | "leaderboard"
  | "profile";
const init = (s?: string) => s?.trim().slice(0, 1).toUpperCase() || "?";
const MAX_PROFILE_PHOTO_BYTES = 10 * 1024 * 1024;
const AVATARS = [
  {
    key: "heart",
    icon: "♡",
    label: "Sweet heart",
    colors: ["#ff8caf", "#d95588"],
  },
  {
    key: "sparkle",
    icon: "✦",
    label: "Sparkle",
    colors: ["#a888ec", "#7552c1"],
  },
  { key: "flower", icon: "✿", label: "Flower", colors: ["#ffad8d", "#ea6f83"] },
  { key: "moon", icon: "☾", label: "Moon", colors: ["#7f86d9", "#505aa9"] },
  {
    key: "cherry",
    icon: "●●",
    label: "Cherries",
    colors: ["#ef7690", "#b94268"],
  },
  {
    key: "cloud",
    icon: "☁",
    label: "Dream cloud",
    colors: ["#8bc9e8", "#5a92ca"],
  },
  { key: "star", icon: "★", label: "Star", colors: ["#f4c45e", "#e39049"] },
  {
    key: "gamepad",
    icon: "＋",
    label: "Player",
    colors: ["#75c7ad", "#368e7e"],
  },
  { key: "sunshine", icon: "☀", label: "Sunshine", colors: ["#ff9f91", "#ee547b"] },
  { key: "galaxy", icon: "♄", label: "Galaxy", colors: ["#9a65d5", "#61339b"] },
  { key: "butterfly", icon: "❀", label: "Butterfly", colors: ["#f49bc8", "#b85cba"] },
  { key: "paw", icon: "♣", label: "Paw", colors: ["#bf956e", "#79583e"] },
];
function Avatar({
  person,
  size = "medium",
}: {
  person?: Profile | null;
  size?: "small" | "medium" | "large";
}) {
  const option =
    AVATARS.find((a) => a.key === person?.avatar_key) || AVATARS[0];
  if (person?.avatar_url) {
    const pixels = size === "large" ? 76 : size === "small" ? 40 : 52;
    return (
      <Image
        className={"avatarPic " + size}
        src={person.avatar_url}
        alt={person.display_name + " profile"}
        width={pixels}
        height={pixels}
        unoptimized
      />
    );
  }
  return (
    <span
      className={"avatarPic " + size}
      style={{
        background: `linear-gradient(135deg,${option.colors[0]},${option.colors[1]})`,
      }}
      aria-label={person ? person.display_name + " avatar" : option.label}
    >
      {option.icon || init(person?.display_name)}
    </span>
  );
}
export default function Home() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [profile, setProfile] = useState<Profile | null>(null),
    [partner, setPartner] = useState<Profile | null>(null),
    [couple, setCouple] = useState<Couple | null>(null),
    [view, setView] = useState<View>("home"),
    [category, setCategory] = useState("All"),
    [selected, setSelected] = useState(["knows", "trivia", "five"]),
    [night, setNight] = useState<Night | null>(null),
    [resumableNight, setResumableNight] = useState<Night | null>(null),
    [players, setPlayers] = useState<any[]>([]),
    [gi, setGi] = useState(0),
    [round, setRound] = useState(0),
    [activeRound, setActiveRound] = useState<Round | null>(null),
    [timeLeft, setTimeLeft] = useState<number | null>(null),
    [answer, setAnswer] = useState(""),
    [answers, setAnswers] = useState<any[]>([]),
    [customQuestions, setCustomQuestions] = useState<any[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [historyPlayers, setHistoryPlayers] = useState<any[]>([]),
    [gameResults, setGameResults] = useState<any[]>([]),
    [ratings, setRatings] = useState<any[]>([]),
    [favorites, setFavorites] = useState<string[]>([]),
    [savedLineups, setSavedLineups] = useState<string[][]>([]),
    [playStyle, setPlayStyle] = useState<"competitive" | "cooperative">("competitive"),
    [difficulty, setDifficulty] = useState<"easy" | "standard" | "hard">("standard"),
    [online, setOnline] = useState(true),
    [chatUnread, setChatUnread] = useState(0),
    [copied, setCopied] = useState(false),
    [photoViewerOpen, setPhotoViewerOpen] = useState(false),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const gameCategories = ["Couple", "Competitive", "Party", "Creative", "Cooperative"];
  const preferenceCoupleId = couple?.id;
  useEffect(() => {
    supabase.auth.getSession().then((x) => {
      setSession(x.data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  useEffect(() => {
    const update = (event: Event) => setChatUnread(Number((event as CustomEvent<{ count?: number }>).detail?.count || 0));
    window.addEventListener("twofold:chat-unread", update);
    return () => window.removeEventListener("twofold:chat-unread", update);
  }, []);
  useEffect(() => {
    if (!preferenceCoupleId) return;
    let active = true;
    async function loadPreferences() {
      try {
        const localFavorites = JSON.parse(localStorage.getItem(`twf-favorites-${preferenceCoupleId}`) || "[]") as string[];
        const localLineups = JSON.parse(localStorage.getItem(`twf-lineups-${preferenceCoupleId}`) || "[]") as string[][];
        const { data } = await supabase.from("twf_couple_preferences")
          .select("favorites,saved_lineups").eq("couple_id", preferenceCoupleId).maybeSingle();
        if (!active) return;
        const nextFavorites = Array.isArray(data?.favorites) ? data.favorites : localFavorites;
        const nextLineups = Array.isArray(data?.saved_lineups) ? data.saved_lineups as string[][] : localLineups;
        setFavorites(nextFavorites);
        setSavedLineups(nextLineups);
        localStorage.setItem(`twf-favorites-${preferenceCoupleId}`, JSON.stringify(nextFavorites));
        localStorage.setItem(`twf-lineups-${preferenceCoupleId}`, JSON.stringify(nextLineups));
      } catch {
        setFavorites([]);
        setSavedLineups([]);
      }
    }
    void loadPreferences();
    return () => { active = false; };
  }, [preferenceCoupleId]);
  useEffect(() => {
    if (!preferenceCoupleId || new URLSearchParams(window.location.search).get("openChat") !== "1") return;
    window.dispatchEvent(new Event("twofold:open-chat"));
    window.history.replaceState({}, "", window.location.pathname);
  }, [preferenceCoupleId]);
  useEffect(() => {
    if (session?.user) loadAccount(session.user.id);
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed only to the authenticated user
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  useEffect(() => {
    if (!night) return;
    const refresh = () => loadGameState(night.id);
    const ch = supabase
      .channel("twofold-night-" + night.id)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "twf_game_nights",
          filter: "id=eq." + night.id,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "twf_game_night_players",
          filter: "game_night_id=eq." + night.id,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "twf_rounds" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "twf_answers" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "twf_creative_ratings" },
        refresh,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [night?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- one subscription per active room
  useEffect(() => {
    if (!night || view !== "lobby") return;
    const reconcileLobby = () => void loadPlayers(night.id);
    reconcileLobby();
    const timer = window.setInterval(reconcileLobby, 2500);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") reconcileLobby();
    };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [night?.id, view]); // eslint-disable-line react-hooks/exhaustive-deps -- lobby-only recovery when a realtime event is missed
  useEffect(() => {
    if (!couple || !profile) return;
    const refreshQuestions = async () => {
      const { data } = await supabase
        .from("twf_custom_questions")
        .select("id,created_by,game_key,question,created_at")
        .eq("couple_id", couple.id)
        .order("created_at", { ascending: false });
      setCustomQuestions(data || []);
    };
    const channel = supabase
      .channel("twf-couple-live-" + couple.id)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "twf_custom_questions", filter: "couple_id=eq." + couple.id },
        refreshQuestions,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "twf_profiles" },
        async ({ new: updated }) => {
          if (updated.id === profile.id)
            setProfile(await signedProfile(updated as Profile));
          if (updated.id === partner?.id)
            setPartner(await signedProfile(updated as Profile));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [couple?.id, profile?.id, partner?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- resubscribe only when couple membership changes
  useEffect(() => {
    const tick = () => {
      const endsAt = activeRound?.ends_at;
      setTimeLeft(
        endsAt
          ? Math.max(
              0,
              Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000),
            )
          : null,
      );
    };
    const initialTick = window.setTimeout(tick, 0);
    const timer = activeRound?.ends_at ? window.setInterval(tick, 500) : null;
    return () => {
      window.clearTimeout(initialTick);
      if (timer) window.clearInterval(timer);
    };
  }, [activeRound?.ends_at]);
  async function signedProfile(person: Profile | null) {
    if (!person?.avatar_url) return person;
    const { data } = await supabase.storage
      .from("twf-avatars")
      .createSignedUrl(person.avatar_url, 86400);
    return data?.signedUrl
      ? { ...person, avatar_url: data.signedUrl }
      : { ...person, avatar_url: null };
  }
  async function loadAccount(uid: string) {
    setLoading(true);
    const { data: p } = await supabase
      .from("twf_profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle();
    setProfile(await signedProfile(p));
    if (p) {
      const { data: c } = await supabase
        .from("twf_couples")
        .select("*")
        .or("member_one.eq." + uid + ",member_two.eq." + uid)
        .neq("status", "ended")
        .maybeSingle();
      setCouple(c);
      if (c) {
        const pid = c.member_one === uid ? c.member_two : c.member_one;
        if (pid) {
          const { data: pp } = await supabase
            .from("twf_profiles")
            .select("*")
            .eq("id", pid)
            .single();
          setPartner(await signedProfile(pp));
        }
        const [{ data: h }, { data: q }, { data: active }] = await Promise.all([
          supabase
            .from("twf_game_nights")
            .select("*")
            .eq("couple_id", c.id)
            .eq("status", "completed")
            .order("completed_at", { ascending: false }),
          supabase
            .from("twf_custom_questions")
            .select("id,created_by,game_key,question,created_at")
            .eq("couple_id", c.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("twf_game_nights")
            .select("*")
            .eq("couple_id", c.id)
            .in("status", ["lobby", "playing"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const nights = h || [],
          ids = nights.map((x) => x.id);
        setHistory(nights);
        setCustomQuestions(q || []);
        setResumableNight(active);
        const requestedRoom = new URLSearchParams(window.location.search).get("callRoom");
        const requestedNight = new URLSearchParams(window.location.search).get("callNight");
        if (active && (requestedRoom === active.room_code || requestedNight === active.id)) {
          setNight(active);
          await loadGameState(active.id);
          setView(active.status === "playing" ? "play" : "lobby");
          window.history.replaceState({}, "", window.location.pathname);
        }
        if (ids.length) {
          const [{ data: hp }, { data: gr }] = await Promise.all([
            supabase
              .from("twf_game_night_players")
              .select("game_night_id,user_id,total_score")
              .in("game_night_id", ids),
            supabase
              .from("twf_selected_games")
              .select("game_night_id,game_key,winner_id,scores,status")
              .in("game_night_id", ids)
              .eq("status", "completed"),
          ]);
          setHistoryPlayers(hp || []);
          setGameResults(gr || []);
        } else {
          setHistoryPlayers([]);
          setGameResults([]);
        }
      }
    }
    setLoading(false);
  }
  async function makeProfile(name: string) {
    setBusy(true);
    const { error } = await supabase
      .from("twf_profiles")
      .insert({ id: session!.user.id, display_name: name });
    if (error) setMsg(error.message);
    else await loadAccount(session!.user.id);
    setBusy(false);
  }
  async function makeCouple() {
    setBusy(true);
    const { data, error } = await supabase
      .from("twf_couples")
      .insert({
        member_one: profile!.id,
        name: profile!.display_name + " couple",
      })
      .select()
      .single();
    if (error) setMsg(error.message);
    else setCouple(data);
    setBusy(false);
  }
  async function joinCouple(code: string) {
    setBusy(true);
    const { error } = await supabase.rpc("twf_join_couple", { code });
    if (error) setMsg(error.message);
    else await loadAccount(profile!.id);
    setBusy(false);
  }
  async function saveAvatar(key: string) {
    setBusy(true);
    setPhotoViewerOpen(false);
    await supabase.rpc("twf_set_profile_photo", { p_avatar_path: null });
    const { data, error } = await supabase.rpc("twf_set_avatar", {
      p_avatar_key: key,
    });
    if (error) setMsg(error.message);
    else setProfile(data);
    setBusy(false);
  }
  async function shareProfilePhoto() {
    if (!profile?.avatar_url) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${profile.display_name}'s Twofold profile picture`,
          url: profile.avatar_url,
        });
      } else {
        await navigator.clipboard.writeText(profile.avatar_url);
        setMsg("Profile-photo link copied.");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMsg("The profile photo could not be shared.");
      }
    }
  }
  async function uploadAvatar(file?: File) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > MAX_PROFILE_PHOTO_BYTES
    ) {
      setMsg("Choose a JPG, PNG, or WebP image no larger than 10 MB.");
      return;
    }
    setBusy(true);
    const ext = file.type.split("/")[1].replace("jpeg", "jpg"),
      path = `${profile!.id}/profile-${Date.now()}.${ext}`,
      { error: uploadError } = await supabase.storage
        .from("twf-avatars")
        .upload(path, file, { contentType: file.type });
    if (uploadError) {
      setMsg(uploadError.message);
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.rpc("twf_set_profile_photo", {
        p_avatar_path: path,
      }),
      { data: signed } = await supabase.storage
        .from("twf-avatars")
        .createSignedUrl(path, 86400);
    if (error) setMsg(error.message);
    else {
      setProfile({ ...data, avatar_url: signed?.signedUrl || null });
      setMsg("Profile photo updated.");
    }
    setBusy(false);
  }
  async function saveDisplayName(name: string) {
    setBusy(true);
    const { data, error } = await supabase.rpc("twf_set_display_name", {
      p_display_name: name,
    });
    if (error) setMsg(error.message);
    else {
      setProfile(await signedProfile(data));
      setMsg("Display name updated.");
    }
    setBusy(false);
  }
  async function addCustomQuestion(gameKey: string, question: string) {
    if (!couple || !question.trim()) return;
    const cleaned = question.trim();
    const formatted = gameKey === "memory" && !cleaned.endsWith("?")
      ? `What do you remember about “${cleaned.replace(/[.!]+$/, "")}”?`
      : cleaned;
    setBusy(true);
    const { error } = await supabase.from("twf_custom_questions").insert({
      couple_id: couple.id,
      created_by: profile!.id,
      game_key: gameKey,
      question: formatted,
    });
    if (error) setMsg(error.message);
    else await loadAccount(profile!.id);
    setBusy(false);
  }
  async function editCustomQuestion(id: string, question: string) {
    const cleaned = question.trim();
    if (cleaned.length < 3) return;
    setBusy(true);
    const { error } = await supabase
      .from("twf_custom_questions")
      .update({ question: cleaned })
      .eq("id", id)
      .eq("created_by", profile!.id);
    if (error) setMsg(error.message);
    else setCustomQuestions((items) =>
      items.map((item) => item.id === id ? { ...item, question: cleaned } : item),
    );
    setBusy(false);
  }
  async function deleteCustomQuestion(id: string) {
    setBusy(true);
    const { error } = await supabase
      .from("twf_custom_questions")
      .delete()
      .eq("id", id)
      .eq("created_by", profile!.id);
    if (error) setMsg(error.message);
    else setCustomQuestions((q) => q.filter((x) => x.id !== id));
    setBusy(false);
  }
  async function makeNight() {
    if (!couple || selected.length === 0) {
      setMsg("Choose at least one game first.");
      return;
    }
    if (resumableNight) {
      setMsg("Resume or cancel your active room before creating another.");
      setView("home");
      return;
    }
    setBusy(true);
    const { data: n, error } = await supabase.rpc("twf_create_game_night", {
      p_game_keys: selected,
      p_play_style: playStyle,
      p_difficulty: difficulty,
    });
    if (error) {
      setMsg(error.message);
      setBusy(false);
      return;
    }
    setNight(n);
    setResumableNight(n);
    await loadPlayers(n.id);
    setView("lobby");
    setBusy(false);
  }
  function quickPlay() {
    const picks = gameCategories.flatMap((name) => {
      const pool = GAMES.filter((item) => item.category === name);
      return pool.length ? [pool[Math.floor(Math.random() * pool.length)].key] : [];
    });
    setSelected(picks.slice(0, 5));
    setMsg("A balanced five-game lineup is ready.");
  }
  async function saveCloudPreferences(nextFavorites: string[], nextLineups: string[][]) {
    if (!couple || !profile) return;
    const { error } = await supabase.from("twf_couple_preferences").upsert({
      couple_id: couple.id,
      favorites: nextFavorites,
      saved_lineups: nextLineups,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "couple_id" });
    if (error) setMsg("Your preference was saved on this device but could not sync yet.");
  }
  function toggleFavorite(key: string) {
    const next = favorites.includes(key) ? favorites.filter((item) => item !== key) : [...favorites, key];
    setFavorites(next);
    if (couple) {
      localStorage.setItem(`twf-favorites-${couple.id}`, JSON.stringify(next));
      void saveCloudPreferences(next, savedLineups);
    }
  }
  function saveLineup() {
    if (!couple || !selected.length) return;
    const next = [selected, ...savedLineups.filter((lineup) => lineup.join("|") !== selected.join("|"))].slice(0, 5);
    setSavedLineups(next);
    localStorage.setItem(`twf-lineups-${couple.id}`, JSON.stringify(next));
    void saveCloudPreferences(favorites, next);
    setMsg("Lineup saved and synced across your devices.");
  }
  function moveSelected(gameKey: string, direction: -1 | 1) {
    setSelected((current) => {
      const from = current.indexOf(gameKey);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }
  async function resumeNight() {
    if (!resumableNight) return;
    setBusy(true);
    setNight(resumableNight);
    await loadGameState(resumableNight.id);
    if (resumableNight.status === "lobby") setView("lobby");
    setBusy(false);
  }
  async function abandonNight() {
    if (!resumableNight) return;
    setBusy(true);
    const { error } = await supabase.rpc("twf_cancel_game_night", {
      p_game_night_id: resumableNight.id,
    });
    if (error) setMsg(error.message);
    else {
      setNight(null);
      setResumableNight(null);
      setMsg("Game night cancelled.");
    }
    setBusy(false);
  }
  async function joinRoom(code: string) {
    const { data: n, error } = await supabase
      .from("twf_game_nights")
      .select("*")
      .eq("room_code", code.toUpperCase())
      .single();
    if (error) {
      setMsg("Room not found.");
      return;
    }
    const { error: joinError } = await supabase.rpc("twf_join_game_night", {
      p_game_night_id: n.id,
    });
    if (joinError) {
      setMsg(joinError.message);
      return;
    }
    setNight(n);
    await loadGameState(n.id);
    setView("lobby");
  }
  async function shareRoom() {
    if (!night) return;
    const text = `Join our Twofold game night with room code ${night.room_code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Twofold Game Night", text, url: location.origin });
      } else {
        await navigator.clipboard.writeText(`${text}\n${location.origin}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Closing the native share sheet is not an application error.
    }
  }
  async function copyRoomCode() {
    if (!night) return;
    await navigator.clipboard.writeText(night.room_code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  async function loadPlayers(id: string) {
    const { data } = await supabase
      .from("twf_game_night_players")
      .select("*")
      .eq("game_night_id", id);
    setPlayers(data || []);
  }
  function getPromptPool(gameKey: string) {
    const definition = GAMES.find((g) => g.key === gameKey) || GAMES[0],
      personal = customQuestions
        .filter((q) => q.game_key === gameKey)
        .map((q) => q.question),
      pool = [...personal, ...definition.prompts];
    return [...new Set(pool)];
  }
  function getPrompt(gameKey: string, index: number) {
    const pool = getPromptPool(gameKey);
    return pool[index % pool.length];
  }
  async function pickFreshPrompt(gameKey: string, roundIndex = 0) {
    if (!night) return getPrompt(gameKey, 0);
    const definition = GAMES.find((item) => item.key === gameKey);
    const fullPool = definition?.mode === "speed" ? definition.prompts : getPromptPool(gameKey);
    let candidatePool = definition?.mode === "speed"
      ? fullPool.filter((_, index) => index % 3 === roundIndex % 3)
      : fullPool;
    const level = night.difficulty || difficulty;
    if (candidatePool.length > 12) {
      const third = Math.ceil(candidatePool.length / 3);
      candidatePool = level === "easy" ? candidatePool.slice(0, third)
        : level === "hard" ? candidatePool.slice(third * 2)
          : candidatePool.slice(third, third * 2);
    }
    const { data, error } = await supabase.rpc("twf_pick_fresh_prompt", {
      p_game_night_id: night.id,
      p_game_key: gameKey,
      p_candidates: candidatePool,
    });
    if (error) {
      setMsg(error.message);
      return null;
    }
    return data as string;
  }
  async function loadGameState(id: string) {
    const { data: n } = await supabase
      .from("twf_game_nights")
      .select("*")
      .eq("id", id)
      .single();
    if (!n) return;
    setNight(n);
    setGi(n.current_game_index);
    setRound(n.current_round);
    const { data: sg } = await supabase
      .from("twf_selected_games")
      .select("*")
      .eq("game_night_id", id)
      .order("position");
    const rows = sg || [];
    setSelected(rows.map((x) => x.game_key));
    const current = rows.find((x) => x.position === n.current_game_index);
    if (current) {
      const { data: r } = await supabase
        .from("twf_rounds")
        .select("*")
        .eq("selected_game_id", current.id)
        .eq("round_number", n.current_round)
        .maybeSingle();
      setActiveRound(r);
      if (r) {
        const [{ data: a }, { data: rt }] = await Promise.all([
          supabase
            .from("twf_answers")
            .select("*")
            .eq("round_id", r.id)
            .order("submitted_at"),
          supabase
            .from("twf_creative_ratings")
            .select("*")
            .eq("round_id", r.id),
        ]);
        setAnswers(a || []);
        setRatings(rt || []);
      } else {
        setAnswers([]);
        setRatings([]);
      }
    }
    await loadPlayers(id);
    if (n.status === "playing") setView("play");
    if (n.status === "completed") setView("results");
  }
  async function start() {
    setBusy(true);
    const freshPrompt = await pickFreshPrompt(game.key, 0);
    if (!freshPrompt) {
      setBusy(false);
      return;
    }
    const { error } = await supabase.rpc("twf_start_game_night", {
      p_game_night_id: night!.id,
      p_prompt: freshPrompt,
      p_timed: game.mode === "speed",
    });
    if (error) setMsg(error.message);
    else await loadGameState(night!.id);
    setBusy(false);
  }
  async function submit() {
    if (!answer.trim() || answers.some((a) => a.user_id === profile!.id))
      return;
    setBusy(true);
    const { error } = await supabase.rpc("twf_submit_answer", {
      p_game_night_id: night!.id,
      p_answer: answer,
      p_prompt: prompt,
      p_timed: game.mode === "speed",
    });
    if (error) setMsg(error.message);
    else {
      setAnswer("");
      await loadGameState(night!.id);
    }
    setBusy(false);
  }
  async function advance() {
    const nextGi = round < 2 ? gi : gi + 1,
      nextRound = round < 2 ? round + 1 : 0,
      nextGame = GAMES.find((g) => g.key === selected[nextGi]);
    setBusy(true);
    const nextPrompt = nextGame ? await pickFreshPrompt(nextGame.key, nextRound) : "";
    if (nextGame && !nextPrompt) {
      setBusy(false);
      return;
    }
    const { error } = await supabase.rpc("twf_advance_game", {
      p_game_night_id: night!.id,
      p_next_prompt: nextPrompt,
      p_next_timed: nextGame?.mode === "speed",
    });
    if (error) setMsg(error.message);
    else await loadGameState(night!.id);
    setBusy(false);
  }
  async function requestSkip() {
    if (!activeRound || !night) return;
    setBusy(true);
    const replacement = await pickFreshPrompt(game.key, round);
    if (replacement) {
      const { error } = await supabase.rpc("twf_request_question_skip", {
        p_round_id: activeRound.id,
        p_replacement_prompt: replacement,
      });
      if (error) setMsg(error.message);
      else await loadGameState(night.id);
    }
    setBusy(false);
  }
  async function respondSkip(approve: boolean) {
    if (!activeRound || !night) return;
    setBusy(true);
    const { error } = await supabase.rpc("twf_respond_question_skip", {
      p_round_id: activeRound.id,
      p_approve: approve,
    });
    if (error) setMsg(error.message);
    else await loadGameState(night.id);
    setBusy(false);
  }
  async function reportQuestion() {
    if (!night || !activeRound) return;
    const reason = window.prompt("What is wrong with this question?", "Incorrect or unclear");
    if (!reason?.trim()) return;
    const { error } = await supabase.from("twf_question_reports").insert({
      game_night_id: night.id,
      round_id: activeRound.id,
      reporter_id: profile!.id,
      game_key: game.key,
      prompt,
      reason: reason.trim().slice(0, 500),
    });
    setMsg(error ? error.message : "Question reported. Thank you for helping improve Twofold.");
  }
  async function rateCreative(rating: number) {
    if (!activeRound || !partner || !night) return;
    setBusy(true);
    const { error } = await supabase.rpc("twf_rate_creative_answer", {
      p_round_id: activeRound.id,
      p_target_id: partner.id,
      p_rating: rating,
    });
    if (error) setMsg(error.message);
    else await loadGameState(night.id);
    setBusy(false);
  }
  if (loading)
    return (
      <div className="splash">
        <div className="logoMark">T</div>
        <p>Preparing Twofold…</p>
      </div>
    );
  if (!session) return <Auth />;
  if (!profile) return <Onboard action={makeProfile} busy={busy} msg={msg} />;
  if (!couple)
    return (
      <Pair
        profile={profile}
        create={makeCouple}
        join={joinCouple}
        busy={busy}
        msg={msg}
      />
    );
  const game = GAMES.find((g) => g.key === selected[gi]) || GAMES[0],
    prompt = activeRound?.prompt?.text || getPrompt(game.key, round),
    isHost = night?.created_by === profile.id,
    bothReady = players.length === 2 && players.every((p) => p.ready),
    myScore = players.find((p) => p.user_id === profile.id)?.total_score || 0,
    partnerScore =
      players.find((p) => p.user_id === partner?.id)?.total_score || 0,
    roundRevealed = activeRound?.status === "revealed",
    iAnswered = answers.some((a) => a.user_id === profile.id),
    partnerAnswered = answers.some((a) => a.user_id === partner?.id),
    skipStatus = activeRound?.state?.skip_status,
    skipRequester = activeRound?.state?.skip_requested_by,
    iRequestedSkip = skipRequester === profile.id,
    personalTarget =
      game.key === "knows"
        ? round % 2 === 0
          ? couple.member_one
          : couple.member_two
        : null,
    isPersonalTarget = personalTarget === profile.id,
    turnActor = round % 2 === 0 ? couple.member_one : couple.member_two,
    isActor = turnActor === profile.id,
    roleGame = ["charades", "dontsay", "describe", "secretSignal", "voiceImpression"].includes(game.key),
    creativeNeedsRating = ["draw", "caption", "story"].includes(game.key),
    myRating = ratings.find((item) => item.voter_id === profile.id)?.rating,
    displayPrompt =
      roleGame && !isActor
        ? game.key === "charades"
          ? "Watch your partner act out the secret prompt"
          : "Listen to your partner’s clues and guess the secret prompt"
        : prompt,
    answerGuidance =
      game.key === "knows"
        ? isPersonalTarget
          ? "Answer honestly about yourself. Your answer stays hidden until your partner predicts it."
          : `Predict how ${partner?.display_name || "your partner"} will answer. Their answer stays hidden until reveal.`
        : roleGame
          ? isActor
            ? game.key === "charades"
              ? "Only you can see the prompt. Act it out without speaking."
              : "Only you can see the prompt. Describe it while following the prompt’s restrictions."
            : "When you know the answer, say it aloud and record whether you got it."
          : game.key === "draw"
            ? "Draw the prompt on the shared-style canvas. Both drawings reveal together."
            : game.instructions,
    myNightWins = history.filter((h) => h.winner_id === profile.id).length,
    partnerNightWins = history.filter(
      (h) => h.winner_id === partner?.id,
    ).length,
    myGameWins = gameResults.filter((g) => g.winner_id === profile.id).length,
    partnerGameWins = gameResults.filter(
      (g) => g.winner_id === partner?.id,
    ).length,
    myTotalPoints = historyPlayers
      .filter((p) => p.user_id === profile.id)
      .reduce((sum, p) => sum + (p.total_score || 0), 0),
    partnerTotalPoints = historyPlayers
      .filter((p) => p.user_id === partner?.id)
      .reduce((sum, p) => sum + (p.total_score || 0), 0),
    firstLoss = history.findIndex((h) => h.winner_id !== profile.id),
    currentStreak = firstLoss === -1 ? myNightWins : firstLoss,
    championRows = GAMES.map((g) => ({
      game: g,
      winsMe: gameResults.filter(
        (r) => r.game_key === g.key && r.winner_id === profile.id,
      ).length,
      winsPartner: gameResults.filter(
        (r) => r.game_key === g.key && r.winner_id === partner?.id,
      ).length,
    })).filter((x) => x.winsMe + x.winsPartner > 0);
  return (
    <div className="shell">
      {!online && (
        <div className="offlineBanner">
          You’re offline. Answers cannot be sent until your connection returns.
        </div>
      )}
      <aside>
        <button className="brand" onClick={() => setView("home")}>
          <i>T</i>Twofold
        </button>
        <nav>
          {[
            ["⌂", "Home", "home"],
            ["◇", "Game library", "games"],
            ["♕", "Leaderboard", "leaderboard"],
            ["◷", "Game history", "history"],
            ["♙", "Couple profile", "profile"],
          ].map((x) => (
            <button
              key={x[1]}
              className={view === x[2] ? "active" : ""}
              onClick={() => setView(x[2] as View)}
            >
              <b>{x[0]}</b>
              {x[1]}
            </button>
          ))}
        </nav>
        <div className="online">
          ● &nbsp;{" "}
          {partner ? partner.display_name + " linked" : "Invite pending"}
          <small>
            {partner ? "Private couple space" : "Code: " + couple.invite_code}
          </small>
        </div>
        <button className="profile" onClick={() => setView("profile")}>
          <Avatar person={profile} size="small" />
          <div>
            <b>{profile.display_name}</b>
            <small>
              {partner
                ? "Playing with " + partner.display_name
                : "Waiting for partner"}
            </small>
          </div>
        </button>
      </aside>
      <main>
        <header>
          <strong>Twofold</strong>
          <div className="topIdentity">
            <span className="connectionDot" aria-hidden="true" />
            <div>
              <b>{profile.display_name}</b>
              <small>{partner ? `Paired with ${partner.display_name}` : "Private space"}</small>
            </div>
            <Avatar person={profile} size="small" />
            <button className="notificationButton" aria-label="Open chat" onClick={() => window.dispatchEvent(new Event("twofold:open-chat"))}>💬{chatUnread > 0 && <span>{chatUnread > 9 ? "9+" : chatUnread}</span>}</button>
            <button className="signout" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </header>
        <nav className="mobileNav">
          {[
            ["⌂", "Home", "home"],
            ["◇", "Games", "games"],
            ["♕", "Leaders", "leaderboard"],
            ["◷", "History", "history"],
            ["♙", "Profile", "profile"],
          ].map((x) => (
            <button
              key={x[1]}
              className={view === x[2] ? "active" : ""}
              onClick={() => setView(x[2] as View)}
            >
              <b>{x[0]}</b>
              <span>{x[1]}</span>
            </button>
          ))}
        </nav>
        {msg && (
          <div className="toast" onClick={() => setMsg("")}>
            {msg} ×
          </div>
        )}
        {view === "home" && (
          <div className="page homeDashboard">
            <div className="dashboardGreeting">
              <div>
                <small>YOUR PRIVATE COUPLE SPACE</small>
                <h1>Good evening, {profile.display_name} ♡</h1>
              </div>
            </div>
            {resumableNight && (
              <section className="resumeCard">
                <div>
                  <small>ACTIVE GAME NIGHT</small>
                  <h2>
                    {resumableNight.status === "playing"
                      ? "Your game is still in progress"
                      : "Your room is waiting"}
                  </h2>
                  <p>
                    Room {resumableNight.room_code} · Continue safely on this
                    device.
                  </p>
                </div>
                <div>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={resumeNight}
                  >
                    Resume →
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={abandonNight}
                  >
                    Cancel room
                  </button>
                </div>
              </section>
            )}
            <section className="hero">
              <div className="heroCopy">
                <small>♡ YOUR PRIVATE GAME SPACE</small>
                <h1>
                  Play, laugh,
                  <br />
                  <em>grow closer.</em>
                </h1>
                <p>
                  {partner
                    ? "You and " +
                      partner.display_name +
                      " are ready for another round."
                    : "Share your couple code to connect."}
                </p>
                <div className="heroActions">
                  <button
                    className="primary"
                    disabled={!partner}
                    onClick={() => setView("setup")}
                  >
                    ＋ Create game night
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setView("games")}
                  >
                    Browse all {GAMES.length} games
                  </button>
                </div>
              </div>
              <Image
                className="heroArt"
                src="/couple-hero.svg"
                alt="Two heart-shaped game controllers"
                width={460}
                height={340}
                priority
              />
            </section>
            <div className="title">
              <div>
                <small>YOUR SPACE</small>
                <h2>Good evening, {profile.display_name} ♡</h2>
              </div>
            </div>
            <section className="stats">
              <article className="score">
                <small>GAME NIGHTS</small>
                <h3>{history.length}</h3>
                <p>Completed together</p>
              </article>
              <article>
                <sup>♡</sup>
                <small>GAMES AVAILABLE</small>
                <h3>{GAMES.length}</h3>
                <p>Across five collections</p>
              </article>
              <article>
                <sup>✦</sup>
                <small>COUPLE CODE</small>
                <h3>{couple.invite_code}</h3>
                <p>Private to both partners</p>
              </article>
            </section>
            <section className="joinbox">
              <div>
                <small>JOIN ACTIVE ROOM</small>
                <h2>Have a room code?</h2>
              </div>
              <CodeForm label="Join room" action={joinRoom} />
            </section>
            <section className="coupleDashboardCard">
              <div className="coupleCardHead">
                <div>
                  <small>YOUR COUPLE SPACE</small>
                  <h2>{profile.display_name} &amp; {partner?.display_name || "Partner"}</h2>
                </div>
                <button onClick={() => setView("profile")}>View profile →</button>
              </div>
              <div className="dashboardPair">
                <div><Avatar person={profile} size="large" /><b>{profile.display_name}</b><small>You</small></div>
                <span>♡</span>
                <div><Avatar person={partner} size="large" /><b>{partner?.display_name || "Partner"}</b><small>Partner</small></div>
              </div>
              <div className="coupleCodeRow"><span>Couple code</span><b>{couple.invite_code}</b><button onClick={() => navigator.clipboard.writeText(couple.invite_code)}>Copy</button></div>
            </section>
            <section className="recommendedDashboard">
              <div className="sectionHeading"><div><small>PICK SOMETHING FUN</small><h2>Recommended for you</h2></div><button onClick={() => setView("games")}>View all games →</button></div>
              <div className="recommendGrid">
                {GAMES.slice(0, 4).map((item) => (
                  <article key={item.key}>
                    <b className="gameIcon">{item.icon}</b>
                    <small>{item.category}</small>
                    <h3>{item.title}</h3>
                    <p>{item.instructions}</p>
                    <button onClick={() => { setSelected([item.key]); setView("setup"); }}>Play <span>▶</span></button>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
        {view === "games" && (
          <div className="page board gameLibrary">
            <section className="libraryHero">
              <div>
                <small>♡ EXPLORE TWOFOLD</small>
                <h1>Find your next favorite</h1>
                <p>
                  All {GAMES.length} games are here—browse freely, then build your perfect
                  night.
                </p>
              </div>
              <Image
                src="/couple-hero.svg"
                alt="Romantic game-night illustration"
                width={430}
                height={320}
              />
            </section>
            <div className="categoryPills">
              {["All", ...gameCategories].map(
                (c) => {
                  const count =
                    c === "All"
                      ? GAMES.length
                      : GAMES.filter((g) => g.category === c).length;
                  return (
                    <button
                      key={c}
                      className={category === c ? "active" : ""}
                      onClick={() => setCategory(c)}
                    >
                      <span>{c}</span>
                      <b>{count}</b>
                    </button>
                  );
                },
              )}
            </div>
            <p className="showingCount">
              Showing{" "}
              <b>
                {category === "All"
                  ? GAMES.length
                  : GAMES.filter((g) => g.category === category).length}
              </b>{" "}
              games
            </p>
            <div className="games browseGames">
              {GAMES.filter(
                (g) => category === "All" || g.category === category,
              ).map((g) => (
                <article
                  key={g.key}
                  className={"gameCard " + g.category.toLowerCase()}
                >
                  <div className="cardTop">
                    <b className="gameIcon">{g.icon}</b>
                    <small>{g.category}</small>
                  </div>
                  <h3>{g.title}</h3>
                  <p>{g.instructions}</p>
                  <details>
                    <summary>
                      How to play <span>＋</span>
                    </summary>
                    <ol>
                      {g.prompts.slice(0, 3).map((prompt) => (
                        <li key={prompt}>{prompt}</li>
                      ))}
                    </ol>
                    <p className="promptCount">100 prompts available with repeat protection.</p>
                    <p className="scoringNote">
                      {g.mode === "speed"
                        ? "Correct answers earn 100 points. The first correct answer earns a 25-point speed bonus."
                        : g.mode === "match" || g.mode === "choice"
                          ? "Matching answers earn 100 points for each player."
                          : "Both players participate; personal and creative judging will use player confirmation."}
                    </p>
                  </details>
                </article>
              ))}
            </div>
            {partner && (
              <button
                className="primary libraryCreate"
                onClick={() => setView("setup")}
              >
                Create a game night →
              </button>
            )}
          </div>
        )}
        {view === "setup" && (
          <div className="page">
            <button className="back" onClick={() => setView("home")}>
              ← Back
            </button>
            <div className="setupHead">
              <div>
                <small>GAME NIGHT · STEP 1 OF 2</small>
                <h1>Build tonight’s lineup</h1>
                <p>Select exactly what you want to play.</p>
              </div>
              <div className="count">
                <b>{selected.length}</b> selected
              </div>
            </div>
            <section className="setupShortcuts">
              <div>
                <small>QUICK START</small>
                <h2>Build a balanced night instantly</h2>
                <p>Quick Play chooses one game from each collection. You can still rearrange everything.</p>
              </div>
              <button className="primary" onClick={quickPlay}>✦ Quick Play</button>
              <button className="secondary" disabled={!selected.length} onClick={saveLineup}>Save lineup</button>
            </section>
            <section className="nightSettings" aria-label="Game-night settings">
              <label>
                <span>Play style</span>
                <select value={playStyle} onChange={(event) => setPlayStyle(event.target.value as "competitive" | "cooperative")}>
                  <option value="competitive">Competitive · crown a winner</option>
                  <option value="cooperative">Cooperative · build one team score</option>
                </select>
              </label>
              <label>
                <span>Difficulty</span>
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as "easy" | "standard" | "hard")}>
                  <option value="easy">Easy</option>
                  <option value="standard">Standard</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
            </section>
            {savedLineups.length > 0 && (
              <div className="savedLineups">
                <b>Saved lineups</b>
                {savedLineups.map((lineup, index) => (
                  <button key={lineup.join("-")} onClick={() => setSelected(lineup)}>
                    Lineup {index + 1} · {lineup.length} games
                  </button>
                ))}
              </div>
            )}
            <section className="lineupBuilder" aria-label="Selected game lineup">
              <div className="lineupBuilderHead">
                <div>
                  <small>STEP 2 · ARRANGE &amp; CONTINUE</small>
                  <h2>Your game-night lineup</h2>
                  <p>
                    Use the arrows to set the play order, then create your
                    private room.
                  </p>
                </div>
                <button
                  className="primary createRoomTop"
                  disabled={selected.length === 0 || busy}
                  onClick={makeNight}
                >
                  {busy ? "Creating room…" : "Create room & continue →"}
                </button>
              </div>
              {selected.length ? (
                <ol className="selectedLineup">
                  {selected.map((key, index) => {
                    const chosen = GAMES.find((item) => item.key === key);
                    return (
                      <li key={key}>
                        <b>{index + 1}</b>
                        <span aria-hidden="true">{chosen?.icon}</span>
                        <strong>{chosen?.title}</strong>
                        <div>
                          <button
                            type="button"
                            aria-label={`Move ${chosen?.title} earlier`}
                            disabled={index === 0}
                            onClick={() => moveSelected(key, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${chosen?.title} later`}
                            disabled={index === selected.length - 1}
                            onClick={() => moveSelected(key, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="removeLineup"
                            aria-label={`Remove ${chosen?.title}`}
                            onClick={() =>
                              setSelected((items) =>
                                items.filter((item) => item !== key),
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="emptyLineup">Choose at least one game below.</p>
              )}
            </section>
            <div className="categoryGroups">
              {gameCategories.map((group, groupIndex) => {
                const groupGames = GAMES.filter((item) => item.category === group);
                const selectedCount = groupGames.filter((item) => selected.includes(item.key)).length;
                return (
                  <details key={group} open={groupIndex === 0 || selectedCount > 0}>
                    <summary>
                      <span><b>{group}</b><small>{groupGames.length} games</small></span>
                      <em>{selectedCount ? `${selectedCount} selected` : "Open collection"}</em>
                    </summary>
                    <div className="games">
                      {groupGames.map((g) => (
                        <div role="button" tabIndex={0} key={g.key} className={selected.includes(g.key) ? "selected" : ""} onClick={() => setSelected((items) => items.includes(g.key) ? items.filter((item) => item !== g.key) : [...items, g.key])} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected((items) => items.includes(g.key) ? items.filter((item) => item !== g.key) : [...items, g.key]); } }}>
                          <i>{selected.includes(g.key) ? "✓" : "+"}</i>
                          <button type="button" className="favoriteGame" aria-label={`${favorites.includes(g.key) ? "Remove" : "Add"} ${g.title} ${favorites.includes(g.key) ? "from" : "to"} favourites`} onClick={(event) => { event.stopPropagation(); toggleFavorite(g.key); }}>{favorites.includes(g.key) ? "★" : "☆"}</button>
                          <b className="gameIcon">{g.icon}</b>
                          <small>{g.category} · 100 prompts</small>
                          <h3>{g.title}</h3>
                          <p>{g.instructions}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
            <footer>
              <span>
                {selected.length} games · About {selected.length * 4} min
              </span>
              <button
                className="primary"
                disabled={selected.length === 0 || busy}
                onClick={makeNight}
              >
                {busy ? "Creating room…" : "Create room & continue →"}
              </button>
            </footer>
            <div className="mobileSetupAction">
              <span>{selected.length} selected</span>
              <button
                className="primary"
                disabled={selected.length === 0 || busy}
                onClick={makeNight}
              >
                {busy ? "Creating…" : "Create room & continue →"}
              </button>
            </div>
          </div>
        )}
        {view === "lobby" && night && (
          <div className="center">
            <small>PRIVATE GAME NIGHT</small>
            <h1>Your room is ready</h1>
            <p>Both devices update automatically.</p>
            <div className="code">
              <b>{night.room_code}</b>
              <button onClick={copyRoomCode}>
                {copied ? "✓ Copied" : "▣ Copy"}
              </button>
            </div>
            <button className="shareRoom" onClick={shareRoom}>
              ↗ Share room invitation
            </button>
            <div className="players">
              <div>
                <Avatar person={profile} size="large" />
                <h3>{profile.display_name}</h3>
                <small>
                  {players.find((p) => p.user_id === profile.id)?.ready
                    ? "Ready"
                    : "Not ready"}
                </small>
              </div>
              <b>·· VS ··</b>
              <div>
                <Avatar person={partner} size="large" />
                <h3>{partner?.display_name}</h3>
                <small>
                  {players.find((p) => p.user_id === partner?.id)?.ready
                    ? "Ready"
                    : "Joining…"}
                </small>
              </div>
            </div>
            <section className="lobbyLineup">
              <div>
                <small>TONIGHT&apos;S LINEUP</small>
                <b>{selected.length} {selected.length === 1 ? "game" : "games"}</b>
              </div>
              <ol>
                {selected.map((key, index) => {
                  const chosen = GAMES.find((item) => item.key === key);
                  return (
                    <li key={key}>
                      <span>{index + 1}</span>
                      <i>{chosen?.icon}</i>
                      <b>{chosen?.title}</b>
                    </li>
                  );
                })}
              </ol>
            </section>
            {isHost ? (
              <div className="lobbyStart">
                {!bothReady && (
                  <p>
                    Your partner must open this room and show as Ready before
                    the game can begin.
                  </p>
                )}
                <button
                  className="primary wide"
                  disabled={!bothReady || busy}
                  onClick={start}
                >
                  {bothReady
                    ? "Start game night →"
                    : "Waiting for partner to join & get ready"}
                </button>
              </div>
            ) : (
              <p>Waiting for the room creator to start…</p>
            )}
          </div>
        )}
        {view === "play" && (
          <div className="play">
            <div className="playTop">
              <button onClick={() => setView("home")}>×</button>
              <div>
                <small>
                  GAME {gi + 1} OF {selected.length}
                </small>
                <b>{game.title}</b>
              </div>
              <span>
                {timeLeft !== null && <>⏱ {timeLeft}s · </>}Score{" "}
                <b>{myScore}</b>
              </span>
            </div>
            <div className="progress">
              <i
                style={{
                  width:
                    ((gi * 3 + round + 1) / (selected.length * 3)) * 100 + "%",
                }}
              />
            </div>
            <section className="question">
              <small>
                ROUND {round + 1} · {game.category.toUpperCase()}
              </small>
              <h1>{displayPrompt}</h1>
              <p>{answerGuidance}</p>
              <details className="gameTutorial">
                <summary>How this round works</summary>
                <p>{game.instructions}</p>
                <small>{game.mode === "speed" ? "Correct answers score 100 points, with a 25-point first-answer bonus." : "Lock answers privately. Both answers reveal only after the round closes."}</small>
              </details>
              <button className="reportQuestion" onClick={reportQuestion}>Report a problem with this question</button>
              {!roundRevealed && !iAnswered && !partnerAnswered && (
                <div className="skipQuestion">
                  {skipStatus === "requested" ? (
                    iRequestedSkip ? (
                      <p>Skip requested — waiting for your partner to approve.</p>
                    ) : (
                      <>
                        <p>Your partner would like a different question.</p>
                        <button className="secondary" disabled={busy} onClick={() => respondSkip(false)}>
                          Keep this one
                        </button>
                        <button className="primary" disabled={busy} onClick={() => respondSkip(true)}>
                          Approve skip
                        </button>
                      </>
                    )
                  ) : (
                    <button className="skipButton" disabled={busy} onClick={requestSkip}>
                      ↷ Ask to skip question
                    </button>
                  )}
                </div>
              )}
              {game.key === "knows" && (
                <div className="secretRole">
                  <span>
                    {isPersonalTarget ? "♡ Your truth" : "✦ Your prediction"}
                  </span>
                  <small>Secret until both answers are locked</small>
                </div>
              )}
              {game.key === "draw" ? (
                <DrawingPad
                  disabled={iAnswered}
                  value={answer}
                  onChange={setAnswer}
                />
              ) : roleGame ? (
                <div className="turnChoices">
                  {isActor ? (
                    <button
                      className={answer === "acted" ? "chosen" : ""}
                      onClick={() => setAnswer("acted")}
                    >
                      ✓ I gave the clues
                    </button>
                  ) : (
                    <>
                      <button
                        className={answer === "guessed" ? "chosen" : ""}
                        onClick={() => setAnswer("guessed")}
                      >
                        ✓ We guessed it
                      </button>
                      <button
                        className={answer === "pass" ? "chosen" : ""}
                        onClick={() => setAnswer("pass")}
                      >
                        ↷ Pass this one
                      </button>
                    </>
                  )}
                </div>
              ) : game.mode === "choice" ? (
                <div className="choiceGrid">
                  {choiceOptions(
                    game.key,
                    prompt,
                    profile.display_name,
                    partner?.display_name || "Partner",
                  ).map((x) => (
                    <button
                      key={x}
                      disabled={iAnswered}
                      className={answer === x ? "chosen" : ""}
                      onClick={() => setAnswer(x)}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              ) : game.key === "truth" ? (
                <ThreeStatements
                  value={answer}
                  onChange={setAnswer}
                  disabled={iAnswered}
                />
              ) : game.key === "timeline" ? (
                <TimelineAnswer
                  value={answer}
                  onChange={setAnswer}
                  disabled={iAnswered}
                />
              ) : game.key === "matchFive" ? (
                <FiveAnswerList
                  value={answer}
                  onChange={setAnswer}
                  disabled={iAnswered}
                />
              ) : game.key === "wavelength" ? (
                <WavelengthAnswer
                  value={answer}
                  onChange={setAnswer}
                  disabled={iAnswered}
                  prompt={displayPrompt}
                />
              ) : (
                <textarea
                  disabled={iAnswered}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={
                    game.mode === "speed"
                      ? "Answer quickly…"
                      : game.key === "knows" && !isPersonalTarget
                        ? "Type your prediction…"
                        : game.key === "caption"
                          ? "Write your funniest caption…"
                          : game.key === "story"
                            ? "Continue the story in a few sentences…"
                            : "Type your answer…"
                  }
                  maxLength={500}
                />
              )}
              <button
                className="primary"
                disabled={
                  !answer.trim() ||
                  iAnswered ||
                  busy ||
                  (timeLeft === 0 && game.mode === "speed")
                }
                onClick={submit}
              >
                {iAnswered ? "Answer locked" : "Lock in answer"}
              </button>
              <p className="answerStatus">
                {iAnswered ? "✓ Your answer is locked" : "Waiting for you"} ·{" "}
                {roundRevealed
                  ? "Both answers revealed"
                  : "Partner’s answer is hidden"}
              </p>
              {roundRevealed && (
                <div className="roundReveal">
                  <h3>Round scores</h3>
                  {answers.map((a) => (
                    <div className="revealedAnswer" key={a.id}>
                      <b>
                        {a.user_id === profile.id
                          ? profile.display_name
                          : partner?.display_name}
                      </b>
                      {game.key === "draw" ? (
                        <DrawingPreview value={a.answer?.value} />
                      ) : (
                        <span>{a.answer?.value}</span>
                      )}
                      <strong>+{a.points}</strong>
                    </div>
                  ))}
                </div>
              )}
              {roundRevealed && creativeNeedsRating && (
                <RatingControl
                  value={myRating}
                  disabled={busy}
                  partnerName={partner?.display_name || "Partner"}
                  onRate={rateCreative}
                />
              )}
              {isHost ? (
                <button
                  className="secondary nextRound"
                  disabled={
                    busy ||
                    (!roundRevealed && timeLeft !== 0) ||
                    (creativeNeedsRating && ratings.length < 2)
                  }
                  onClick={advance}
                >
                  {round < 2
                    ? "Next round"
                    : gi < selected.length - 1
                      ? "Next game"
                      : "Finish"}{" "}
                  →
                </button>
              ) : (
                <p>
                  {roundRevealed
                    ? "Waiting for the room creator to continue…"
                    : "Answers reveal after both players lock in."}
                </p>
              )}
            </section>
          </div>
        )}
        {view === "results" && night && (
          <div className="center results">
            <div className="cup">♕</div>
            <small>GAME NIGHT COMPLETE</small>
            <h1>
              {night.play_style === "cooperative"
                ? "Team victory!"
                : night.winner_id === profile.id
                ? profile.display_name + " wins!"
                : night.winner_id === partner?.id
                  ? partner?.display_name + " wins!"
                  : "It’s a tie!"}
            </h1>
            <p>
              {night.play_style === "cooperative"
                ? `Together you earned ${myScore + partnerScore} points.`
                : `${profile.display_name}: ${myScore} points · ${partner?.display_name}: ${partnerScore} points`}
            </p>
            <section className="nightRecap">
              <article><b>{selected.length}</b><span>Games completed</span></article>
              <article><b>{selected.length * 3}</b><span>Questions played</span></article>
              <article><b>{myScore + partnerScore}</b><span>Combined points</span></article>
              <article><b>{night.play_style === "cooperative" ? "Team" : "Final"}</b><span>{night.play_style === "cooperative" ? "Shared achievement" : "Winner recorded"}</span></article>
            </section>
            <button
              className="primary"
              onClick={() => {
                setGi(0);
                setRound(0);
                setActiveRound(null);
                setAnswers([]);
                setView("setup");
              }}
            >
              Play again
            </button>
          </div>
        )}
        {view === "history" && (
          <Simple
            title="Game-night history"
            intro="Every completed night, score, and winner is saved."
          >
            {history.length ? (
              history.map((h) => {
                const mine =
                    historyPlayers.find(
                      (p) =>
                        p.game_night_id === h.id && p.user_id === profile.id,
                    )?.total_score || 0,
                  theirs =
                    historyPlayers.find(
                      (p) =>
                        p.game_night_id === h.id && p.user_id === partner?.id,
                    )?.total_score || 0,
                  count = gameResults.filter(
                    (g) => g.game_night_id === h.id,
                  ).length;
                return (
                  <div className="historyRow detailed" key={h.id}>
                    <span>
                      {h.winner_id === profile.id
                        ? "♕"
                        : h.winner_id === partner?.id
                          ? "♡"
                          : "＝"}
                    </span>
                    <div>
                      <b>
                        {h.winner_id === profile.id
                          ? profile.display_name + " won"
                          : h.winner_id === partner?.id
                            ? partner?.display_name + " won"
                            : "Tie game"}
                      </b>
                      <small>
                        {new Date(h.completed_at).toLocaleDateString()} ·{" "}
                        {count} games · Room {h.room_code}
                      </small>
                    </div>
                    <strong>
                      {mine}–{theirs}
                    </strong>
                  </div>
                );
              })
            ) : (
              <p>No completed nights yet.</p>
            )}
          </Simple>
        )}
        {view === "leaderboard" && (
          <Simple
            title="The friendly rivalry"
            intro="Points, individual games, and complete game-night wins."
          >
            <div className="leaders">
              <div>
                <Avatar person={profile} size="large" />
                <h2>{profile.display_name}</h2>
                <strong>{myNightWins}</strong>
                <small>GAME NIGHTS WON</small>
              </div>
              <span>━━━━ ● ━━━━</span>
              <div>
                <Avatar person={partner} size="large" />
                <h2>{partner?.display_name}</h2>
                <strong>{partnerNightWins}</strong>
                <small>GAME NIGHTS WON</small>
              </div>
            </div>
            <div className="statGrid">
              <article>
                <small>TOTAL POINTS</small>
                <b>{myTotalPoints}</b>
                <span>{profile.display_name}</span>
                <b>{partnerTotalPoints}</b>
                <span>{partner?.display_name}</span>
              </article>
              <article>
                <small>GAMES WON</small>
                <b>{myGameWins}</b>
                <span>{profile.display_name}</span>
                <b>{partnerGameWins}</b>
                <span>{partner?.display_name}</span>
              </article>
              <article>
                <small>CURRENT STREAK</small>
                <b>{currentStreak}</b>
                <span>{currentStreak === 1 ? "night" : "nights"}</span>
              </article>
            </div>
            <div className="table champions">
              <h2>Individual game champions</h2>
              {championRows.length ? (
                championRows.map((row) => (
                  <div key={row.game.key}>
                    <span>
                      {row.game.icon} {row.game.title}
                    </span>
                    <b>{row.winsMe}</b>
                    <i>–</i>
                    <b>{row.winsPartner}</b>
                  </div>
                ))
              ) : (
                <p>Complete your first game night to crown champions.</p>
              )}
            </div>
            <AchievementGrid
              nights={history.length}
              gameWins={myGameWins}
              points={myTotalPoints}
              streak={currentStreak}
            />
          </Simple>
        )}
        {view === "profile" && (
          <Simple
            title="Your couple space"
            intro="Only you and your linked partner can see this data."
          >
            <div className="profilePair">
              <div>
                <Avatar person={profile} size="large" />
                <b>{profile.display_name}</b>
              </div>
              <span>♡</span>
              <div>
                <Avatar person={partner} size="large" />
                <b>{partner?.display_name || "Partner"}</b>
              </div>
            </div>
            <ProfileSettings
              profile={profile}
              busy={busy}
              save={saveDisplayName}
            />
            <div className="accountCard avatarSettings">
              <small>YOUR PROFILE PICTURE</small>
              <h3>Choose your look</h3>
              <p>
                Upload a photo or pick an illustrated avatar. You can change it
                whenever you like.
              </p>
              <div className="currentAvatarChoice">
                <div className="profilePhotoControl">
                  <button
                    type="button"
                    className="profilePhotoPreviewButton"
                    onClick={() => profile.avatar_url && setPhotoViewerOpen(true)}
                    aria-label={profile.avatar_url ? "Open profile picture" : "Current illustrated avatar"}
                    disabled={!profile.avatar_url}
                  >
                    <Avatar person={profile} size="large" />
                  </button>
                  <label className="profilePhotoCamera" aria-label="Change profile picture">
                    📷
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy}
                      onChange={(e) => {
                        void uploadAvatar(e.target.files?.[0]);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                <div>
                  <small>CURRENT PROFILE PICTURE</small>
                  <b>
                    {profile.avatar_url
                      ? "Your uploaded photo"
                      : AVATARS.find((item) => item.key === profile.avatar_key)
                          ?.label || "Illustrated avatar"}
                  </b>
                  <span>
                    {profile.avatar_url
                      ? "Active on your profile"
                      : "Choose a photo below to replace it"}
                  </span>
                </div>
              </div>
              <label className="photoUpload">
                <span>＋ Upload profile photo</span>
                <small>JPG, PNG, or WebP · maximum 10 MB</small>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(e) => uploadAvatar(e.target.files?.[0])}
                />
              </label>
              <div className="avatarGrid">
                {AVATARS.map((a) => (
                  <button
                    key={a.key}
                    className={
                      !profile.avatar_url && profile.avatar_key === a.key
                        ? "selected"
                        : ""
                    }
                    disabled={busy}
                    onClick={() => saveAvatar(a.key)}
                    aria-label={a.label}
                  >
                    <span
                      style={{
                        background: `linear-gradient(135deg,${a.colors[0]},${a.colors[1]})`,
                      }}
                    >
                      {a.icon}
                    </span>
                    <small>{a.label}</small>
                  </button>
                ))}
              </div>
            </div>
            {photoViewerOpen && profile.avatar_url && (
              <div className="profilePhotoViewer" role="dialog" aria-modal="true" aria-label="Profile picture viewer">
                <header>
                  <button type="button" onClick={() => setPhotoViewerOpen(false)} aria-label="Close profile picture">←</button>
                  <b>Profile picture</b>
                  <div>
                    <label aria-label="Replace profile picture">
                      ✎
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(e) => {
                          void uploadAvatar(e.target.files?.[0]);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button type="button" onClick={shareProfilePhoto} aria-label="Share profile picture">↗</button>
                  </div>
                </header>
                <div className="profilePhotoViewerImage">
                  <Image
                    src={profile.avatar_url}
                    alt={`${profile.display_name} profile picture`}
                    width={1080}
                    height={1080}
                    unoptimized
                    priority
                  />
                </div>
              </div>
            )}
            <CustomQuestionManager
              questions={customQuestions}
              currentUser={profile.id}
              busy={busy}
              add={addCustomQuestion}
              edit={editCustomQuestion}
              remove={deleteCustomQuestion}
            />
            <SecuritySettings email={session.user.email || ""} />
            <div className="accountCard">
              <h3>
                {profile.display_name} & {partner?.display_name || "Partner"}
              </h3>
              <p>
                Couple code: <b>{couple.invite_code}</b>
              </p>
              <p>
                Your private room and custom questions are accessible only to
                both linked accounts.
              </p>
            </div>
          </Simple>
        )}
        {couple && partner && <CoupleChat coupleId={couple.id} userId={profile.id} partnerName={partner.display_name} />}
        {couple && partner && (
          <RoomCommunication
            nightId={night?.id}
            coupleId={couple.id}
            userId={profile.id}
            partnerId={partner.id}
            partnerName={partner.display_name}
            chatEnabled={false}
          />
        )}
      </main>
    </div>
  );
}
function Auth() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r =
      mode === "signup"
        ? await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: location.origin },
          })
        : mode === "forgot"
          ? await supabase.auth.resetPasswordForEmail(email, {
              redirectTo: location.origin,
            })
          : await supabase.auth.signInWithPassword({ email, password });
    setMsg(
      r.error?.message ||
        (mode === "signup"
          ? "Check your email to confirm your account."
          : mode === "forgot"
            ? "Reset email sent."
            : ""),
    );
    setBusy(false);
  }
  return (
    <div className="authPage">
      <section className="authBrand">
        <div className="logoMark">T</div>
        <h1>
          Game night,
          <br />
          <em>just for two.</em>
        </h1>
        <p>Choose games, play live, and keep the rivalry going.</p>
      </section>
      <section className="authPanel">
        <div>
          <small>WELCOME TO TWOFOLD</small>
          <h2>
            {mode === "login"
              ? "Sign in"
              : mode === "signup"
                ? "Create your account"
                : "Reset password"}
          </h2>
          <form onSubmit={go}>
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {mode !== "forgot" && (
              <label>
                Password
                <input
                  type="password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send reset email"}
            </button>
          </form>
          <button
            className="google"
            onClick={() =>
              supabase.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: location.origin },
              })
            }
          >
            G &nbsp; Continue with Google
          </button>
          {msg && <p className="formMsg">{msg}</p>}
          <div className="authLinks">
            <button
              onClick={() => setMode(mode === "signup" ? "login" : "signup")}
            >
              {mode === "signup" ? "Sign in instead" : "Create an account"}
            </button>
            <button onClick={() => setMode("forgot")}>Forgot password?</button>
          </div>
          <div className="legalLinks">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/support">Support</a>
          </div>
        </div>
      </section>
    </div>
  );
}
function Onboard({
  action,
  busy,
  msg,
}: {
  action: (n: string) => void;
  busy: boolean;
  msg: string;
}) {
  const [n, setN] = useState("");
  return (
    <div className="soloCard">
      <div className="logoMark">T</div>
      <small>ONE LAST STEP</small>
      <h1>Create your profile</h1>
      <p>Choose the name your partner will see.</p>
      <input
        value={n}
        onChange={(e) => setN(e.target.value)}
        maxLength={40}
        placeholder="Display name"
      />
      <button
        className="primary"
        disabled={!n.trim() || busy}
        onClick={() => action(n.trim())}
      >
        Continue
      </button>
      {msg && <p>{msg}</p>}
    </div>
  );
}
function Pair({
  profile,
  create,
  join,
  busy,
  msg,
}: {
  profile: Profile;
  create: () => void;
  join: (x: string) => void;
  busy: boolean;
  msg: string;
}) {
  return (
    <div className="soloCard">
      <div className="logoMark">T</div>
      <small>WELCOME, {profile.display_name.toUpperCase()}</small>
      <h1>Connect your couple</h1>
      <p>
        One partner creates the space. The other joins with its private code.
      </p>
      <button className="primary" disabled={busy} onClick={create}>
        Create couple space
      </button>
      <span>or</span>
      <CodeForm label="Join couple" action={join} />
      {msg && <p>{msg}</p>}
    </div>
  );
}
function CodeForm({
  label,
  action,
}: {
  label: string;
  action: (x: string) => void;
}) {
  const [c, setC] = useState("");
  return (
    <form
      className="codeForm"
      onSubmit={(e) => {
        e.preventDefault();
        if (c.trim()) action(c);
      }}
    >
      <input
        value={c}
        onChange={(e) => setC(e.target.value.toUpperCase())}
        placeholder="Enter code"
      />
      <button>{label}</button>
    </form>
  );
}
function ProfileSettings({
  profile,
  busy,
  save,
}: {
  profile: Profile;
  busy: boolean;
  save: (name: string) => void;
}) {
  const [name, setName] = useState(profile.display_name);
  return (
    <div className="accountCard profileSettings">
      <small>PROFILE DETAILS</small>
      <h3>Your display name</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(name.trim());
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={40}
        />
        <button
          className="primary"
          disabled={
            busy ||
            name.trim().length < 2 ||
            name.trim() === profile.display_name
          }
        >
          Save name
        </button>
      </form>
    </div>
  );
}
function SecuritySettings({ email }: { email: string }) {
  const [password, setPassword] = useState(""),
    [newEmail, setNewEmail] = useState(email),
    [deleteText, setDeleteText] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function change(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setMessage(error?.message || "Password updated successfully.");
    if (!error) setPassword("");
    setBusy(false);
  }
  async function reset() {
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin,
    });
    setMessage(error?.message || "Password-reset email sent.");
    setBusy(false);
  }
  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({
      email: newEmail.trim(),
    });
    setMessage(
      error?.message ||
        "Confirmation links were sent to verify your email change.",
    );
    setBusy(false);
  }
  async function deleteAccount() {
    if (deleteText !== "DELETE") return;
    setBusy(true);
    const { error } = await supabase.rpc("twf_delete_my_account");
    if (error) {
      setMessage(error.message);
      setBusy(false);
    } else {
      await supabase.auth.signOut();
    }
  }
  async function exportData() {
    setBusy(true);
    const { data, error } = await supabase.rpc("twf_export_my_data");
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `twofold-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Your Twofold data export was downloaded.");
    setBusy(false);
  }
  return (
    <div className="accountCard securitySettings">
      <small>ACCOUNT SECURITY</small>
      <h3>Sign-in and password</h3>
      <p>{email}</p>
      <form onSubmit={changeEmail}>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
        <button
          className="secondary"
          disabled={busy || !newEmail.includes("@") || newEmail === email}
        >
          Change email
        </button>
      </form>
      <form onSubmit={change}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          placeholder="Enter a new password"
        />
        <button className="primary" disabled={busy || password.length < 8}>
          Update password
        </button>
      </form>
      <button className="secondary" disabled={busy} onClick={reset}>
        Send password-reset email
      </button>
      <button className="secondary" disabled={busy} onClick={exportData}>
        Download my Twofold data
      </button>
      {message && <p className="formMsg">{message}</p>}
      <details className="dangerZone">
        <summary>Delete my account and data</summary>
        <p>
          This permanently deletes your profile, couple space, questions,
          scores, and game history. This cannot be undone.
        </p>
        <input
          value={deleteText}
          onChange={(e) => setDeleteText(e.target.value)}
          placeholder="Type DELETE to confirm"
        />
        <button
          type="button"
          disabled={busy || deleteText !== "DELETE"}
          onClick={deleteAccount}
        >
          Permanently delete account
        </button>
      </details>
    </div>
  );
}
function AchievementGrid({
  nights,
  gameWins,
  points,
  streak,
}: {
  nights: number;
  gameWins: number;
  points: number;
  streak: number;
}) {
  const items = [
    {
      icon: "♡",
      name: "First Night",
      done: nights >= 1,
      detail: "Complete one game night",
    },
    {
      icon: "♕",
      name: "Game Champion",
      done: gameWins >= 5,
      detail: "Win five individual games",
    },
    {
      icon: "✦",
      name: "Point Collector",
      done: points >= 1000,
      detail: "Earn 1,000 total points",
    },
    {
      icon: "⚡",
      name: "On a Roll",
      done: streak >= 3,
      detail: "Win three nights in a row",
    },
  ];
  return (
    <section className="achievements">
      <h2>Achievements</h2>
      <div>
        {items.map((item) => (
          <article key={item.name} className={item.done ? "earned" : "locked"}>
            <b>{item.icon}</b>
            <span>
              <strong>{item.name}</strong>
              <small>{item.done ? "Earned" : item.detail}</small>
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
function choiceOptions(
  gameKey: string,
  prompt: string,
  me: string,
  partner: string,
) {
  if (["would", "blitz"].includes(gameKey)) {
    const cleaned = prompt.replace(/\?$/, "");
    const parts = cleaned.split(/\s+or\s+/i);
    if (parts.length === 2) return parts;
  }
  return [me, partner];
}
function RatingControl({
  value,
  disabled,
  partnerName,
  onRate,
}: {
  value?: number;
  disabled: boolean;
  partnerName: string;
  onRate: (rating: number) => void;
}) {
  return (
    <div className="ratingControl">
      <b>
        {value
          ? `You rated ${partnerName} ${value}/3`
          : `Rate ${partnerName}’s entry`}
      </b>
      <span>
        {[1, 2, 3].map((rating) => (
          <button
            key={rating}
            className={value === rating ? "selected" : ""}
            disabled={disabled}
            onClick={() => onRate(rating)}
            aria-label={`${rating} out of 3 points`}
          >
            {rating === 1 ? "♡" : rating === 2 ? "♡♡" : "♡♡♡"}
            <small>
              {rating === 1 ? "Nice" : rating === 2 ? "Great" : "Winner"}
            </small>
          </button>
        ))}
      </span>
    </div>
  );
}
function ThreeStatements({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const rows = (value || "\n\n").split("\n").slice(0, 3);
  while (rows.length < 3) rows.push("");
  function setRow(index: number, text: string) {
    const next = [...rows];
    next[index] = text.replace(/\n/g, " ");
    onChange(next.join("\n"));
  }
  return (
    <div className="structuredAnswer">
      <small>
        Enter exactly two truths and one lie. Do not reveal which is the lie
        yet.
      </small>
      {rows.map((row, index) => (
        <label key={index}>
          <b>{index + 1}</b>
          <input
            disabled={disabled}
            value={row}
            maxLength={150}
            onChange={(e) => setRow(index, e.target.value)}
            placeholder={`Statement ${index + 1}`}
          />
        </label>
      ))}
    </div>
  );
}
function TimelineAnswer({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const rows = (value || "\n\n").split("\n").slice(0, 3);
  while (rows.length < 3) rows.push("");
  function setRow(index: number, text: string) {
    const next = [...rows];
    next[index] = text.replace(/\n/g, " ");
    onChange(next.join("\n"));
  }
  return (
    <div className="structuredAnswer">
      <small>Place the moments from earliest to latest.</small>
      {rows.map((row, index) => (
        <label key={index}>
          <b>{index + 1}</b>
          <input
            disabled={disabled}
            value={row}
            maxLength={150}
            onChange={(e) => setRow(index, e.target.value)}
            placeholder={
              index === 0
                ? "Earliest moment"
                : index === 2
                  ? "Latest moment"
                  : "Middle moment"
            }
          />
        </label>
      ))}
    </div>
  );
}
function FiveAnswerList({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const rows = value ? value.split(",").slice(0, 5) : [];
  while (rows.length < 5) rows.push("");
  function setRow(index: number, text: string) {
    const next = [...rows];
    next[index] = text.replace(/[,;\n]/g, " ");
    onChange(next.join(","));
  }
  return (
    <div className="structuredAnswer fiveAnswerList">
      <small>Enter five different answers. You earn points for every answer that also appears on your partner’s list.</small>
      {rows.map((row, index) => (
        <label key={index}>
          <b>{index + 1}</b>
          <input disabled={disabled} value={row} maxLength={80} onChange={(event) => setRow(index, event.target.value)} placeholder={`Answer ${index + 1}`} />
        </label>
      ))}
    </div>
  );
}
function WavelengthAnswer({
  value,
  onChange,
  disabled,
  prompt,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  prompt: string;
}) {
  const ends = prompt.split("↔").map((part) => part.trim().replace(/\s*\(.+$/, ""));
  return (
    <div className="wavelengthAnswer">
      <div><b>{ends[0] || "First"}</b><span>Choose secretly</span><b>{ends[1] || "Second"}</b></div>
      <div role="radiogroup" aria-label="Choose a position on the wavelength">
        {[1, 2, 3, 4, 5, 6, 7].map((point) => (
          <button key={point} type="button" role="radio" aria-checked={value === String(point)} disabled={disabled} className={value === String(point) ? "chosen" : ""} onClick={() => onChange(String(point))}>{point}</button>
        ))}
      </div>
      <small>1 is closest to the first idea; 7 is closest to the second.</small>
    </div>
  );
}
function drawingLines(value?: string) {
  return (value || "")
    .split("|")
    .filter(Boolean)
    .map((path) =>
      path
        .split(" ")
        .filter(Boolean)
        .map((point) => point.split(",").map(Number))
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
    );
}
function DrawingPreview({ value }: { value?: string }) {
  return (
    <svg
      className="drawingPreview"
      viewBox="0 0 320 220"
      role="img"
      aria-label="Player drawing"
    >
      {drawingLines(value).map((line, index) => (
        <polyline
          key={index}
          points={line.map((point) => point.join(",")).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
function DrawingPad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [drawing, setDrawing] = useState(false);
  function point(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect(),
      x = Math.max(
        0,
        Math.min(320, Math.round(((e.clientX - rect.left) * 320) / rect.width)),
      ),
      y = Math.max(
        0,
        Math.min(220, Math.round(((e.clientY - rect.top) * 220) / rect.height)),
      );
    return `${x},${y}`;
  }
  function start(e: ReactPointerEvent<SVGSVGElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const next = value ? `${value}|${point(e)}` : point(e);
    if (next.length <= 480) onChange(next);
    setDrawing(true);
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || !drawing) return;
    const next = `${value} ${point(e)}`;
    if (next.length <= 480) onChange(next);
  }
  return (
    <div className="drawingPad">
      <div className="drawingTools">
        <span>✎ Draw with your finger or pointer</span>
        <button
          type="button"
          disabled={disabled || !value}
          onClick={() => onChange("")}
        >
          Clear
        </button>
      </div>
      <svg
        viewBox="0 0 320 220"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => setDrawing(false)}
        onPointerCancel={() => setDrawing(false)}
        aria-label="Drawing canvas"
      >
        {drawingLines(value).map((line, index) => (
          <polyline
            key={index}
            points={line.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <small>
        {disabled
          ? "Drawing locked"
          : "Keep it simple—the canvas saves automatically when you lock in."}
      </small>
    </div>
  );
}
function CustomQuestionManager({
  questions,
  currentUser,
  busy,
  add,
  edit,
  remove,
}: {
  questions: any[];
  currentUser: string;
  busy: boolean;
  add: (g: string, q: string) => void;
  edit: (id: string, q: string) => void;
  remove: (id: string) => void;
}) {
  const [q, setQ] = useState(""),
    [g, setG] = useState("memory"),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [editValue, setEditValue] = useState("");
  return (
    <div className="accountCard customManager">
      <small>CUSTOM COUPLE QUESTIONS</small>
      <h3>Make the games yours</h3>
      <p>
        Add shared memories, inside jokes, and questions. Memory notes are
        automatically turned into questions for the game.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 3) {
            add(g, q);
            setQ("");
          }
        }}
      >
        <select value={g} onChange={(e) => setG(e.target.value)}>
          <option value="knows">Who Knows Me Better?</option>
          <option value="guess">Guess My Answer</option>
          <option value="memory">Memory Lane</option>
          <option value="timeline">Relationship Timeline</option>
          <option value="said">Who Said It?</option>
        </select>
        <input
          value={q}
          maxLength={240}
          onChange={(e) => setQ(e.target.value)}
          placeholder={g === "memory" ? "Add a memory, e.g. our first beach trip…" : "Add a personal question…"}
        />
        <button className="primary" disabled={busy || q.trim().length < 3}>
          Add question
        </button>
      </form>
      <input className="questionSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your couple questions…" aria-label="Search custom questions" />
      <div className="customList">
        {questions.length === 0 ? (
          <p>No custom questions yet.</p>
        ) : (
          questions.filter((item) => item.question.toLowerCase().includes(search.toLowerCase()) || item.game_key.toLowerCase().includes(search.toLowerCase())).map((item) => (
            <div key={item.id}>
              {editing === item.id ? (
                <div className="customEdit">
                  <input value={editValue} maxLength={240} onChange={(e) => setEditValue(e.target.value)} aria-label="Edit question" />
                  <button className="primary" disabled={busy || editValue.trim().length < 3} onClick={() => { edit(item.id, editValue); setEditing(null); }}>Save</button>
                  <button className="secondary" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span>
                    <small>{GAMES.find((x) => x.key === item.game_key)?.title || item.game_key}</small>
                    <b>{item.question}</b>
                  </span>
                  {item.created_by === currentUser && (
                    <div className="customActions">
                      <button onClick={() => { setEditing(item.id); setEditValue(item.question); }} aria-label="Edit question">Edit</button>
                      <button onClick={() => remove(item.id)} aria-label="Delete question">Delete</button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
function Simple({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page board">
      <small>TWOFOLD</small>
      <h1>{title}</h1>
      <p>{intro}</p>
      {children}
    </div>
  );
}
