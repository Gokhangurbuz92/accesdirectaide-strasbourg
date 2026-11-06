/**
 * R47 audit — the legal-hold safeguard of a GDPR erasure fails CLOSED. findActiveLegalHolds used safeFindMany, which answers an EMPTY list when the
 * LegalHold query API is missing or the read throws: « no hold » — the erasure went on. Now an unreadable hold table refuses (LEGAL_HOLD_CHECK_FAILED) before
 * any row is deleted, and the request is not marked « partially completed ». MOCK-LEVEL: a fake drizzle client (no database).
 */
import { describe, expect, it, vi } from 'vitest';
import { createPrivacyRightsService } from '../../api/_services/privacy.js';

const cryptoLib = { createHash: () => ({ update() { return this; }, digest: () => 'h' }), randomBytes: () => ({ toString: () => 'x' }) };
const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });

/** @param {any} legalHold the LegalHold query API (or undefined) */
function fakeDb(legalHold) {
  const deletes = []; const updates = [];
  const db = {
    query: {
      CitizenUser: { findFirst: vi.fn().mockResolvedValue({ id: 'u1', email: 'r47-subject@example.test' }) },
      DSRRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'req1', subjectId: 'u1', requestType: 'DELETE', status: 'APPROVED' }), findMany: vi.fn().mockResolvedValue([]) },
      ProAppointment: { findMany: vi.fn().mockResolvedValue([{ id: 'a1', citizenUserId: 'u1' }]) },
      ConversationLog: empty(), AuthToken: empty(), SharedDiagnostic: empty(), ConsentLog: empty(), RdvConversation: empty(), UserConsent: empty(),
      GuardianRelationship: empty(), RdvConversationMessage: empty(), RdvNotificationLog: empty(), AuditLog: empty(),
      ...(legalHold ? { LegalHold: legalHold } : {}),
    },
    delete: vi.fn((t) => { deletes.push(t); return { where: () => ({ returning: async () => [] }) }; }),
    update: vi.fn((t) => { updates.push(t); return { set: () => ({ where: () => ({ returning: async () => [] }) }) }; }),
    insert: vi.fn(() => ({ values: async () => [] })),
  };
  db.transaction = async (fn) => fn(db);
  return { db, deletes, updates };
}

describe('R47: legal-hold check fails closed', () => {
  it('a failed LegalHold read refuses the approved erasure before anything is deleted', async () => {
    const { db, deletes } = fakeDb({ findMany: vi.fn().mockRejectedValue(new Error('connection reset')) });
    const service = createPrivacyRightsService({ db, cryptoLib });
    await expect(service.executeApprovedDeletion('req1')).rejects.toMatchObject({ code: 'LEGAL_HOLD_CHECK_FAILED' });
    expect(deletes).toEqual([]);
  });

  it('a client without the LegalHold query API refuses too (never « no hold »)', async () => {
    const { db, deletes } = fakeDb(undefined);
    const service = createPrivacyRightsService({ db, cryptoLib });
    await expect(service.executeApprovedDeletion('req1')).rejects.toMatchObject({ code: 'LEGAL_HOLD_CHECK_FAILED' });
    await expect(service.deleteDataDomains('u1', ['CitizenAppointment'], { requestId: 'req1' })).rejects.toMatchObject({ code: 'LEGAL_HOLD_CHECK_FAILED' });
    expect(deletes).toEqual([]);
  });

  it('an ACTIVE hold on one of the person\'s records still blocks (LEGAL_HOLD_ACTIVE), an unrelated hold does not count', async () => {
    const held = fakeDb({ findMany: vi.fn().mockResolvedValue([{ id: 'h1', recordId: 'a1', status: 'ACTIVE' }]) });
    await expect(createPrivacyRightsService({ db: held.db, cryptoLib }).executeApprovedDeletion('req1')).rejects.toMatchObject({ code: 'LEGAL_HOLD_ACTIVE' });
    expect(held.deletes).toEqual([]);
    const other = fakeDb({ findMany: vi.fn().mockResolvedValue([{ id: 'h2', recordId: 'someone-else', status: 'ACTIVE' }]) });
    const r = await createPrivacyRightsService({ db: other.db, cryptoLib }).deleteDataDomains('u1', ['CitizenAppointment'], { requestId: 'req1' }).catch((e) => e);
    expect(r?.code).not.toBe('LEGAL_HOLD_ACTIVE');
    expect(r?.code).not.toBe('LEGAL_HOLD_CHECK_FAILED');
  });
});
