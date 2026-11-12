/**
 * D13 follow-up — the dashboard's « Doublons proposés » is the number of open pairs, not the length of the list's first page (candidates() is bounded to 100):
 * countCandidates() counts the identifier / address pairs in SQL and applies the list's own name rule (distinctivePartsClose) to the name-only couples.
 * The real-database behaviour is in tests/integration/doublons-reversal-db.test.js.
 */
import { describe, expect, it, vi } from 'vitest';
import { countCandidates } from '../../api/_services/duplicate-register.js';

const fakeDb = (row) => ({ execute: vi.fn().mockResolvedValue({ rows: [row] }) });

describe('countCandidates (dashboard duplicate count)', () => {
  it('adds the strong pairs and the name-only couples the list would keep, beyond 100', async () => {
    const db = fakeDb({ strong: 240, names: [
      ['Mission locale pour l’emploi', 'Mission locale pour l’emploi de Strasbourg', 3],   // kept by the list: counted 3 times
      ['Agence France Travail STRASBOURG MEINAU', 'Agence France Travail STRASBOURG DANUBE', 5],   // two branches of one network: never proposed
    ] });
    expect(await countCandidates({ db })).toEqual({ ok: true, total: 243 });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('reads a JSON text answer and an empty register', async () => {
    expect((await countCandidates({ db: fakeDb({ strong: 0, names: '[]' }) })).total).toBe(0);
    expect((await countCandidates({ db: fakeDb({ strong: '7', names: JSON.stringify([['Centre social Hautepierre', 'Centre Social de Hautepierre', 1]]) }) })).total).toBe(8);
  });

  it('the query has no LIMIT (the count is not the list page)', async () => {
    const db = fakeDb({ strong: 0, names: [] });
    await countCandidates({ db });
    const q = db.execute.mock.calls[0][0];
    const text = JSON.stringify(q.queryChunks ?? q);
    expect(text).not.toMatch(/\bLIMIT\b/);
  });
});
