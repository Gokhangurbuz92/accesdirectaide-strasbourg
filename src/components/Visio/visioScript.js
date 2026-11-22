/**
 * G14 — the provider's External API script for a server-issued join. 8x8 JaaS: https://8x8.vc/<AppID>/external_api.js with the room « <AppID>/<room> »
 * (https://developer.8x8.com/jaas/docs/iframe-api-integration, read 2026-11-22); self-hosted Jitsi: https://<domain>/external_api.js (unchanged).
 */
const JAAS_APP_ID = /^vpaas-magic-cookie-[A-Za-z0-9]{8,64}$/;
/** The External API script of the provider named by the server, or null when the join is malformed (fail closed: nothing is loaded).
 * @param {{ provider?: string, domain?: string, appId?: string, roomName?: string, jwt?: string } | null | undefined} join
 * @returns {string | null} */
export function externalApiScriptUrl(join) {
  if (!join?.domain || !join?.jwt) return null;
  if (join.provider === 'jaas') {
    if (join.domain !== '8x8.vc' || !JAAS_APP_ID.test(String(join.appId || '')) || !String(join.roomName || '').startsWith(`${join.appId}/`)) return null;
    return `https://8x8.vc/${join.appId}/external_api.js`;
  }
  return `https://${join.domain}/external_api.js`;
}
