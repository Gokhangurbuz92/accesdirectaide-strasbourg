// @ts-nocheck
/**
 * PKG-3 / B07 / N06 — provider-independent video adapter. The only implemented provider is a JWT-protected Jitsi Meet deployment ('jitsi-jwt': a self-hosted Jitsi with
 * token authentication, or 8x8 JaaS). Nothing here deploys, contacts or tests a video server: it decides whether video may be offered and issues a short-lived, room-bound
 * access token that the provider verifies.
 *
 * OFF BY DEFAULT. Video is offered only when VIDEO_PROVIDER=jitsi-jwt with a domain, an app id and a secret of at least 32 characters; in production it also needs
 * VIDEO_PRODUCTION_APPROVED=true (set only after provider, hosting, credentials, DPO/GDPR and security approvals) AND the CSP / Permissions-Policy activation documented in
 * docs/pkg3-video-activation.md (the shipped headers block any video origin and camera/microphone). VIDEO_SANDBOX=true marks a LAB configuration: every screen then says
 * that the provider connection is NOT verified.
 *
 * Privacy: the room name is an HMAC of the appointment id and a per-approval nonce (no name, no date, no structure); the token is returned in a no-store JSON body, never in
 * a URL, never logged; recording, live streaming, transcription and outbound calls are disabled in the token features; tokens are valid only from 15 minutes before the
 * start to 15 minutes after the end.
 */
import crypto from 'node:crypto';

export const VIDEO_JOIN_EARLY_MINUTES = 15;
export const VIDEO_JOIN_LATE_MINUTES = 15;
const HOST = /^(?=.{4,190}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function videoStatus(env = process.env) {
  const provider = String(env.VIDEO_PROVIDER || 'off').trim();
  const sandbox = String(env.VIDEO_SANDBOX || '') === 'true';
  const production = String(env.VERCEL_ENV || '') === 'production';
  const off = (reason) => ({ bookable: false, joinable: false, provider: provider || 'off', sandbox, reason });
  if (provider === 'off' || !provider) return off('NOT_CONFIGURED');
  if (provider !== 'jitsi-jwt') return off('UNKNOWN_PROVIDER');
  const domain = String(env.VIDEO_JITSI_DOMAIN || '').trim().toLowerCase();
  if (!HOST.test(domain) || !String(env.VIDEO_JITSI_APP_ID || '').trim() || String(env.VIDEO_JITSI_SECRET || '').length < 32) return off('INCOMPLETE_CONFIGURATION');
  if (production && String(env.VIDEO_PRODUCTION_APPROVED || '') !== 'true') return off('PRODUCTION_ACTIVATION_PENDING');
  if (production && sandbox) return off('SANDBOX_IN_PRODUCTION');
  return { bookable: true, joinable: true, provider, sandbox, domain, reason: null };
}

/** What a screen may show about video, never a secret. */
export function publicVideoStatus(env = process.env) {
  const s = videoStatus(env);
  return { available: s.bookable, sandbox: s.sandbox, reason: s.reason };
}

export function joinWindow(appointment) {
  return { opensAt: new Date(new Date(appointment.startAt).getTime() - VIDEO_JOIN_EARLY_MINUTES * 60_000), closesAt: new Date(new Date(appointment.endAt).getTime() + VIDEO_JOIN_LATE_MINUTES * 60_000) };
}

/** Why this participant may not join now (null = may join). Pure: the caller has already proven WHO the participant is (owner citizen or member of the structure). */
export function joinRefusal(appointment, { now = new Date(), env = process.env } = {}) {
  const s = videoStatus(env);
  if (!s.joinable) return { status: 503, code: 'VIDEO_DISABLED', message: 'La visio n’est pas activée sur ce service pour le moment.' };
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
  return 'ada' + crypto.createHmac('sha256', String(env.VIDEO_JITSI_SECRET || '')).update(`room:${appointment.id}:${appointment.visioRoomId}`).digest('hex').slice(0, 40);
}
const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** A room-bound, time-bound token for ONE authorised participant. role: 'pro' (moderator) | 'citizen'. Call only after joinRefusal() returned null. */
export function issueJoin(appointment, role, { now = new Date(), env = process.env } = {}) {
  const s = videoStatus(env);
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

/** Header sources the activation would need (documentation + tests): the shipped headers must NOT contain them while video is not approved. */
export function activationHeaderSources(domain) {
  return { 'script-src': `https://${domain}`, 'frame-src': `https://${domain}`, 'connect-src': `https://${domain} wss://${domain}`, 'Permissions-Policy': `camera=(self "https://${domain}"), microphone=(self "https://${domain}")` };
}
