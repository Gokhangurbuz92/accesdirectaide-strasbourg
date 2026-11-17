/**
 * A-31 (P19) — POST /api/public/suggest-structure inserted « website » and « email » as received into NOT NULL columns: a direct call without them
 * (both optional in the schema and on the form) was a 500. The handler validates the body (400) and stores an absent optional value as ''.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: /** @type {any[]} */ ([]) }));
vi.mock('../../src/db/index.js', () => ({
  db: {
    insert: () => ({ values: (/** @type {any} */ v) => ({ returning: async () => {
      // the real table: website and email are NOT NULL
      if (v.website == null || v.email == null) throw Object.assign(new Error('null value in column violates not-null constraint'), { code: '23502' });
      state.values.push(v); return [{ id: 'pr-1' }];
    } }) }),
  },
}));
vi.mock('../../api/_services/feature-flags.js', () => ({ isFeatureOn: async () => true }));

import handler from '../../api/_handlers/public/suggest-structure.js';

let n = 0;
const call = async (body) => {
  const res = { statusCode: 200, body: /** @type {any} */ (null), status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
  await handler({ method: 'POST', url: '/api/public/suggest-structure', headers: { 'x-forwarded-for': `198.51.100.${++n}` }, body }, res);
  return res;
};
beforeEach(() => { state.values.length = 0; });

describe('A-31: suggest-structure never answers 500 for missing optional fields', () => {
  it('a direct call without website and e-mail is recorded (200), the two columns hold the empty string', async () => {
    const res = await call({ structureName: 'Association Exemple', city: 'Strasbourg', consent: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, id: 'pr-1' });
    expect(state.values[0]).toMatchObject({ structureName: 'Association Exemple', city: 'Strasbourg', website: '', email: '', consent: true, status: 'pending' });
  });
  it('the form\'s own payload (empty strings) is still accepted', async () => {
    const res = await call({ structureName: 'Association Exemple', city: 'Strasbourg', type: 'association', website: '', email: '', message: 'Adresse : 1 rue Exemple', consent: true, honeypot: '' });
    expect(res.statusCode).toBe(200);
    expect(state.values[0]).toMatchObject({ website: '', email: '', type: 'association' });
  });
  it.each([
    ['a website that is not a URL', { website: 'pas une adresse' }, 'website'],
    ['an e-mail that is not an address', { email: 'pas-un-mail' }, 'email'],
    ['a name that is not text', { structureName: { $ne: null } }, 'structureName'],
    ['an over-long name', { structureName: 'x'.repeat(201) }, 'structureName'],
    ['an over-long message', { message: 'x'.repeat(2001) }, 'message'],
    ['a website that is not text', { website: 42 }, 'website'],
  ])('%s → 400 with the field named, nothing recorded', async (_label, extra, field) => {
    const res = await call({ structureName: 'Association Exemple', city: 'Strasbourg', consent: true, ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.fields).toContain(field);
    expect(state.values).toEqual([]);
  });
  it('the required fields are still required (name, city, explicit consent)', async () => {
    for (const body of [{ city: 'Strasbourg', consent: true }, { structureName: 'A', consent: true }, { structureName: 'A', city: 'Strasbourg' }, { structureName: 'A', city: 'Strasbourg', consent: 'true' }]) {
      const res = await call(body);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('MISSING_FIELDS');
    }
    expect(state.values).toEqual([]);
  });
});
