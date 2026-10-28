/**
 * Regression for native run 20261017T014326Z-70172c: public/dossier-revoke.js did not select shareTokenHash, so holdsOwnerSecret saw `undefined`, classified every
 * RC5 dossier as LEGACY and refused the legitimate owner's erasure (404). Mocked unit tests never saw it (their rows were complete); only real PostgreSQL did.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { holdsOwnerSecret, isLegacyShare } from '../../api/_utils/share-access.js';

describe('legacy classification never guesses', () => {
  it('null / empty shareTokenHash = legacy (no owner); a hash = RC5 row', () => {
    expect(isLegacyShare({ rightsSecretHash: 'h', shareTokenHash: null })).toBe(true);
    expect(isLegacyShare({ rightsSecretHash: 'h', shareTokenHash: '' })).toBe(true);
    expect(isLegacyShare({ rightsSecretHash: 'h', shareTokenHash: 'x'.repeat(64) })).toBe(false);
    expect(isLegacyShare(null)).toBe(false);
    expect(holdsOwnerSecret({ rightsSecretHash: 'h', shareTokenHash: null }, 'anything')).toBe(false);   // a link is never proof of ownership
  });
  it('a row loaded WITHOUT the column is a programming error (throws) - it must not silently look legacy or owned', () => {
    expect(() => isLegacyShare({ rightsSecretHash: 'h' })).toThrow(/shareTokenHash must be selected/);
    expect(() => holdsOwnerSecret({ rightsSecretHash: 'h' }, 's')).toThrow();
  });
});

describe('every handler that checks ownership selects the column it needs', () => {
  const root = path.resolve(__dirname, '../../api/_handlers');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  it.each(['public/dossier-revoke.js', 'public/dossier-grants.js', 'pro/dossier/redeem.js'])('%s selects shareTokenHash in its SharedDiagnostic query', (file) => {
    const src = read(file);
    const q = src.match(/SharedDiagnostic\.findFirst\(\{[^;]*?\}\);/s);
    expect(q, 'findFirst query present').toBeTruthy();
    expect(q[0]).toContain('shareTokenHash: true');
  });
});
