/**
 * PKG-11 deep audit (2026-10-23) — the pure parts of the fixes (no database): disclosure control, public projections, session rule, mail templates, and the
 * source-level guarantees of handlers that cannot run without infrastructure here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { complementColumn } from '../../api/_services/territorial-stats.js';
import { presentResults } from '../../api/lib/shareResults.js';
import { stripReviewFields } from '../../api/lib/publicVisibility.js';
import { citizenSessionRevoked } from '../../api/_utils/user-auth.js';
import { templates } from '../../api/lib/email-service.js';

describe('PKG-11 audit — disclosure control and public projections', () => {
  it('a column never has exactly one masked cell (secondary suppression), and is left alone otherwise', () => {
    expect(complementColumn([30, 19, null])).toEqual([30, null, null]);
    expect(complementColumn([null, null, 12])).toEqual([null, null, 12]);
    expect(complementColumn([7, 9])).toEqual([7, 9]);
    expect(complementColumn([null])).toEqual([null]);
  });
  it('the read-only share view carries no server-kept key (follow-ups, files, consent proofs)', () => {
    const out = presentResults({ assessment: { items: [] }, _followUps: { A: { internalNote: 'x' } }, _followUp: {}, _files: [{ storageKey: 'k' }], _consent: {}, _consentByStructure: {} });
    expect(Object.keys(out)).toEqual(['assessment']);
  });
  it('public rows never carry staff identities or internal reasons', () => {
    const pub = stripReviewFields({ id: 1, nom: 'S', updatedBy: 'admin@example.test', falc_reviewed_by: 'rev@example.test', commentaire_statut: 'suspendu : motif interne', falc_reviewed_at: '2026-10-01' });
    expect(pub).toEqual({ id: 1, nom: 'S', falc_reviewed_at: '2026-10-01' });
  });
});

describe('PKG-11 audit — sessions and mail', () => {
  it('a citizen session older than sessionsValidAfter is revoked; same second and no marker are not', () => {
    const after = new Date('2026-10-23T10:00:00.500Z');
    expect(citizenSessionRevoked(Math.floor(Date.parse('2026-10-23T09:59:59Z') / 1000), after)).toBe(true);
    expect(citizenSessionRevoked(Math.floor(Date.parse('2026-10-23T10:00:00Z') / 1000), after)).toBe(false);
    expect(citizenSessionRevoked(123, null)).toBe(false);
    expect(citizenSessionRevoked(undefined, after)).toBe(true);
  });
  it('verification and reset mails: the real link, the real validity, names escaped; a welcome without verification has no button', () => {
    const w = templates.welcome('<b>eve</b>', 'https://app.example.test/api/auth/verify-email?token=abc&next=%2F');
    expect(w.html).toContain('https://app.example.test/api/auth/verify-email?token=abc');
    expect(w.html).toContain('15 minutes'); expect(w.html).not.toMatch(/24 heures|\/auth\/verify\?|<b>eve<\/b>/);
    expect(templates.welcome('Structure', null).html).not.toMatch(/Vérifier mon adresse|pro-/);
    expect(templates.resetPassword('x', 'https://app.example.test/pro/reset-password?token=t', '1 heure').html).toContain('expire dans 1 heure');
  });
});

describe('PKG-11 audit — source-level guarantees', () => {
  const src = (p) => readFileSync(p, 'utf8');
  it('legacy writes are gone: guides, tools and actualités answer only GET; the dossier CSV neutralises formulas', () => {
    for (const f of ['api/_handlers/guides.js', 'api/_handlers/tools.js']) { expect(src(f)).not.toMatch(/jwt\.verify\(|db\.(insert|update|delete)\(/); expect(src(f)).toMatch(/method !== 'GET'\) return res\.status\(405\)/); }
    expect(src('api/_handlers/actualites.js')).not.toMatch(/handleAdmin(Create|Update|Delete)/);
    expect(src('api/_handlers/pro/dossier/export.js')).toMatch(/\/\^\[=\+\\-@\\t\\r\]\/\.test\(t\)/);
  });
  it('login: one answer for unknown, wrong and locked; download: restriction re-checked and a safe file name', () => {
    const login = src('api/_handlers/auth/login.js');
    expect(login).not.toMatch(/status\(423\)/); expect(login.match(/res\.status\(401\)\.json\(INVALID\)/g)).toHaveLength(4);   // pass 2 / R2-7: + the unverified account
    const dl = src('api/_handlers/download.js');
    expect(dl).toMatch(/isDossierRestricted\(binding\.shareId\)/); expect(dl).toMatch(/filename\*=UTF-8''/);
  });
  it('honest pages: contact and impact reports promise nothing unmeasured; the citizen notification tab has no local-only switches', () => {
    expect(src('src/pages/pro/ImpactReports.jsx')).not.toMatch(/E2EE|Citoyens accompagnés|% de couverture/);
    expect(src('src/pages/CompteParametres.jsx')).not.toMatch(/sauvegardées localement/);
    expect(src('src/pages/Security.jsx')).not.toMatch(/60 jours|30 jours après envoi|après 1 an|TLS 1\.3|new Date\(\)\.toLocaleDateString/);
  });
});
