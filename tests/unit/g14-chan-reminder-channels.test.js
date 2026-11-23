/**
 * G14-CHAN — free reminder channels (offline, no network, no database):
 *  - the J-1 e-mail's calendar file: title « Rendez-vous », start / end, LOCATION = the structure's public address, a DESCRIPTION without personal data,
 *    the OpenStreetMap directions link; dropped entirely at the minimal privacy level (the default);
 *  - the Web Push nudge: « Rappel : rendez-vous demain à 10 h — ouvrir AccesDirectAide » at the reduced level, the neutral text otherwise; never a name,
 *    a structure, a service or a place; a per-account daily cap; the optional tag reaches the service worker's notification;
 *  - the narrow gate ADA_BETA_ACCOUNTS_EXTRA=push opens citizen/push and citizen.push only;
 *  - the pre-rendered FALC audio matches the current texts (or is not offered), and the build script and the player hash texts the same way.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { appointmentReminderPush, osmDirectionsUrl, parisHourFr, reminderCalendar } from '../../api/lib/reminder-channels.js';
import { buildAppointmentIcs } from '../../api/_utils/ics.js';
import { buildCitizenNoticeMail } from '../../api/_services/appointment-notices.js';
import { minimalPush } from '../../api/lib/notification-privacy.js';
import { sendToUser, pushLedgerStatus } from '../../api/_services/web-push.js';
import { isAllowedInPublicBeta, accountsExtraCapabilities } from '../../api/_utils/public-beta.js';
import { capabilityState } from '../../api/_utils/capabilities.js';
import { FALC_PAGE_DRAFTS } from '../../src/content/falc/citizenPages.fr.js';
import { speechText, textHash } from '../../scripts/build-falc-audio.mjs';

const STRUCTURE = { nom: 'Centre social Exemple', adresse: '1 rue de la Paix', code_postal: '67000', ville: 'Strasbourg', latitude: 48.5839, longitude: 7.7455,
  verification_status: 'VERIFIED', data_origin: 'official_source' };
// 10:00 Paris (winter, UTC+1)
const RDV = { id: 'rdv-1', startAt: new Date('2026-12-02T09:00:00Z'), endAt: new Date('2026-12-02T09:30:00Z'), mode: 'IN_PERSON', rescheduleCount: 1, citizenUserId: 'u1',
  notes: 'Mon message personnel', structure: STRUCTURE };

describe('G14-CHAN OpenStreetMap directions', () => {
  it('coordinates when valid, the public address otherwise, nothing for a video appointment or without an address', () => {
    expect(osmDirectionsUrl(STRUCTURE)).toBe('https://www.openstreetmap.org/directions?to=48.583900%2C7.745500#map=17/48.58390/7.74550');
    expect(osmDirectionsUrl({ ...STRUCTURE, latitude: null, longitude: null })).toBe('https://www.openstreetmap.org/search?query=1%20rue%20de%20la%20Paix%2C%2067000%20Strasbourg');
    expect(osmDirectionsUrl({ ...STRUCTURE, latitude: 0, longitude: 0 })).toContain('/search?query=');
    expect(osmDirectionsUrl({ ...STRUCTURE, latitude: 999, longitude: 7 })).toContain('/search?query=');
    expect(osmDirectionsUrl(STRUCTURE, { mode: 'VIDEO' })).toBeNull();
    expect(osmDirectionsUrl({ nom: 'x' })).toBeNull();
    expect(osmDirectionsUrl(null)).toBeNull();
  });
});

describe('G14-CHAN calendar file of the J-1 reminder', () => {
  const ics = buildAppointmentIcs(reminderCalendar(RDV)).replace(/\r\n /g, '');
  it('title « Rendez-vous », start / end in UTC, LOCATION = the public address, the directions link, SEQUENCE kept', () => {
    expect(ics).toContain('SUMMARY:Rendez-vous\r\n');
    expect(ics).toContain('DTSTART:20261202T090000Z');
    expect(ics).toContain('DTEND:20261202T093000Z');
    expect(ics).toContain('LOCATION:1 rue de la Paix\\, 67000 Strasbourg');
    expect(ics).toContain('Itinéraire (OpenStreetMap): https://www.openstreetmap.org/directions?to=48.583900%2C7.745500');
    expect(ics).toContain('SEQUENCE:1');
  });
  it('the DESCRIPTION holds no personal data (no booking message, no management link, no e-mail)', () => {
    const desc = ics.split('\r\n').find((l) => l.startsWith('DESCRIPTION:'));
    expect(desc).toBe(`DESCRIPTION:Service: Rendez-vous\\nItinéraire (OpenStreetMap): ${osmDirectionsUrl(STRUCTURE)}`);
    expect(ics).not.toContain('Mon message personnel');
    expect(ics).not.toMatch(/@(?!accesdirectaide\.fr)/);
  });
  it('a video appointment: no address, no directions; a missing end time is start + 30 min', () => {
    const v = buildAppointmentIcs(reminderCalendar({ ...RDV, mode: 'VIDEO', endAt: null })).replace(/\r\n /g, '');
    expect(v).not.toContain('openstreetmap');
    expect(v).toContain('DTEND:20261202T093000Z');
    expect(v).not.toContain('rue de la Paix');
  });
  it('reduced level: the e-mail carries the .ics; minimal level (sensitive / unknown — the default): no attachment at all', async () => {
    const message = { subject: 's', text: 'Rappel : vous avez rendez-vous demain.', calendar: reminderCalendar(RDV) };
    const reduced = await buildCitizenNoticeMail(RDV, 'REMINDER_J1', message, { lang: 'fr', to: 'person@example.org', resolveSensitivity: () => 'ordinary' });
    expect(reduced.level).toBe('reduced');
    expect(reduced.attachments).toHaveLength(1);
    expect(reduced.attachments[0].filename).toBe('acces-direct-aide-rdv-rdv-1.ics');
    expect(reduced.attachments[0].content).toContain('SUMMARY:Rendez-vous');
    for (const s of ['sensitive', 'unknown', undefined]) {
      const minimal = await buildCitizenNoticeMail(RDV, 'REMINDER_J1', message, { lang: 'fr', to: 'person@example.org', resolveSensitivity: () => s });
      expect(minimal.level).toBe('minimal');
      expect(minimal.attachments).toEqual([]);
      expect(minimal.text).not.toContain('openstreetmap');
    }
  });
});

describe('G14-CHAN Web Push nudge', () => {
  it('reduced: the hour only, a link inside the site; minimal: the neutral text', () => {
    expect(parisHourFr(RDV.startAt)).toBe('10 h');
    expect(parisHourFr(new Date('2026-07-02T08:30:00Z'))).toBe('10 h 30');
    const r = appointmentReminderPush('reduced', RDV.startAt);
    expect(r).toEqual({ title: 'Rappel AccesDirectAide', body: 'Rappel : rendez-vous demain à 10 h — ouvrir AccesDirectAide', url: '/compte/rendez-vous', tag: 'rdv-reminder' });
    for (const lvl of ['minimal', undefined, 'other']) expect(appointmentReminderPush(lvl, RDV.startAt, 'en')).toEqual({ ...minimalPush('en'), tag: 'account-notice' });
    for (const m of [r, appointmentReminderPush('minimal', RDV.startAt)]) {
      expect(JSON.stringify(m)).not.toMatch(/Centre social|rue de la Paix|Strasbourg|message/i);
    }
  });

  it('a per-account daily cap: over it nothing is attempted (RATE_LIMITED → ledger NOT_DELIVERED); a limiter error does not block', async () => {
    const crypto = await import('node:crypto');
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const env = { WEB_PUSH_VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'), WEB_PUSH_VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url').padStart(43, 'A'), WEB_PUSH_SUBJECT: 'mailto:ops@example.org' };
    const db = { select: () => ({ from: () => ({ where: async () => [{ id: 's1', subscriptionEncrypted: 'x', failureCount: 0 }] }) }), update: () => ({ set: () => ({ where: async () => undefined }) }), delete: () => ({ where: async () => undefined }) };
    const fetchImpl = vi.fn();
    const limited = await sendToUser('u1', { title: 't', body: 'b', url: '/' }, { db, env, fetchImpl, rateLimit: async () => ({ allowed: false }) });
    expect(limited).toEqual({ status: 'RATE_LIMITED', accepted: 0, failed: 0, expired: 0 });
    expect(pushLedgerStatus(limited)).toBe('NOT_DELIVERED');
    expect(fetchImpl).not.toHaveBeenCalled();
    // a limiter that throws: the send goes on past the limiter (here the fake sealed row is not a valid subscription: FAILED / EXPIRED, not RATE_LIMITED)
    const thrown = await sendToUser('u1', { title: 't', body: 'b', url: '/' }, { db, env, fetchImpl, rateLimit: async () => { throw new Error('kv down'); } });
    expect(['FAILED', 'EXPIRED']).toContain(thrown.status);
  });

  it('the service worker shows the tag (letters, digits, « - » only) and ignores anything else', async () => {
    const listeners = new Map(); const showNotification = vi.fn(async () => undefined);
    const ctx = { URL, Promise, console, caches: {}, fetch: vi.fn(), self: { location: { origin: 'https://ada.local' }, addEventListener: (t, h) => listeners.set(t, h), skipWaiting: vi.fn(),
      clients: { matchAll: vi.fn(async () => []), openWindow: vi.fn() }, registration: { showNotification } } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), ctx);
    const push = async (data) => { let p; listeners.get('push')({ data: { json: () => data }, waitUntil: (x) => { p = x; } }); await p; };
    await push({ title: 'T', body: 'B', url: '/compte/rendez-vous', tag: 'rdv-reminder' });
    expect(showNotification.mock.calls[0][1].tag).toBe('rdv-reminder');
    await push({ title: 'T', body: 'B', url: '/compte', tag: '<script>' });
    expect('tag' in showNotification.mock.calls[1][1]).toBe(false);
  });
});

describe('G14-CHAN narrow gate ADA_BETA_ACCOUNTS_EXTRA=push', () => {
  const BASE = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
  it('opens citizen/push (GET / POST / DELETE) and citizen.push only; nothing else of the full scope', () => {
    const env = { ...BASE, ADA_BETA_ACCOUNTS_EXTRA: 'push' };
    for (const m of ['GET', 'POST', 'DELETE']) expect(isAllowedInPublicBeta(m, 'citizen/push', env), m).toBe(true);
    expect(isAllowedInPublicBeta('GET', 'citizen/push', BASE)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'citizen/parcours', env)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'citizen/household', env)).toBe(false);
    expect([...accountsExtraCapabilities(env)]).toEqual(['citizen.push']);
    expect(capabilityState('citizen.push', env).open).toBe(true);   // in the AIPD (P10): no ADA_CAPABILITIES_OPEN needed
    expect(capabilityState('citizen.push', BASE).open).toBe(false);
    expect(capabilityState('citizen.household', { ...env, ADA_CAPABILITIES_OPEN: 'citizen.household' }).open).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'citizen/push', { ...env, ADA_BETA_OPEN_SURFACES: 'admin' })).toBe(false);
  });
});

describe('G14-CHAN pre-rendered FALC audio', () => {
  const manifest = JSON.parse(fs.readFileSync('src/content/falc/falc-audio-manifest.json', 'utf8'));
  it('the build script and the player hash the same text the same way', async () => {
    const { falcSpeechText, falcTextHash } = await import('../../src/content/falc/falcAudio.js');
    for (const d of Object.values(FALC_PAGE_DRAFTS)) {
      expect(falcSpeechText(d)).toBe(speechText(d));
      expect(falcTextHash(falcSpeechText(d))).toBe(textHash(speechText(d)));
    }
    expect(textHash('é')).not.toBe(textHash('e'));
  });
  it('every manifest entry names an existing file of a known draft; a stale entry is not offered', async () => {
    const { falcAudioFor } = await import('../../src/content/falc/falcAudio.js');
    expect(manifest.voice).toBe('fr_FR-siwis-medium');
    for (const [id, e] of Object.entries(manifest.entries)) {
      expect(FALC_PAGE_DRAFTS[id], id).toBeTruthy();
      expect(e.file).toBe(`/audio/falc/${id}.m4a`);
      expect(fs.statSync(`public${e.file}`).size).toBe(e.bytes);
      expect(e.bytes).toBeLessThan(600_000);
    }
    const home = FALC_PAGE_DRAFTS.home;
    expect(falcAudioFor({ ...home, title: `${home.title} (modifié)` }, manifest)).toBeNull();
    expect(falcAudioFor({ id: 'unknown', title: 't', blocks: [] }, manifest)).toBeNull();
  });
});
