// @ts-nocheck
/**
 * PKG-3 / B07 / N06 — provider-independent video adapter. The only implemented provider is a JWT-protected Jitsi Meet deployment ('jitsi-jwt': a self-hosted Jitsi with
 * token authentication, or 8x8 JaaS). Nothing here deploys, contacts or tests a video server: it decides whether video may be offered and issues a short-lived, room-bound
 * access token that the provider verifies.
 *
 * OFF BY DEFAULT. Video is offered only when VIDEO_PROVIDER=jitsi-jwt with a domain, an app id and a secret of at least 32 characters (HS256), or VIDEO_PROVIDER=jaas
 * (G14, 8x8 JaaS, RS256) with a valid app id, key id and RSA private key; in production it also needs
 * VIDEO_PRODUCTION_APPROVED=true (set only after provider, hosting, credentials, DPO/GDPR and security approvals) AND the CSP / Permissions-Policy activation documented in
 * docs/pkg3-video-activation.md (the shipped headers block any video origin and camera/microphone). VIDEO_SANDBOX=true marks a LAB configuration: every screen then says
 * that the provider connection is NOT verified.
 *
 * Privacy: the room name is an HMAC of the appointment id and a per-approval nonce (no name, no date, no structure); the token is returned in a no-store JSON body, never in
 * a URL, never logged; recording, live streaming, transcription and outbound calls are disabled in the token features; tokens are valid only from 15 minutes before the
 * start to 15 minutes after the end.
 */
import crypto from 'node:crypto';
import { capabilityState } from '../_utils/capabilities.js';

export const VIDEO_JOIN_EARLY_MINUTES = 15;
export const VIDEO_JOIN_LATE_MINUTES = 15;
const HOST = /^(?=.{4,190}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function videoStatus(env = process.env) {
  const provider = String(env.VIDEO_PROVIDER || 'off').trim();
  const sandbox = String(env.VIDEO_SANDBOX || '') === 'true';
  const production = String(env.VERCEL_ENV || '') === 'production';
  const off = (reason) => ({ bookable: false, joinable: false, provider: provider || 'off', sandbox, reason });
  if (provider === 'off' || !provider) return off('NOT_CONFIGURED');
  if (provider !== 'jitsi-jwt' && provider !== 'jaas') return off('UNKNOWN_PROVIDER');
  let domain; let appId = null;
  if (provider === 'jaas') {
    const j = jaasConfig(env);   // fail closed: a missing / malformed app id, key id or RSA private key is « not configured », never a partial token
    if (!j) return off('INCOMPLETE_CONFIGURATION');
    domain = JAAS_DOMAIN; appId = j.appId;
  } else {
    domain = String(env.VIDEO_JITSI_DOMAIN || '').trim().toLowerCase();
    if (!HOST.test(domain) || !String(env.VIDEO_JITSI_APP_ID || '').trim() || String(env.VIDEO_JITSI_SECRET || '').length < 32) return off('INCOMPLETE_CONFIGURATION');
  }
  if (production && String(env.VIDEO_PRODUCTION_APPROVED || '') !== 'true') return off('PRODUCTION_ACTIVATION_PENDING');
  if (production && sandbox) return off('SANDBOX_IN_PRODUCTION');
  return { bookable: true, joinable: true, provider, sandbox, domain, ...(appId ? { appId } : {}), reason: null };
}

/*
 * G14 — 8x8 « Jitsi as a Service » (VIDEO_PROVIDER=jaas). Verified on 2026-11-22 against the official 8x8 developer documentation:
 *   https://developer.8x8.com/jaas/docs/api-keys-jwt (« The Jitsi JSON Web Token (JWT) »): header alg RS256, kid = the API key's kid « <AppID>/<suffix> », typ JWT;
 *     claims aud « jitsi » and iss « chat » (hardcoded), sub = AppID, room = the room name (literal match; the AppID is NOT part of it), nbf / exp,
 *     context.user { id, name, moderator: "true" | "false" (missing or "false" = no moderator rights) }, context.features (livestreaming, recording, transcription,
 *     sip-inbound-call, sip-outbound-call, inbound-call, outbound-call, file-upload, …: "true" / "false"), context.room.regex (false = literal room name).
 *   https://developer.8x8.com/jaas/docs/iframe-api-integration: script https://8x8.vc/<AppID>/external_api.js, domain « 8x8.vc », roomName « <AppID>/<room> », jwt option.
 *   https://developer.8x8.com/jaas/docs/jaas-console-api-keys: the console generates the RSA key pair (the private key is downloaded once, 8x8 does not store it); the AppID
 *     is prefixed « vpaas-magic-cookie- ».
 * Environment (names only): VIDEO_JAAS_APP_ID, VIDEO_JAAS_KEY_ID (the key suffix, or the full « <AppID>/<suffix> » kid), VIDEO_JAAS_PRIVATE_KEY (PEM; « \n » escapes accepted).
 * The private key and the token are never logged, never returned except the token itself in the no-store join body.
 */
export const JAAS_DOMAIN = '8x8.vc';
const JAAS_APP_ID = /^vpaas-magic-cookie-[A-Za-z0-9]{8,64}$/;
const JAAS_KEY_SUFFIX = /^[A-Za-z0-9_-]{1,64}$/;
function jaasConfig(env) {
  const appId = String(env.VIDEO_JAAS_APP_ID || '').trim();
  if (!JAAS_APP_ID.test(appId)) return null;
  let keyId = String(env.VIDEO_JAAS_KEY_ID || '').trim();
  if (keyId.startsWith(`${appId}/`)) keyId = keyId.slice(appId.length + 1);
  if (!JAAS_KEY_SUFFIX.test(keyId)) return null;
  const pem = String(env.VIDEO_JAAS_PRIVATE_KEY || '').replace(/(\\r)?\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  if (pem.length < 200 || pem.length > 16384 || !/^-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem)) return null;
  let key;
  try { key = crypto.createPrivateKey({ key: pem, format: 'pem' }); } catch { return null; }   // the parse error may quote the key: swallowed, never logged
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) return null;
  return { appId, kid: `${appId}/${keyId}`, key };
}

