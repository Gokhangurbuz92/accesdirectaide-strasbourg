/**
 * PKG-11 slice 10 — the pure parts (no database): the SMS channel gate (N02), the administrator session rule (ADM-10), the field-level FALC label (ADM-11), the
 * « serves » parameter (E05) and the one login refusal (R2-7). Behaviour on real PostgreSQL: pkg11-audit3-db.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { optOutReady, INBOUND_STOP_ROUTED } from '../../api/lib/sms-policy.js';
import { adminSessionRefused } from '../../api/_utils/auth.js';
import { falcLabel, falcFieldNote } from '../../src/lib/falcLabel.js';
import { searchStructuresSchema } from '../../api/_utils/validators.js';

const src = (p) => readFileSync(p, 'utf8');
const stubDb = (row) => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }) });

describe('PKG-11 slice 10 — pure rules', () => {
  it('N02: the SMS channel stays inactive while « STOP » is not routed, whatever is configured; every sender checks the gate', () => {
    expect(INBOUND_STOP_ROUTED).toBe(false);
    expect(optOutReady({ SMS_INBOUND_URL: 'https://example.test/sms', TWILIO_AUTH_TOKEN: 't' })).toBe(false);
    expect(optOutReady({ SMS_INBOUND_URL: 'https://example.test/sms', TWILIO_AUTH_TOKEN: 't' }, true)).toBe(true);
    expect(optOutReady({}, true)).toBe(false);
    for (const f of ['api/_handlers/cron/rdv-reminder.js', 'api/_handlers/cron/parcours-reminder.js', 'api/_handlers/public/sms-notify.js']) expect(src(f), f).toMatch(/optOutReady\(\)/);
  });
  it('ADM-10: a disabled administrator, or a session older than the revocation instant, is refused; an unknown e-mail only in strict mode', async () => {
    const after = new Date('2026-10-24T10:00:00.500Z');
    expect(await adminSessionRefused({ email: 'a@x.test', iatMs: after.getTime() - 1 }, { db: stubDb({ disabledAt: null, sessionsValidAfter: after }) })).toBe(true);
    expect(await adminSessionRefused({ email: 'a@x.test', iatMs: after.getTime() + 1 }, { db: stubDb({ disabledAt: null, sessionsValidAfter: after }) })).toBe(false);
    expect(await adminSessionRefused({ email: 'a@x.test', iatMs: after.getTime() + 1 }, { db: stubDb({ disabledAt: new Date(), sessionsValidAfter: null }) })).toBe(true);
    expect(await adminSessionRefused({ email: 'a@x.test', iat: 1 }, { db: stubDb({ disabledAt: null, sessionsValidAfter: null }) })).toBe(false);
    expect(await adminSessionRefused({ email: 'ghost@x.test', iatMs: Date.now() }, { db: stubDb(null) })).toBe(false);
    process.env.ADMIN_SESSION_REGISTRY_STRICT = 'true';
    try {
      expect(await adminSessionRefused({ email: 'ghost@x.test', iatMs: Date.now() }, { db: stubDb(null) })).toBe(true);
      expect(await adminSessionRefused({ email: 'a@x.test' }, { db: { select: () => { throw new Error('down'); } } })).toBe(true);   // fail-closed
    } finally { delete process.env.ADMIN_SESSION_REGISTRY_STRICT; }
  });
  it('ADM-11: the label is « relue » only when every FALC text is reviewed as it stands; each section says its own state', () => {
    expect(falcLabel(true, { fields: { summary_falc: '2026-10-24T08:00:00Z', conditions_falc: '2026-10-24T08:00:00Z' } })).toBe('Version simplifiée (relue)');
    expect(falcLabel(true, { fields: { summary_falc: '2026-10-24T08:00:00Z', montant_falc: null } })).toBe('Version simplifiée (partiellement relue)');
    expect(falcLabel(true, { fields: { summary_falc: null }, origin: 'AI_LOCAL' })).toBe('Version simplifiée (IA, non relue)');
    expect(falcLabel(true, { at: '2026-10-01' })).toBe('Version simplifiée (relue)');   // former payloads
    expect(falcFieldNote(null)).toBe('Texte simplifié non relu par une personne'); expect(falcFieldNote(undefined)).toBeNull();
    expect(falcFieldNote('2026-10-24T08:00:00Z')).toMatch(/^Relu par une personne le 24\/10\/2026$/);
  });
  it('E05: « serves » takes an INSEE commune code only; R2-7: an unconfirmed address gets the one refusal answer', () => {
    expect(searchStructuresSchema.safeParse({ serves: '67482' }).success).toBe(true);
    expect(searchStructuresSchema.safeParse({ serves: '2A004' }).success).toBe(true);
    expect(searchStructuresSchema.safeParse({ serves: "67482' OR 1=1" }).success).toBe(false);
    const login = src('api/_handlers/auth/login.js');
    expect(login).not.toMatch(/code: 'EMAIL_NOT_VERIFIED'/); expect(login).toMatch(/if \(!user\.emailVerifiedAt\) \{\n\s+return res\.status\(401\)\.json\(INVALID\);/);
  });
});
