"use client";

// The trace a visitor opened from a file. It lives in memory for client navigation,
// and in sessionStorage so a reload of /trace still shows it. It never leaves the browser.

import type { Trace } from "./types";

const KEY = "blackbox:opened";
let current: Trace | null = null;

export function setOpened(t: Trace) {
  current = t;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // Too large for sessionStorage, or storage is blocked. Memory still holds it for this visit.
    // Drop the older trace, so a reload never shows a different file from the one opened last.
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Storage is blocked; nothing is stored either.
    }
  }
}

export function getOpened(): Trace | null {
  if (current) return current;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) current = JSON.parse(raw) as Trace;
  } catch {
    // Ignore unreadable storage.
  }
  return current;
}
