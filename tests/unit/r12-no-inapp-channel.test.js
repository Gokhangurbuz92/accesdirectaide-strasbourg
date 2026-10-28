/**
 * R12 (C20) — no in-app inbox exists for citizens: the « inapp » channel is never shown as on, cannot be switched on, and the profile page no longer offers it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, unavailableChannels } from '../../api/_services/citizen-account.js';

describe('in-app channel', () => {
  it('off by default and listed as unavailable whatever the configuration', () => {
    expect(Object.entries(DEFAULT_PREFS).filter(([k, v]) => k.startsWith('inapp.') && v)).toEqual([]);
    expect(unavailableChannels({})).toContain('inapp');
  });
  it('the profile page has no « Dans l’application » column and says why', () => {
    const src = readFileSync('src/pages/CompteProfil.jsx', 'utf8');
    expect(src).not.toMatch(/\['inapp', 'Dans l’application'\]/);
    expect(src).toMatch(/data-testid="prefs-no-inapp"/);
  });
});
