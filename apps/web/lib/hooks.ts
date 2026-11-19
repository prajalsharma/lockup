"use client";
import { useSyncExternalStore } from "react";

/** The current time, re-rendered every `ms`. Zero on the server. */
export function useNow(ms = 250) {
  return useSyncExternalStore(
    (f) => { const t = setInterval(f, ms); return () => clearInterval(t); },
    () => Math.floor(Date.now() / ms) * ms,
    () => 0,
  );
}
