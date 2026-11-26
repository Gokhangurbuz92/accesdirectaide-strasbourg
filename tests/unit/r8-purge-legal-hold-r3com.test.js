/**
 * R8: the two R3 communication delete steps (closed content reports, closed partnership requests) respect an ACTIVE LegalHold like every other
 * delete step of the purge (audit 26/11/2026: they had no hold check).
 */
import { vi } from 'vitest';
vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { contentReportsClosedWhere, partnershipRequestsClosedWhere } from '../../api/_handlers/cron/gdpr-purge.js';

const text = (q) => new PgDialect().sqlToQuery(q).sql;
const before = new Date('2026-01-01T00:00:00Z');

describe('R8 purge — R3 communication steps honour legal holds', () => {
  it('closed content reports: the report and the reported content can be held', () => {
    const s = text(contentReportsClosedWhere(before));
    expect(s).toMatch(/NOT EXISTS \(SELECT 1 FROM "LegalHold" h WHERE h\.status = 'ACTIVE' AND h\."recordId" IN \("ContentReport"\."id", "ContentReport"\."contentId"\)\)/);
    expect(s).toMatch(/"ContentReport"\."status" in/i);
  });
  it('closed partnership requests: the request can be held', () => {
    const s = text(partnershipRequestsClosedWhere(before));
    expect(s).toMatch(/NOT EXISTS \(SELECT 1 FROM "LegalHold" h WHERE h\.status = 'ACTIVE' AND h\."recordId" IN \("PartnershipRequest"\."id"\)\)/);
  });
});
