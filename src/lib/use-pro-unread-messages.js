// @ts-check
import { useEffect, useState } from 'react';

/**
 * B02 — the signed-in professional's unread conversations, for the « Messages » entry of the navigation. Read from /api/pro/notifications/unread-count
 * (`messages`): a number when the database keeps read markers, null when it does not (then nothing is shown — never a made-up zero). Refreshed every
 * minute and on every page change (opening a thread reads it).
 * @param {boolean} enabled a professional is signed in @param {string} pathname the current page
 * @returns {number | null}
 */
export function useProUnreadMessages(enabled, pathname) {
  const [count, setCount] = useState(/** @type {number | null} */ (null));
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    const read = async () => {
      try {
        const token = globalThis.localStorage?.getItem('pro_token');
        if (!token) return;
        const res = await fetch('/api/pro/notifications/unread-count', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (current) setCount(Number.isSafeInteger(data?.messages) && data.messages >= 0 ? data.messages : null);
      } catch { /* the badge is a convenience: an outage shows nothing */ }
    };
    read();
    const timer = setInterval(read, 60000);
    return () => { current = false; clearInterval(timer); };
  }, [enabled, pathname]);
  return count;
}
