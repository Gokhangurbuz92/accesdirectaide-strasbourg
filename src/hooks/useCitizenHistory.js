// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { citizenApi } from '@/lib/citizenApi';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';

// one session check per page load at most (60 s), shared by every caller; no React Query provider needed
let cached = null; let cachedAt = 0;
function sessionKind() {
  if (!cached || Date.now() - cachedAt > 60_000) {
    cachedAt = Date.now();
    cached = rdvMessagingClient.authMe().then((r) => r?.session?.kind || null, () => null);
  }
  return cached;
}
/** test seam: forget the cached session */
export function __resetCitizenHistorySession() { cached = null; cachedAt = 0; }

/**
 * R12 (C11) — the opt-in history also records searches and diagnostics (before: only record views were written). Only for a signed-in person; the server keeps
 * nothing unless the person switched history on.
 * @returns {(entry: { kind: 'search' | 'diagnostic' | 'plan', label: string, ref?: string }) => void}
 */
export default function useCitizenHistory() {
  const [isUser, setIsUser] = useState(false);
  useEffect(() => {
    let alive = true;
    sessionKind().then((kind) => { if (alive) setIsUser(kind === 'user'); });
    return () => { alive = false; };
  }, []);
  return useCallback((entry) => {
    if (!isUser || !entry?.label) return;
    citizenApi.addHistory({ kind: entry.kind, label: String(entry.label).slice(0, 120), ref: entry.ref ? String(entry.ref).slice(0, 200) : undefined }).catch(() => {});
  }, [isUser]);
}
