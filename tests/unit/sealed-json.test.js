/**
 * Launch-readiness item 60 — the encrypted jsonb column type (src/db/sealed-json.ts) with its codec (api/lib/situation-codec.js): the stored form is an envelope,
 * the application value is the plain object, old plain rows pass through, and the envelope opens only for the purpose it was sealed for.
 */
import { describe, expect, it } from 'vitest';
import { isSealedJson, sealedJson, sealedJsonCodecLoaded } from '../../src/db/sealed-json.js';
import { SITUATION_SEAL } from '../../api/lib/situation-codec.js';
import { openText } from '../../api/lib/data-keys.js';

/** the transforms drizzle applies to the column (the builder keeps the customType parameters) */
const params = /** @type {any} */ (sealedJson('situation')).config.customTypeParams;

describe('sealed json column', () => {
  it('stores an envelope and reads back the plain object', () => {
    expect(sealedJsonCodecLoaded()).toBe(true);
    const { toDriver, fromDriver } = params;
    const stored = JSON.parse(toDriver({ foyer: 'couple', enfants: 2 }));
    expect(isSealedJson(stored)).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/couple|enfants/);
    expect(fromDriver(stored)).toEqual({ foyer: 'couple', enfants: 2 });
    expect(fromDriver({ ancien: 'en clair' })).toEqual({ ancien: 'en clair' });   // rows stored before stay readable
    expect(() => openText(stored.enc, { purpose: 'case-note', context: SITUATION_SEAL.context })).toThrow();   // bound to its purpose
  });
  it('recognises only the exact envelope shape', () => {
    expect(isSealedJson({ enc: 'v2:abcd1234:d:x:y' })).toBe(true);
    for (const v of [{ enc: 'plain text' }, { enc: 'v2:x', other: 1 }, ['v2:x'], null, 'v2:x', { foyer: 'seul' }]) expect(isSealedJson(v), JSON.stringify(v)).toBe(false);
  });
});
