/**
 * G14 — 8x8 « Jitsi as a Service » (VIDEO_PROVIDER=jaas). The token follows https://developer.8x8.com/jaas/docs/api-keys-jwt and the embed
 * https://developer.8x8.com/jaas/docs/iframe-api-integration (both read 2026-11-22). The RSA key pair is generated HERE, in memory, for each run: no key is committed.
 * Also: every incomplete / invalid JaaS configuration is « not bookable » (fail closed), the self-hosted HS256 path is unchanged, and the shipped headers allow exactly
 * the 8x8.vc origins the embed needs.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { issueJoin, JAAS_HEADER_SOURCES, JAAS_PERMISSIONS, joinRefusal, publicVideoStatus, roomNameOf, videoStatus } from '../../api/lib/video-provider.js';
import { videoChannel } from '../../api/lib/communication-channels.js';
import { providerStatuses } from '../../api/_services/provider-status.js';
import { externalApiScriptUrl } from '../../src/components/Visio/visioScript.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const APP = 'vpaas-magic-cookie-0123456789abcdef0123456789abcdef';
const JAAS = { VIDEO_PROVIDER: 'jaas', VIDEO_JAAS_APP_ID: APP, VIDEO_JAAS_KEY_ID: 'a1b2c3', VIDEO_JAAS_PRIVATE_KEY: PEM };
const now = new Date('2030-01-01T10:00:00Z');
const appt = { id: 'appt-1', mode: 'VIDEO', status: 'confirmed', visioApprovedAt: now, visioRoomId: 'nonce-1', visioCitizenConsentAt: now, startAt: '2030-01-01T10:05:00Z', endAt: '2030-01-01T10:35:00Z' };
const decode = (jwt) => { const [h, b, s] = jwt.split('.'); return { header: JSON.parse(Buffer.from(h, 'base64url').toString()), claims: JSON.parse(Buffer.from(b, 'base64url').toString()), signed: `${h}.${b}`, sig: Buffer.from(s, 'base64url') }; };

describe('G14 JaaS token (RS256)', () => {
  it('is bookable with a valid app id, key id and RSA private key', () => {
    expect(videoStatus(JAAS)).toMatchObject({ bookable: true, provider: 'jaas', domain: '8x8.vc', appId: APP, reason: null });
  });

  it('header alg RS256 + kid « <AppID>/<key id> », signature verifies with the public key, documented claims', () => {
    const join = issueJoin(appt, 'pro', { now, env: JAAS });
    const { header, claims, signed, sig } = decode(join.jwt);
    expect(header).toEqual({ alg: 'RS256', kid: `${APP}/a1b2c3`, typ: 'JWT' });
    expect(crypto.verify('sha256', Buffer.from(signed), publicKey, sig)).toBe(true);
    expect(crypto.verify('sha256', Buffer.from(`${signed}x`), publicKey, sig)).toBe(false);
    const room = roomNameOf(appt, JAAS);
    expect(room).toMatch(/^ada[0-9a-f]{40}$/);
    expect(claims).toMatchObject({ aud: 'jitsi', iss: 'chat', sub: APP, room });
    expect(claims.room).not.toContain(APP);   // the AppID is in sub, the room claim is the bare room name
    expect(claims.nbf).toBe(Date.parse('2030-01-01T09:50:00Z') / 1000 - 30);   // 15 min before the start (- 30 s skew), as for HS256
    expect(claims.exp).toBe(Date.parse('2030-01-01T10:50:00Z') / 1000);        // 15 min after the end
    expect(claims.context.user).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'Conseiller·e', moderator: 'true' });
    expect(claims.context.room).toEqual({ regex: false });
    for (const f of ['recording', 'livestreaming', 'transcription', 'outbound-call', 'sip-outbound-call', 'inbound-call', 'sip-inbound-call', 'file-upload']) expect(claims.context.features[f], f).toBe('false');
    expect(Object.values(claims.context.features)).not.toContain('true');
    expect(join).toMatchObject({ provider: 'jaas', domain: '8x8.vc', appId: APP, roomName: `${APP}/${room}`, role: 'pro' });
  });

  it('the person is never moderator; same room, a different pseudonymous id, no personal data', () => {
    const pro = decode(issueJoin(appt, 'pro', { now, env: JAAS }).jwt).claims;
    const cit = decode(issueJoin(appt, 'citizen', { now, env: JAAS }).jwt).claims;
    expect(cit.context.user.moderator).toBe('false');
    expect(cit.context.user.name).toBe('Personne accompagnée');
    expect(cit.room).toBe(pro.room);
    expect(cit.context.user.id).not.toBe(pro.context.user.id);
    expect(JSON.stringify(cit)).not.toContain('appt-1');
    // the room is bound to the appointment AND the approval nonce
    expect(roomNameOf({ ...appt, visioRoomId: 'nonce-2' }, JAAS)).not.toBe(pro.room);
  });

  it('accepts the full kid and a PEM given with « \\n » escapes (one-line environment value)', () => {
    const env = { ...JAAS, VIDEO_JAAS_KEY_ID: `${APP}/a1b2c3`, VIDEO_JAAS_PRIVATE_KEY: PEM.trim().replace(/\n/g, '\\n') };
    expect(videoStatus(env).bookable).toBe(true);
    const { header, signed, sig } = decode(issueJoin(appt, 'citizen', { now, env }).jwt);
    expect(header.kid).toBe(`${APP}/a1b2c3`);
    expect(crypto.verify('sha256', Buffer.from(signed), publicKey, sig)).toBe(true);
  });
});

describe('G14 JaaS fails closed', () => {
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const small = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const cases = {
    'no app id': { ...JAAS, VIDEO_JAAS_APP_ID: '' },
    'app id without the vpaas prefix': { ...JAAS, VIDEO_JAAS_APP_ID: 'my-app' },
    'app id with a path': { ...JAAS, VIDEO_JAAS_APP_ID: `${APP}/../x` },
    'no key id': { ...JAAS, VIDEO_JAAS_KEY_ID: '' },
    'kid of another app': { ...JAAS, VIDEO_JAAS_KEY_ID: 'vpaas-magic-cookie-ffffffffffffffff/a1b2c3' },
    'no private key': { ...JAAS, VIDEO_JAAS_PRIVATE_KEY: '' },
    'garbage private key': { ...JAAS, VIDEO_JAAS_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(300)}\n-----END PRIVATE KEY-----` },
    'public key instead of private': { ...JAAS, VIDEO_JAAS_PRIVATE_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    'EC key': { ...JAAS, VIDEO_JAAS_PRIVATE_KEY: ec },
    'RSA key under 2048 bits': { ...JAAS, VIDEO_JAAS_PRIVATE_KEY: small },
    'self-hosted secret only': { VIDEO_PROVIDER: 'jaas', VIDEO_JITSI_DOMAIN: 'video.example.org', VIDEO_JITSI_APP_ID: 'ada', VIDEO_JITSI_SECRET: 's'.repeat(32) },
  };
  for (const [name, env] of Object.entries(cases)) {
    it(`not bookable: ${name}`, () => {
      expect(videoStatus(env)).toMatchObject({ bookable: false, joinable: false, reason: 'INCOMPLETE_CONFIGURATION' });
      expect(joinRefusal(appt, { now, env }).code).toBe('VIDEO_DISABLED');
      expect(() => issueJoin(appt, 'pro', { now, env })).toThrow('VIDEO_NOT_CONFIGURED');
    });
  }

  it('production still needs the explicit approval and never runs a sandbox', () => {
    expect(videoStatus({ ...JAAS, VERCEL_ENV: 'production' }).reason).toBe('PRODUCTION_ACTIVATION_PENDING');
    expect(videoStatus({ ...JAAS, VERCEL_ENV: 'production', VIDEO_PRODUCTION_APPROVED: 'true', VIDEO_SANDBOX: 'true' }).reason).toBe('SANDBOX_IN_PRODUCTION');
    expect(videoStatus({ ...JAAS, VERCEL_ENV: 'production', VIDEO_PRODUCTION_APPROVED: 'true' }).bookable).toBe(true);
  });

  it('never prints the private key or the token (no console output, no key in any status)', () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const join = issueJoin(appt, 'pro', { now, env: JAAS });
      videoStatus(cases['garbage private key']); videoStatus(cases['EC key']);
      for (const s of spies) expect(s).not.toHaveBeenCalled();
      const body = PEM.split('\n')[1];
      for (const out of [videoStatus(JAAS), publicVideoStatus(JAAS), videoChannel(JAAS), providerStatuses(JAAS)]) {
        const txt = JSON.stringify(out);
        expect(txt).not.toContain(body);
        expect(txt).not.toContain(join.jwt);
      }
      expect(JSON.stringify(join)).not.toContain(body);
    } finally { for (const s of spies) s.mockRestore(); }
  });
});

describe('G14 status rows', () => {
  it('provider status lists the JaaS variable NAMES (presence only) and is correct for jaas', () => {
    const row = providerStatuses(JAAS).find((r) => r.id === 'video');
    expect(row.state).toBe('CONNECTED');
    expect(row.label).toContain('8x8 JaaS');
    const names = JSON.stringify(row.variables);
    for (const n of ['VIDEO_JAAS_APP_ID', 'VIDEO_JAAS_KEY_ID', 'VIDEO_JAAS_PRIVATE_KEY', 'VIDEO_JITSI_SECRET']) expect(names).toContain(n);
    const bad = providerStatuses({ ...JAAS, VIDEO_JAAS_PRIVATE_KEY: 'x' }).find((r) => r.id === 'video');
    expect(bad).toMatchObject({ state: 'NOT_CONFIGURED', reasonCode: 'INCOMPLETE_CONFIGURATION' });
  });
  it('the channel names the missing JaaS variables, not the self-hosted ones', () => {
    expect(videoChannel({ VIDEO_PROVIDER: 'jaas', VIDEO_JAAS_APP_ID: APP })).toMatchObject({ state: 'INCOMPLETE', missing: ['VIDEO_JAAS_KEY_ID', 'VIDEO_JAAS_PRIVATE_KEY'] });
  });
});

describe('G14 self-hosted HS256 path unchanged', () => {
  const ON = { VIDEO_PROVIDER: 'jitsi-jwt', VIDEO_JITSI_DOMAIN: 'video.example.org', VIDEO_JITSI_APP_ID: 'ada', VIDEO_JITSI_SECRET: 's'.repeat(32) };
  it('same header, claims, room name and HMAC signature as before G14', () => {
    const join = issueJoin(appt, 'pro', { now, env: ON });
    const { header, claims, signed, sig } = decode(join.jwt);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(sig.equals(crypto.createHmac('sha256', ON.VIDEO_JITSI_SECRET).update(signed).digest())).toBe(true);
    const room = 'ada' + crypto.createHmac('sha256', ON.VIDEO_JITSI_SECRET).update(`room:${appt.id}:${appt.visioRoomId}`).digest('hex').slice(0, 40);
    expect(claims).toEqual({
      aud: 'jitsi', iss: 'ada', sub: 'video.example.org', room, nbf: Date.parse('2030-01-01T09:50:00Z') / 1000 - 30, exp: Date.parse('2030-01-01T10:50:00Z') / 1000,
      context: { user: { name: 'Conseiller·e', moderator: true }, features: { recording: false, livestreaming: false, transcription: false, 'outbound-call': false, 'sip-outbound-call': false } },
    });
    expect(join).toMatchObject({ provider: 'jitsi-jwt', domain: 'video.example.org', roomName: room });
    expect(join.appId).toBeUndefined();
  });
});

describe('G14 front-end script URL', () => {
  it('JaaS: https://8x8.vc/<AppID>/external_api.js; a malformed join loads nothing', () => {
    const join = issueJoin(appt, 'citizen', { now, env: JAAS });
    expect(externalApiScriptUrl(join)).toBe(`https://8x8.vc/${APP}/external_api.js`);
    expect(externalApiScriptUrl({ ...join, appId: 'evil.example/x' })).toBeNull();
    expect(externalApiScriptUrl({ ...join, domain: 'evil.example' })).toBeNull();
    expect(externalApiScriptUrl({ ...join, roomName: 'other/room' })).toBeNull();
    expect(externalApiScriptUrl({ ...join, jwt: '' })).toBeNull();
    expect(externalApiScriptUrl({ provider: 'jitsi-jwt', domain: 'video.example.org', roomName: 'r', jwt: 'j' })).toBe('https://video.example.org/external_api.js');
  });
});

describe('G14 shipped headers (vercel.json): exactly the 8x8.vc origins the JaaS embed needs', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const headers = vercel.headers.find((h) => h.source === '/(.*)').headers;
  const header = (k) => headers.find((h) => h.key === k)?.value || '';
  const parse = (v) => Object.fromEntries(v.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [n, ...x] = d.split(/\s+/); return [n, x]; }));
  for (const key of ['Content-Security-Policy', 'Content-Security-Policy-Report-Only']) {
    it(`${key}: 8x8.vc only in script-src and frame-src`, () => {
      const csp = parse(header(key));
      expect(csp['script-src']).toContain(JAAS_HEADER_SOURCES['script-src']);
      expect(csp['frame-src']).toEqual([JAAS_HEADER_SOURCES['frame-src']]);
      const with8x8 = Object.entries(csp).filter(([, v]) => v.some((x) => /8x8/.test(x))).map(([k]) => k).sort();
      expect(with8x8).toEqual(['frame-src', 'script-src']);
      expect(csp['script-src'].filter((x) => /8x8/.test(x))).toEqual(['https://8x8.vc']);   // https only, no wildcard sub-domain
      expect(csp['connect-src']).toEqual(["'self'"]);
      expect(csp['default-src']).toEqual(["'self'"]);
      expect(csp['frame-ancestors']).toEqual(["'none'"]);
    });
  }
  it('Permissions-Policy delegates camera / microphone / fullscreen to https://8x8.vc only; geolocation stays denied', () => {
    const pp = header('Permissions-Policy');
    for (const [f, allow] of Object.entries(JAAS_PERMISSIONS)) expect(pp).toContain(`${f}=${allow}`);
    expect(pp).toContain('geolocation=()');
    expect([...pp.matchAll(/https?:\/\/[^"\s)]+/g)].map((m) => m[0]).every((o) => o === 'https://8x8.vc')).toBe(true);
  });
  it('the API responses (JSON) keep camera / microphone denied and no video origin', () => {
    const api = readFileSync('api/_utils/security.js', 'utf8');
    expect(api).toContain("'Permissions-Policy', 'camera=(), microphone=(), geolocation=()'");
    expect(api).not.toMatch(/8x8|jit\.si|frame-src/i);
  });
});
