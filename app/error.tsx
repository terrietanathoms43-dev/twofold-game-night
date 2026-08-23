"use client";

import { useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void supabase.rpc("twf_log_client_error", {
      p_message: error.message.slice(0, 500),
      p_source: "react_boundary",
      p_route: window.location.pathname,
      p_context: { digest: error.digest || null },
    });
  }, [error]);
  return (
    <main className="center">
      <h1>Twofold needs a quick refresh</h1>
      <p>Your account and game-night progress are still saved.</p>
      <button className="primary" onClick={reset}>Try again</button>
    </main>
  );
}
