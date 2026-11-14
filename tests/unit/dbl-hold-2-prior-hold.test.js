// DBL-HOLD-2: the earlier hold a duplicate hold carries is recognised exactly; anything else is not.
import { describe, expect, it } from 'vitest';
import { DUPLICATE_HOLD_MARKER, carriedPriorHold } from '../../api/_services/content-verification.js';
import { DUPLICATE_HOLD } from '../../api/_services/duplicate-register.js';

describe('DBL-HOLD-2 carriedPriorHold', () => {
  it('uses the register marker', () => { expect(DUPLICATE_HOLD_MARKER).toBe(DUPLICATE_HOLD); });
  it('returns the earlier hold carried after « … » · ', () => {
    expect(carriedPriorHold(`${DUPLICATE_HOLD} : même organisation que « Centre X » · Signalement en cours`)).toBe('Signalement en cours');
    expect(carriedPriorHold(`${DUPLICATE_HOLD} : même organisation que « A · B » · Modifié · relire`)).toBe('Modifié · relire');
  });
  it('returns null for a plain duplicate hold, another hold, or nothing', () => {
    expect(carriedPriorHold(`${DUPLICATE_HOLD} : même organisation que « Centre X »`)).toBeNull();
    expect(carriedPriorHold('Signalement en cours · autre')).toBeNull();
    expect(carriedPriorHold(null)).toBeNull();
    expect(carriedPriorHold(`${DUPLICATE_HOLD} : même organisation que « Centre X » · `)).toBeNull();
  });
});
