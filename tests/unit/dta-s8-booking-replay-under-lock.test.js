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
    const replay = at('replayUnderLock = await replay(tx)', lock);   // R38: the locked part is the shared bookSlot(); the caller passes its replay lookup
    const overlap = at('const overlaps = await tx', replay);
    const timeOff = at('schema.ProTimeOff', overlap);
    const insert = at('tx.insert(T)', timeOff);   // R41-B: T = the ProAppointment table as this database has it (schema-features appointmentTable)
    expect([lock, replay, overlap, timeOff, insert]).toEqual([...[lock, replay, overlap, timeOff, insert]].sort((a, b) => a - b));
  });
  it('the replay is keyed by the authenticated citizen AND the key, answers 200, and sends no second confirmation e-mail', () => {
    // R38: bookSlot() runs the caller's replay lookup under the lock and returns it as « replay » without inserting
    const block = src.slice(at('replayUnderLock = await'), at('const overlaps = await tx'));
    expect(block).toMatch(/if \(replayUnderLock\) return \{ kind: 'replay'/);
    expect(block).not.toMatch(/sendAppointmentConfirmationEmail|sendMail/);
    // the citizen booking passes the authenticated citizen AND the key, answers the replay 200 (after COMMIT) and returns before the confirmation e-mail
    const create = src.slice(at('async function createAppointment'), at('export function withLoadedRelations'));
    expect(create).toMatch(/replay: \(\) => loadAppointmentWithRelations\(null, \{ citizenUserId: auth\.user\.id, idempotencyKey \}\)/);
    const replayBranch = create.slice(create.indexOf("if (outcome.kind === 'replay')"), create.indexOf("if (outcome.kind === 'duplicate')"));
    expect(replayBranch).toMatch(/res\.status\(200\)/);
    expect(replayBranch).not.toMatch(/sendAppointmentConfirmationEmail/);
    expect(create.indexOf("if (outcome.kind === 'replay')")).toBeLessThan(create.indexOf('await sendAppointmentConfirmationEmail'));
  });
});
