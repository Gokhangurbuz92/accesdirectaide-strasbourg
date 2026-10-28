/**
 * DTA S8 — structure of POST /api/rdv/appointments. The idempotency pre-check runs before the lock; the behavioural proof (same key from several processes => one 201 + 200 replays,
 * never a 409) is tests/integration/rdv-cross-process-db.test.js on a real PostgreSQL. This unit test pins the ORDER inside the transaction so a refactor cannot silently drop it:
 * advisory lock -> replay check (same citizen + same key) -> overlap check -> time-off check -> insert.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('api/_handlers/rdv.js', 'utf8');
const at = (needle, from = 0) => { const i = src.indexOf(needle, from); expect(i, needle).toBeGreaterThan(-1); return i; };

describe('booking transaction order', () => {
  it('lock, then replay under the lock, then the overlap check, then the time-off check, then the insert', () => {
    const lock = at('pg_advisory_xact_lock(hashtextextended(${bookingLockKey}');
    const replay = at('replayUnderLock = await loadAppointmentWithRelations', lock);
    const overlap = at('const overlaps = await tx', replay);
    const timeOff = at('schema.ProTimeOff', overlap);
    const insert = at('tx.insert(schema.ProAppointment)', timeOff);
    expect([lock, replay, overlap, timeOff, insert]).toEqual([...[lock, replay, overlap, timeOff, insert]].sort((a, b) => a - b));
  });
  it('the replay is keyed by the authenticated citizen AND the key, answers 200, and sends no second confirmation e-mail', () => {
    const block = src.slice(at('replayUnderLock = await'), at('const overlaps = await tx'));
    expect(block).toMatch(/citizenUserId: auth\.user\.id, idempotencyKey/);
    expect(block).toMatch(/reply\(200,/);   // R12: answered after COMMIT (reply() inside the transaction)
    expect(block).not.toMatch(/deferredConfirmationEmail\s*=/);
  });
});
