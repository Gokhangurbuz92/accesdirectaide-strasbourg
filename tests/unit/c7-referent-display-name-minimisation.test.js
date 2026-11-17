/**
 * C7 (owner Paket 4, 17/11/2026) — « référent de parcours » display name: data minimisation enforced by the service (api/_services/dossier-referent.js volunteer):
 * the professional's explicit agreement (displayNameConsent === true), 2 to 80 characters (also a database CHECK, migration 0047), a NAME only (no e-mail, link
 * or number). The no-access property is proven in tests/unit/m2-redirect-referent.test.js and the real-DB flow in tests/integration/m2-redirect-referent-db.test.js.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { isMinimalDisplayName } from '../../api/_services/dossier-referent.js';

describe('C7 — référent display name: a name, nothing else', () => {
  it('ordinary names and functions pass', () => {
    for (const n of ['Camille', 'Camille, CESF', 'M. Dupont — conseiller', 'Équipe 2, Camille', 'Aïcha (assistante sociale)']) expect(isMinimalDisplayName(n), n).toBe(true);
  });
  it('an e-mail address, a link or a number is refused', () => {
    for (const n of ['camille@example.org', 'Camille 06 12 34 56 78', 'Camille 0612345678', 'Camille +33612345678', 'Camille https://x.example', 'Camille http://x', 'Camille www.example.org',
      'Camille 1 85 05 78 006 084', 'dossier 123456']) expect(isMinimalDisplayName(n), n).toBe(false);
  });
  it('the service checks agreement, length and minimisation before anything is written; the database keeps the length bound', () => {
    const svc = fs.readFileSync('api/_services/dossier-referent.js', 'utf8');
    const at = (s) => svc.indexOf(s);
    expect(at("input.displayNameConsent !== true")).toBeGreaterThan(0);
    expect(at("displayName.length > 80")).toBeGreaterThan(at("input.displayNameConsent !== true"));
    expect(at("!isMinimalDisplayName(displayName)")).toBeGreaterThan(at("displayName.length > 80"));
    expect(at('INSERT INTO "DossierReferent"')).toBeGreaterThan(at("!isMinimalDisplayName(displayName)"));
    expect(fs.readFileSync('drizzle/0047_m2_referral_redirect_referent.sql', 'utf8')).toMatch(/CHECK \(char_length\("displayName"\) BETWEEN 2 AND 80\)/);
    // the pro form caps the field at the same length
    expect(fs.readFileSync('src/pages/pro/Cases.jsx', 'utf8')).toMatch(/id="case-referent-name"[^>]*maxLength=\{80\}/);
  });
});
