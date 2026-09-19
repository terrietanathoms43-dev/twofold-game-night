import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GAMES } from "../lib/games.ts";

test("the complete game catalog has unique keys and 100 unique prompts per game", () => {
  assert.equal(GAMES.length, 37);
  assert.equal(new Set(GAMES.map((game) => game.key)).size, GAMES.length);
  for (const game of GAMES) {
    assert.equal(game.prompts.length, 100, `${game.title} should have 100 prompts`);
    assert.equal(new Set(game.prompts).size, 100, `${game.title} prompts should not repeat`);
    assert.ok(game.instructions.length >= 20, `${game.title} needs useful instructions`);
  }
});

test("all game categories and modes are supported by the interface", () => {
  const categories = new Set(["Couple", "Competitive", "Party", "Creative", "Cooperative"]);
  const modes = new Set(["match", "choice", "text", "speed", "creative", "number"]);
  for (const game of GAMES) {
    assert.ok(categories.has(game.category), `Unsupported category: ${game.category}`);
    assert.ok(modes.has(game.mode), `Unsupported mode: ${game.mode}`);
  }
});

test("notification functions handle browser preflight without committing private keys", async () => {
  for (const name of ["notify-call", "notify-chat"]) {
    const source = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
    assert.match(source, /request\.method === "OPTIONS"/);
    assert.match(source, /Deno\.env\.get\("VAPID_PRIVATE_KEY"\)/);
    assert.doesNotMatch(source, /webpush\.setVapidDetails\([^\n]*,[^\n]*,"[A-Za-z0-9_-]{30,}"/);
  }
});

test("message notifications support replies and unread app badges", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const chat = await readFile(new URL("../app/CoupleChat.tsx", import.meta.url), "utf8");
  assert.match(worker, /action:"reply"/);
  assert.match(worker, /self\.navigator\.setAppBadge/);
  assert.match(worker, /self\.navigator\.clearAppBadge/);
  assert.match(chat, /message\.sender_id !== userId/);
  assert.match(chat, /twofold:chat-unread/);
});

test("cloud preferences and personal export remain protected by RLS and authentication", async () => {
  const source = await readFile(new URL("../supabase/migrations/202608230001_cloud_preferences_and_export.sql", import.meta.url), "utf8");
  assert.match(source, /enable row level security/i);
  assert.match(source, /auth\.uid\(\)/i);
  assert.match(source, /revoke all on function public\.twf_export_my_data\(\) from public, anon/i);
});

test("TURN credentials stay server-side and require an authenticated request", async () => {
  const route = await readFile(new URL("../app/api/turn/route.ts", import.meta.url), "utf8");
  const callUi = await readFile(new URL("../app/RoomCommunication.tsx", import.meta.url), "utf8");
  assert.match(route, /auth\.getUser\(token\)/);
  assert.match(route, /process\.env\.TURN_CREDENTIAL/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_TURN/);
  assert.match(callUi, /fetch\("\/api\/turn"/);
  assert.doesNotMatch(callUi, /NEXT_PUBLIC_TURN/);
});

test("game-night timing is divided safely and supports controlled extensions", async () => {
  const migration = await readFile(new URL("../supabase/migrations/202609170002_timed_game_extensions.sql", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(migration, /\(new\.session_minutes\*60\)\/greatest\(v_game_count,1\)/i);
  assert.match(migration, /twf_extend_game_night/i);
  assert.match(migration, /twf_extend_current_game/i);
  assert.match(migration, /twf_expire_current_game/i);
  assert.match(migration, /revoke all on function public\.twf_extend_game_night\(uuid,integer\) from public,anon/i);
  assert.match(page, /THIS GAME/);
  assert.match(page, /Whole night/);
  assert.match(page, /twf_extend_game_night/);
  assert.match(page, /twf_extend_current_game/);
});

test("every lobby entry marks the current player ready before waiting for the partner", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /view !== "lobby" \|\| !profile/);
  assert.match(page, /currentPlayer\?\.ready/);
  assert.match(page, /supabase\.rpc\("twf_join_game_night"/);
  assert.match(page, /Could not mark you ready/);
});
