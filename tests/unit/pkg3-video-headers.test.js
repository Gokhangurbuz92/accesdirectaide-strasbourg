/**
 * PKG-3 / B07 — production video stays OFF: the video adapter refuses every incomplete, sandbox or unapproved production configuration, and the SHIPPED security headers
 * (vercel.json + the API's applySecurityHeaders) allow no video origin, no frame source and no camera / microphone. Activation is a reviewed change (docs/pkg3-video-activation.md).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activationHeaderSources, joinRefusal, publicVideoStatus, videoStatus } from '../../api/lib/video-provider.js';

const ON = { VIDEO_PROVIDER: 'jitsi-jwt', VIDEO_JITSI_DOMAIN: 'video.example.org', VIDEO_JITSI_APP_ID: 'ada', VIDEO_JITSI_SECRET: 's'.repeat(32) };

describe('video adapter activation gates', () => {
  it('is OFF by default and for every incomplete configuration', () => {
    expect(videoStatus({})).toMatchObject({ bookable: false, reason: 'NOT_CONFIGURED' });
    expect(videoStatus({ VIDEO_PROVIDER: 'daily' }).reason).toBe('UNKNOWN_PROVIDER');
    expect(videoStatus({ ...ON, VIDEO_JITSI_SECRET: 'short' }).reason).toBe('INCOMPLETE_CONFIGURATION');
    expect(videoStatus({ ...ON, VIDEO_JITSI_DOMAIN: 'https://video.example.org/x' }).reason).toBe('INCOMPLETE_CONFIGURATION');
  });
  it('production needs the explicit approval, and never runs a sandbox configuration', () => {
    expect(videoStatus({ ...ON, VERCEL_ENV: 'production' }).reason).toBe('PRODUCTION_ACTIVATION_PENDING');
    expect(videoStatus({ ...ON, VERCEL_ENV: 'production', VIDEO_PRODUCTION_APPROVED: 'true', VIDEO_SANDBOX: 'true' }).reason).toBe('SANDBOX_IN_PRODUCTION');
    expect(videoStatus({ ...ON, VERCEL_ENV: 'production', VIDEO_PRODUCTION_APPROVED: 'true' }).bookable).toBe(true);
    expect(JSON.stringify(publicVideoStatus(ON))).not.toContain(ON.VIDEO_JITSI_SECRET);
  });
  it('a video join is refused while video is off, for an in-person appointment, before approval and outside the window', () => {
    const now = new Date('2030-01-01T10:00:00Z');
    const base = { mode: 'VIDEO', status: 'confirmed', visioApprovedAt: now, visioRoomId: 'n', visioCitizenConsentAt: now, startAt: '2030-01-01T10:05:00Z', endAt: '2030-01-01T10:35:00Z' };
    expect(joinRefusal(base, { now, env: {} }).code).toBe('VIDEO_DISABLED');
    expect(joinRefusal({ ...base, mode: 'IN_PERSON' }, { now, env: ON }).code).toBe('NOT_A_VIDEO_APPOINTMENT');
    expect(joinRefusal({ ...base, visioApprovedAt: null }, { now, env: ON }).code).toBe('VIDEO_NOT_APPROVED');
    expect(joinRefusal({ ...base, startAt: '2030-01-01T11:00:00Z', endAt: '2030-01-01T11:30:00Z' }, { now, env: ON }).code).toBe('VIDEO_NOT_OPEN_YET');
    expect(joinRefusal({ ...base, startAt: '2030-01-01T08:00:00Z', endAt: '2030-01-01T09:00:00Z' }, { now, env: ON }).code).toBe('VIDEO_CLOSED');
    expect(joinRefusal(base, { now, env: ON })).toBeNull();
  });
});

describe('shipped security headers allow no video provider', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const headers = vercel.headers.flatMap((h) => h.headers);
  const csp = headers.filter((h) => h.key === 'Content-Security-Policy').map((h) => h.value).join(' ');
  const api = readFileSync('api/_utils/security.js', 'utf8');
  it('no video origin, no frame source, camera and microphone denied', () => {
    expect(csp).toContain("default-src 'self'");
    for (const src of Object.values(activationHeaderSources('video.example.org'))) expect(csp).not.toContain(src);
    expect(csp).not.toMatch(/jit\.si|jitsi|8x8|frame-src/i);
    expect(api).toContain("'Permissions-Policy', 'camera=(), microphone=(), geolocation=()'");
    expect(api).not.toMatch(/jit\.si|jitsi|frame-src/i);
  });
});
