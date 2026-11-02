/**
 * R35 (LAB journeys): the administrators' audit log search by action name. Every action contains « _ »; the filter deleted it, so a full action
 * name (REVIEW_QUEUE_DECISION) matched nothing — in the search and in the scoped CSV export. Real PostgreSQL (WS2_REQUIRE_LOCAL_DB).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

let db; let audit; let AuditLog;
beforeAll(async () => {
  ({ db } = await import('../../src/db/index.js'));
  audit = await import('../../api/_services/audit-search.js');
  ({ AuditLog } = await import('../../src/db/schema.js'));
  await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'r35-audit-test'`);
  for (const [action, id] of [['REVIEW_QUEUE_DECISION', 'a'], ['REVIEW_QUEUE_DECISION', 'b'], ['REVIEWXQUEUE', 'c'], ['ADMIN_LOGIN', 'd']]) {
    await db.insert(AuditLog).values({ action, actor: 'admin.r35@lab.test', actor_id: 'admin.r35@lab.test', entity: 'r35-audit-test', entity_id: id });
  }
});

describe('audit log search by action', () => {
  it('a full action name finds its entries, and only them', async () => {
    const r = await audit.search({ action: 'REVIEW_QUEUE_DECISION', entity: 'r35-audit-test' }, db);
    expect(r.items.map((x) => x.entityId).sort()).toEqual(['a', 'b']);
  });
  it('a prefix still works, « _ » is a literal (REVIEW_ does not match REVIEWXQUEUE), « % » is not a wildcard', async () => {
    expect((await audit.search({ action: 'REVIEW_', entity: 'r35-audit-test' }, db)).items.map((x) => x.entityId).sort()).toEqual(['a', 'b']);
    expect((await audit.search({ action: '%', entity: 'r35-audit-test' }, db)).items).toEqual([]);
  });
  it('the scoped CSV export uses the same filter', async () => {
    const e = await audit.exportCsv({ action: 'REVIEW_QUEUE_DECISION', entity: 'r35-audit-test' }, { actor: 'admin.r35@lab.test', reason: 'contrôle R35 du filtre' }, db);
    expect(e.rows).toBe(2);
  });
});
