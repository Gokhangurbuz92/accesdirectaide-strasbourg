/**
 * VIS — one 404 for « unknown » and « exists but not public right now ». A distinct reason code (« en cours de revérification », « retirée ») would tell
 * anyone who guesses a slug — slugs are built from the title — that a record with that name exists and is hidden: a publication hold is a privacy or
 * safety decision, so that fact is itself protected. The handlers therefore answer the SAME status, body and headers for an unknown record, a stale
 * one, one on hold and an unpublished one; the page explains both cases in one sentence (tests/unit/vis-dead-ends-human-help.test.jsx).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ row: null }));
vi.mock('../../src/db/index.js', () => ({ db: { query: {
  Structure: { findFirst: async () => S.row }, Aide: { findFirst: async () => S.row }, Demarche: { findFirst: async () => S.row },
} } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' }));
vi.mock('../../api/_utils/auth.js', () => ({ verifyAdmin: async () => false }));

import structures from '../../api/_handlers/structures.js';
import aides from '../../api/_handlers/aides.js';
import demarches from '../../api/_handlers/demarches.js';
import { decide } from '../../api/lib/publicVisibility.js';

const day = 86400000;
const visible = (statut) => ({
  id: 'r1', slug: 'ccas-de-test', nom: 'CCAS de test', titre: 'Aide de test', statut, launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'auto-chain',
  territory_verified: true, publication_hold: null, data_origin: 'official_source', date_verification: new Date(Date.now() - 10 * day),
  source_url: 'https://lannuaire.service-public.gouv.fr/x', adresse: '1 rue du Test', situations: [], aidSituations: [],
});
const HIDDEN = {
  stale: (r) => ({ ...r, date_verification: new Date(Date.now() - 400 * day) }),
  hold: (r) => ({ ...r, publication_hold: 'PRIVACY: signalement en cours' }),
  unpublished: (r) => ({ ...r, statut: 'brouillon' }),
  unverified: (r) => ({ ...r, verification_status: 'PENDING' }),
};
const call = async (handler, url) => {
  const out = { status: 0, body: undefined, headers: {} };
  const res = {
    status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; }, send(b) { out.body = b; return res; }, end() { return res; },
    setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; return res; }, getHeader: (k) => out.headers[String(k).toLowerCase()],
  };
  await handler({ method: 'GET', url, query: {}, headers: { host: 'localhost' } }, res);
  return out;
};
const CASES = [
  ['structure', structures, '/api/structures/ccas-de-test', 'actif'],
  ['aide', aides, '/api/aides/aide-de-test', 'publie'],
  ['demarche', demarches, '/api/demarches/demarche-de-test', 'publie'],
];

beforeEach(() => { S.row = null; });

describe('a hidden record is the same 404 as an unknown one', () => {
  for (const [kind, handler, url, statut] of CASES) {
    it(`${kind}: unknown, stale, on hold, unpublished and unverified answer the same status, body and headers; nothing of the record leaks`, async () => {
      S.row = null;
      const unknown = await call(handler, url);
      expect(unknown.status).toBe(404);
      expect(Object.keys(unknown.body)).toEqual(['error']);
      for (const [why, make] of Object.entries(HIDDEN)) {
        S.row = make(visible(statut));
        expect(decide(S.row, kind).visible, `${why} is hidden`).toBe(false);
        const hidden = await call(handler, url);
        expect(hidden, `${kind} ${why}`).toEqual(unknown);
        expect(JSON.stringify(hidden)).not.toMatch(/CCAS de test|Aide de test|rue du Test|PRIVACY|signalement|lannuaire|reason|stale|hold|v[ée]rification/i);
      }
    });
    it(`${kind}: the control record is public (200)`, async () => {
      S.row = visible(statut);
      expect(decide(S.row, kind).visible).toBe(true);
      expect((await call(handler, url)).status).toBe(200);
    });
  }
});