/** What a screen may show about video, never a secret. */
export function publicVideoStatus(env = process.env) {
  const s = videoStatus(env);
  // R45 / ENG-LR-6: video is outside the AIPD — a configured provider is not enough while the « video » capability is closed (api/_utils/capabilities.js)
  if (s.bookable && !capabilityState('video', env).open) return { available: false, sandbox: s.sandbox, reason: 'CAPABILITY_NOT_OPEN' };
  return { available: s.bookable, sandbox: s.sandbox, reason: s.reason };
}

export function joinWindow(appointment) {
  return { opensAt: new Date(new Date(appointment.startAt).getTime() - VIDEO_JOIN_EARLY_MINUTES * 60_000), closesAt: new Date(new Date(appointment.endAt).getTime() + VIDEO_JOIN_LATE_MINUTES * 60_000) };
}

/** Why this participant may not join now (null = may join). Pure: the caller has already proven WHO the participant is (owner citizen or member of the structure). */
export function joinRefusal(appointment, { now = new Date(), env = process.env } = {}) {
  const s = videoStatus(env);
  if (!s.joinable) return { status: 503, code: 'VIDEO_DISABLED', message: 'La visio n’est pas activée sur ce service pour le moment.' };
  if (!capabilityState('video', env).open) return { status: 503, code: 'CAPABILITY_NOT_OPEN', message: 'La visio n’est pas encore ouverte sur ce service.' };   // R45 / ENG-LR-6
  if (appointment.mode !== 'VIDEO') return { status: 409, code: 'NOT_A_VIDEO_APPOINTMENT', message: 'Ce rendez-vous a lieu en présentiel.' };
  if (!['booked', 'requested', 'confirmed'].includes(String(appointment.status || '').toLowerCase())) return { status: 409, code: 'APPOINTMENT_NOT_ACTIVE', message: 'Ce rendez-vous n’est plus actif.' };
  if (!appointment.visioApprovedAt || !appointment.visioRoomId) return { status: 409, code: 'VIDEO_NOT_APPROVED', message: 'La structure n’a pas encore validé la visio pour ce rendez-vous.' };
  if (!appointment.visioCitizenConsentAt) return { status: 409, code: 'VIDEO_NO_CONSENT', message: 'La personne n’a pas donné son accord pour la visio.' };
  const w = joinWindow(appointment);
  if (now < w.opensAt) return { status: 403, code: 'VIDEO_NOT_OPEN_YET', message: `La salle ouvre ${VIDEO_JOIN_EARLY_MINUTES} minutes avant le rendez-vous.`, opensAt: w.opensAt.toISOString() };
  if (now > w.closesAt) return { status: 403, code: 'VIDEO_CLOSED', message: 'Ce rendez-vous est terminé.' };
  return null;
}

