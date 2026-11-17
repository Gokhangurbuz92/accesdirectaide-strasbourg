/**
 * C8 (owner Paket 4, item 3) — bounds from the marginal tables. The table by need and the table by commune of one block count the SAME referrals, so
 * « published by commune − published by need » is the difference of the two masked sums. An attacker who also knows that a masked cell is at most
 * max(4, the smallest published cell of its column) (a primary cell is < 5; a complementary one was the smallest published) and that a listed need has at
 * least one referral can bound every masked cell. The attacker below is written here, independently of the implementation: with one linear equation and
 * box constraints, these interval bounds are exact.
 * Requirement: every masked cell keeps at least as many possible values as « below 5 » leaves it: 5 for a commune cell (0..4), 4 for a listed need's
 * referrals (1..4, a listed need has at least one) — the attacker learns nothing beyond « masked ».
 */
import { describe, expect, it } from 'vitest';
import { publishTables } from '../../api/_services/territorial-stats.js';

const KMIN = 5;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
/** attacker: interval of each masked cell of the two columns `a` (by need) and `c` (by commune) */
function attack(a, c, lowerA) {
  const bound = (col) => { const p = col.filter((v) => v !== null); return p.length ? Math.max(KMIN - 1, Math.min(...p)) : Infinity; };
  const uA = bound(a); const uC = bound(c);
  const nA = a.filter((v) => v === null).length; const nC = c.filter((v) => v === null).length;
  const D = sum(c.filter((v) => v !== null)) - sum(a.filter((v) => v !== null));
  const mul = (n, u) => (n === 0 ? 0 : n * u);
  const out = [];
  for (let i = 0; i < nA; i += 1) out.push(['need', Math.max(lowerA, D + mul(nC, 0) - mul(nA - 1, uA)), Math.min(uA, D + mul(nC, uC) - mul(nA - 1, lowerA))]);
  for (let j = 0; j < nC; j += 1) out.push(['commune', Math.max(0, mul(nA, lowerA) - D - mul(nC - 1, uC)), Math.min(uC, mul(nA, uA) - D - mul(nC - 1, 0))]);
  return out.map(([side, lo, hi]) => ({ side, lo, hi, values: hi === Infinity ? Infinity : hi - lo + 1, required: KMIN - (side === 'need' ? lowerA : 0) }));
}
const col = (rows, m) => rows.map((r) => r[m]);

describe('C8 marginal bounds: no masked cell is narrowed below five possible values', () => {
  it('the case that leaked: needs 4, 4, 5 and communes 0, 0, 13 — each masked need was 3..5, each masked commune 0..2', () => {
    const needs = [{ need: 'A', sent: 4, unmet: 0, outOfScope: 0 }, { need: 'B', sent: 4, unmet: 0, outOfScope: 0 }, { need: 'C', sent: 5, unmet: 0, outOfScope: 0 }];
    const communes = [{ commune: 'x', sent: 0, unmet: 0, outOfScope: 0 }, { commune: 'y', sent: 0, unmet: 0, outOfScope: 0 }, { commune: 'z', sent: 13, unmet: 0, outOfScope: 0 }];
    const pub = publishTables(needs, communes);
    for (const m of ['sent', 'unmet', 'outOfScope']) {
      for (const r of attack(col(pub.byNeed, m), col(pub.byCommune, m), m === 'sent' ? 1 : 0)) expect(r.values, `${m} ${r.side} [${r.lo}, ${r.hi}]`).toBeGreaterThanOrEqual(r.required);
    }
  });

  it('a sweep of small blocks: whatever the counts, no masked cell is narrowed below what « masked » says', () => {
    const vals = [0, 1, 2, 4, 5, 6, 9, 13];
    let checked = 0;
    for (const n1 of vals.slice(1)) for (const n2 of vals.slice(1)) for (const n3 of vals.slice(1)) for (const c1 of vals) for (const c2 of vals) {
      const total = n1 + n2 + n3; const c3 = total - c1 - c2; if (c3 < 0) continue;
      const pub = publishTables([n1, n2, n3].map((sent, i) => ({ need: `N${i}`, sent, unmet: 0, outOfScope: 0 })), [c1, c2, c3].map((sent, i) => ({ commune: `c${i}`, sent, unmet: 0, outOfScope: 0 })));
      for (const r of attack(col(pub.byNeed, 'sent'), col(pub.byCommune, 'sent'), 1)) { expect(r.values, `${[n1, n2, n3]} / ${[c1, c2, c3]}: ${r.side} [${r.lo}, ${r.hi}]`).toBeGreaterThanOrEqual(r.required); checked += 1; }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
