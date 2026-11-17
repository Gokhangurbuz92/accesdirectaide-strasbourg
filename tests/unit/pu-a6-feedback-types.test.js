/**
 * A-6 (P19) — POST /api/feedback accepted « aide » and « demarche » only. A place is filed with the existing enum value STRUCTURE; a dispositif (no enum
 * value, no migration) is filed under AIDE with its target written `dispositif:<id>`. Unknown kinds are still refused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: /** @type {any[]} */ ([]) }));
vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: (/** @type {any} */ v) => ({ returning: async () => { state.values.push(v); return [{ id: 'cr-1', ...v }]; } }) }) } }));
vi.mock('../../api/_services/feature-flags.js', () => ({ isFeatureOn: async () => true }));

import handler from '../../api/_handlers/feedback.js';

let n = 0;
const call = async (body) => {
  const res = { statusCode: 200, body: /** @type {any} */ (null), status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
  await handler({ method: 'POST', url: '/api/feedback', headers: { 'x-forwarded-for': `198.51.100.${100 + (++n)}` }, body }, res);
  return res;
};
beforeEach(() => { state.values.length = 0; });

describe('A-6: content reports for places and dispositifs', () => {
  it('a place is filed as STRUCTURE with its id', async () => {
    const res = await call({ type: 'structure', id: 'st-1', slug: 'lieu-exemple', message: 'Le téléphone indiqué ne répond plus.', pageUrl: 'https://example.test/structures/lieu-exemple' });
    expect(res.statusCode).toBe(201);
    expect(state.values[0]).toMatchObject({ contentType: 'STRUCTURE', contentId: 'st-1', reason: 'AUTRE', pageUrl: 'https://example.test/structures/lieu-exemple' });
  });
  it('a place known by its slug only', async () => {
    await call({ type: 'structure', slug: 'lieu-exemple', message: 'Horaires à corriger.' });
    expect(state.values[0]).toMatchObject({ contentType: 'STRUCTURE', contentId: 'slug:lieu-exemple' });
  });
  it('a dispositif is filed with a target that names its kind', async () => {
    const res = await call({ type: 'dispositif', id: 'dp-1', message: 'Le lien officiel a changé.' });
    expect(res.statusCode).toBe(201);
    expect(state.values[0]).toMatchObject({ contentType: 'AIDE', contentId: 'dispositif:dp-1' });
    await call({ type: 'dispositif', slug: 'carte-vitale', message: 'Le lien officiel a changé.' });
    expect(state.values[1]).toMatchObject({ contentType: 'AIDE', contentId: 'dispositif:slug:carte-vitale' });
  });
  it('aides and démarches are filed as before; an unknown kind is refused', async () => {
    await call({ type: 'aide', id: 'a-1', message: 'Montant à vérifier.' });
    await call({ type: 'demarche', id: 'd-1', message: 'Étape manquante.' });
    expect(state.values.map((v) => [v.contentType, v.contentId])).toEqual([['AIDE', 'a-1'], ['DEMARCHE', 'd-1']]);
    const res = await call({ type: 'actualite', id: 'x', message: 'Un message assez long.' });
    expect(res.statusCode).toBe(400); expect(res.body.error).toBe('invalid_type');
    const proto = await call({ type: 'constructor', id: 'x', message: 'Un message assez long.' });
    expect(proto.statusCode).toBe(400);
  });
});