export const newRoomNonce = () => crypto.randomBytes(24).toString('base64url');
export function roomNameOf(appointment, env = process.env) {
  return 'ada' + crypto.createHmac('sha256', roomKey(env)).update(`room:${appointment.id}:${appointment.visioRoomId}`).digest('hex').slice(0, 40);
}
/** HMAC key of the room name: the shared secret (self-hosted, unchanged) or, for JaaS which has no shared secret, a hash of the server-held private key. */
function roomKey(env) {
  if (String(env.VIDEO_PROVIDER || '').trim() !== 'jaas') return String(env.VIDEO_JITSI_SECRET || '');
  const j = jaasConfig(env);
  if (!j) throw new Error('VIDEO_NOT_CONFIGURED');
  return crypto.createHash('sha256').update('ada-jaas-room:').update(j.key.export({ type: 'pkcs8', format: 'der' })).digest();
}
const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** A room-bound, time-bound token for ONE authorised participant. role: 'pro' (moderator) | 'citizen'. Call only after joinRefusal() returned null. */
export function issueJoin(appointment, role, { now = new Date(), env = process.env } = {}) {
  const s = videoStatus(env);
  if (!s.joinable) throw new Error('VIDEO_NOT_CONFIGURED');   // fail closed (joinRefusal() already refuses this case)
  if (s.provider === 'jaas') return issueJaasJoin(appointment, role, s, { now, env });
  const w = joinWindow(appointment);
  const room = roomNameOf(appointment, env);
  const claims = {
    aud: 'jitsi', iss: String(env.VIDEO_JITSI_APP_ID), sub: s.domain, room,
    nbf: Math.floor(Math.min(now.getTime(), w.opensAt.getTime()) / 1000) - 30, exp: Math.floor(w.closesAt.getTime() / 1000),
    context: { user: { name: role === 'pro' ? 'Conseiller·e' : 'Personne accompagnée', moderator: role === 'pro' },
      features: { recording: false, livestreaming: false, transcription: false, 'outbound-call': false, 'sip-outbound-call': false } },
  };
  const head = b64u({ alg: 'HS256', typ: 'JWT' }); const body = b64u(claims);
  const sig = crypto.createHmac('sha256', String(env.VIDEO_JITSI_SECRET)).update(`${head}.${body}`).digest('base64url');
  return { provider: s.provider, sandbox: s.sandbox, domain: s.domain, roomName: room, jwt: `${head}.${body}.${sig}`, expiresAt: w.closesAt.toISOString(), role };
}

/** G14 — the 8x8 JaaS variant: RS256 with the API key's private key, claims as documented (see the block above jaasConfig). */
function issueJaasJoin(appointment, role, s, { now, env }) {
  const j = jaasConfig(env);
  if (!j) throw new Error('VIDEO_NOT_CONFIGURED');
  const w = joinWindow(appointment);
  const room = roomNameOf(appointment, env);
  const pro = role === 'pro';
  const userId = crypto.createHmac('sha256', roomKey(env)).update(`user:${appointment.id}:${pro ? 'pro' : 'citizen'}`).digest('hex').slice(0, 32);   // pseudonymous, stable per appointment
  const off = 'false';
  const claims = {
    aud: 'jitsi', iss: 'chat', sub: j.appId, room,
    nbf: Math.floor(Math.min(now.getTime(), w.opensAt.getTime()) / 1000) - 30, exp: Math.floor(w.closesAt.getTime() / 1000),
    context: {
      user: { id: userId, name: pro ? 'Conseiller·e' : 'Personne accompagnée', moderator: pro ? 'true' : 'false' },
      features: { recording: off, livestreaming: off, transcription: off, 'outbound-call': off, 'sip-outbound-call': off, 'inbound-call': off, 'sip-inbound-call': off, 'file-upload': off },
      room: { regex: false },
    },
  };
  const head = b64u({ alg: 'RS256', kid: j.kid, typ: 'JWT' }); const body = b64u(claims);
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), j.key).toString('base64url');   // RSASSA-PKCS1-v1_5 + SHA-256 = RS256
  return { provider: s.provider, sandbox: s.sandbox, domain: JAAS_DOMAIN, appId: j.appId, roomName: `${j.appId}/${room}`, jwt: `${head}.${body}.${sig}`, expiresAt: w.closesAt.toISOString(), role };
}

/** Header sources the activation would need (documentation + tests): the shipped headers must NOT contain them while video is not approved. */
export function activationHeaderSources(domain) {
  return { 'script-src': `https://${domain}`, 'frame-src': `https://${domain}`, 'connect-src': `https://${domain} wss://${domain}`, 'Permissions-Policy': `camera=(self "https://${domain}"), microphone=(self "https://${domain}")` };
}

/** G14 — exactly what the SHIPPED headers (vercel.json) allow for 8x8 JaaS: its External API script and its meeting frame, camera / microphone / fullscreen delegated
 * to that frame only. Nothing else (no connect-src: the page talks to the frame by postMessage). Asserted by tests/unit/g14-jaas-video.test.js. */
export const JAAS_HEADER_SOURCES = Object.freeze({ 'script-src': `https://${JAAS_DOMAIN}`, 'frame-src': `https://${JAAS_DOMAIN}` });
export const JAAS_PERMISSIONS = Object.freeze({ camera: `(self "https://${JAAS_DOMAIN}")`, microphone: `(self "https://${JAAS_DOMAIN}")`, fullscreen: `(self "https://${JAAS_DOMAIN}")` });
