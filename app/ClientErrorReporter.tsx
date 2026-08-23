"use client";

import { useEffect } from "react";
import { supabase } from "../lib/supabase";

function cleanMessage(value: unknown) {
  const text = value instanceof Error ? value.message : String(value || "Unknown error");
  return text.replace(/https?:\/\/\S+/g, "[url]").slice(0, 500);
}

export default function ClientErrorReporter() {
  useEffect(() => {
    const report = (message: unknown, source: "window_error" | "unhandled_rejection") => {
      void supabase.rpc("twf_log_client_error", {
        p_message: cleanMessage(message),
        p_source: source,
        p_route: window.location.pathname,
        p_context: { online: navigator.onLine, platform: navigator.platform || "unknown" },
      });
    };
    const onError = (event: ErrorEvent) => report(event.error || event.message, "window_error");
    const onRejection = (event: PromiseRejectionEvent) => report(event.reason, "unhandled_rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
