/**
 * Release B (D2 V2, owner direction 08/11/2026) — unit rules: the terms of use are accepted by the boolean true only (a contract acceptance, recorded with the
 * document and its version; never a consent), and the citizen telephone number is not collected in Production, Preview or the beta unless explicitly opened.
 */
import { describe, expect, it } from 'vitest';
import { termsAcceptanceGiven, termsReference, TERMS_ACCEPTANCE_PURPOSE, CONTRACT_ACCEPTANCE, TERMS_REQUIRED_REFUSAL } from '../../api/_utils/terms-acceptance.js';
import { phoneCollectionOpen } from '../../api/_utils/phone-collection.js';
import { LEGAL_DRAFTS_VERSION } from '../../src/config/legal-drafts.js';

describe('Release B — terms acceptance', () => {
  it('only the boolean true accepts', () => {
    expect(termsAcceptanceGiven(true)).toBe(true);
    for (const v of [undefined, null, false, 'true', 1, 'yes', {}, []]) expect(termsAcceptanceGiven(v), JSON.stringify(v)).toBe(false);
  });
  it('records the document and its current version, as a contract acceptance (not a consent)', () => {
    expect(termsReference()).toBe(`cgu-citoyen@${LEGAL_DRAFTS_VERSION}`);
    expect(TERMS_ACCEPTANCE_PURPOSE).toBe('TERMS_ACCEPTANCE_CGU_CITOYEN');
    expect(CONTRACT_ACCEPTANCE).toBe('CONTRACT_ACCEPTANCE');
    expect(TERMS_REQUIRED_REFUSAL.code).toBe('TERMS_ACCEPTANCE_REQUIRED');
    expect(TERMS_REQUIRED_REFUSAL.message).not.toMatch(/consent/i);
  });
});

describe('Release B — telephone collection closed outside the LAB', () => {
  it.each([
    [{ VERCEL_ENV: 'production' }, false],
    [{ VERCEL_ENV: 'preview' }, false],
    [{ ADA_PUBLIC_BETA_RESTRICTED: '1' }, false],
    [{ VERCEL_ENV: 'production', ADA_CITIZEN_PHONE_COLLECTION: 'yes' }, false],
    [{ VERCEL_ENV: 'production', ADA_CITIZEN_PHONE_COLLECTION: 'open' }, true],
    [{ VERCEL_ENV: 'development' }, true],
    [{}, true],
  ])('%j → open %s', (env, open) => {
    expect(phoneCollectionOpen(env)).toBe(open);
  });
});
