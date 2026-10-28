// PKG-1 / D-5 — decision matrix of the central fail-closed publication contract (api/lib/publicVisibility.js). JS rule only; the SQL twins are cross-checked on a real PostgreSQL (tests/integration).
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Aide, Structure } from '../../src/db/schema';
import { contentMode, decide, maxAgeDays, publicContentStatus, stripReviewFields, visibleSql, visibleWhere } from '../../api/lib/publicVisibility.js';

const NOW = new Date('2026-10-18T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
const good = () => ({ statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'admin-1', territory_verified: true, publication_hold: null, data_origin: 'official', date_verification: daysAgo(10), source_url: 'https://www.service-public.fr/x', source_url_exact: null });
const d = (r, kind = 'aide', mode = 'strict') => decide(r, kind, { now: NOW, mode, maxAge: 180 });

describe('D-5 strict rule', () => {
  it('a fully verified, current, eligible, held-free record is public and labelled VERIFIED', () => {
    expect(d(good())).toMatchObject({ visible: true, contentStatus: 'VERIFIED', freshness: 'current' });
  });
  it.each([
    ['statut draft', { statut: 'brouillon' }, 'NOT_PUBLISHED'],
    ['publie alone is not enough (defaults)', { launch_eligible: false, verification_status: 'UNVERIFIED', verified_by: null, territory_verified: false, data_origin: 'unclassified' }, 'NOT_LAUNCH_ELIGIBLE'],
    ['not launch eligible', { launch_eligible: false }, 'NOT_LAUNCH_ELIGIBLE'],
    ['verification rejected', { verification_status: 'REJECTED' }, 'NOT_VERIFIED'],
    ['verified without a verifier', { verified_by: null }, 'NOT_VERIFIED'],
    ['territory not verified', { territory_verified: false }, 'TERRITORY_NOT_VERIFIED'],
    ['privacy/safety hold', { publication_hold: 'PRIVACY_REVIEW' }, 'PUBLICATION_HOLD'],
    ['no provenance', { source_url: '  ', source_url_exact: null }, 'NO_PROVENANCE'],
    ['no verification date (never synthesised)', { date_verification: null }, 'NO_VERIFICATION_DATE'],
    ['verification in the future', { date_verification: daysAgo(-5) }, 'VERIFICATION_IN_FUTURE'],
    ['stale verification (> 180 d)', { date_verification: daysAgo(181) }, 'VERIFICATION_STALE'],
    ['lab origin in strict mode', { data_origin: 'synthetic_fixture' }, 'LAB_ORIGIN_NOT_PUBLIC_IN_STRICT_MODE'],
  ])('hidden: %s', (_n, patch, reason) => {
    const r = d({ ...good(), ...patch });
    expect(r.visible).toBe(false);
    expect(r.contentStatus).toBe('HIDDEN');
    expect(r.reasons).toContain(reason);
  });
  it('freshness: 0-90 d is current, 91-180 d needs an update, the bounds are inclusive', () => {
    expect(d({ ...good(), date_verification: daysAgo(90) }).freshness).toBe('current');
    expect(d({ ...good(), date_verification: daysAgo(91) }).freshness).toBe('update_needed');
    expect(d({ ...good(), date_verification: daysAgo(180) })).toMatchObject({ visible: true, freshness: 'update_needed' });
  });
  it('source_url_exact alone satisfies provenance', () => {
    expect(d({ ...good(), source_url: null, source_url_exact: 'https://www.caf.fr/a' }).visible).toBe(true);
  });
  it('structures accept actif and publie, aides only publie', () => {
    expect(d({ ...good(), statut: 'actif' }, 'structure').visible).toBe(true);
    expect(d({ ...good(), statut: 'actif' }, 'aide').visible).toBe(false);
  });
  it('an explicitly ARCHIVED aide is hidden even when statut is publie and even in lab mode; other kinds are not affected', () => {
    expect(d({ ...good(), status_code: 'ARCHIVED' }).reasons).toContain('ARCHIVED');
    expect(d({ statut: 'publie', data_origin: 'unclassified', status_code: 'ARCHIVED' }, 'aide', 'lab').visible).toBe(false);
    expect(d({ statut: 'publie', data_origin: 'unclassified', status_code: 'PUBLISHED' }, 'aide', 'lab').visible).toBe(true);
    expect(d({ ...good(), status_code: 'ARCHIVED' }, 'demarche').visible).toBe(true);
  });
  it('a missing record is hidden', () => {
    expect(d(null).reasons).toEqual(['NOT_FOUND']);
  });
});

describe('lab mode', () => {
  const fixture = { statut: 'publie', data_origin: 'unclassified' };
  it('shows unverified lab fixtures only when labelled LAB_UNVERIFIED, never as verified', () => {
    expect(d(fixture, 'aide', 'lab')).toMatchObject({ visible: true, contentStatus: 'LAB_UNVERIFIED', freshness: null });
    expect(publicContentStatus(fixture, 'aide').verified).toBe(false);
  });
  it('an unpublished lab fixture stays hidden', () => {
    expect(d({ ...fixture, statut: 'brouillon' }, 'aide', 'lab').visible).toBe(false);
  });
  it('rows of an official origin obey the strict rules even in lab mode', () => {
    expect(d({ statut: 'publie', data_origin: 'official' }, 'aide', 'lab').visible).toBe(false);
  });
  it('lab mode is never honoured in production', () => {
    expect(contentMode({ ADA_PUBLIC_CONTENT_MODE: 'lab', NODE_ENV: 'production' })).toBe('strict');
    expect(contentMode({ ADA_PUBLIC_CONTENT_MODE: 'lab', VERCEL_ENV: 'production' })).toBe('strict');
    expect(contentMode({ ADA_PUBLIC_CONTENT_MODE: 'lab', NODE_ENV: 'test' })).toBe('lab');
    expect(contentMode({})).toBe('strict');
    expect(contentMode({ ADA_PUBLIC_CONTENT_MODE: 'LAB-ish' })).toBe('strict');
  });
});

describe('public payloads never carry review data', () => {
  it('verified_by and publication_hold are removed for the public and kept for admin reviewers', () => {
    const row = { id: 1, titre: 'x', verified_by: 'reviewer@example.test', publication_hold: 'PRIVACY_REVIEW: phone', date_verification: '2026-10-01' };
    const pub = stripReviewFields(row);
    expect(Object.keys(pub)).toEqual(['id', 'titre', 'date_verification']);
    expect(JSON.stringify(pub)).not.toMatch(/reviewer@|PRIVACY_REVIEW/);
    expect(stripReviewFields(row, true)).toBe(row);
    expect(stripReviewFields(null)).toBeNull();
  });
});

describe('configuration', () => {
  it('maxAgeDays falls back to 180 on anything but a sane integer', () => {
    expect(maxAgeDays({})).toBe(180);
    expect(maxAgeDays({ ADA_VERIFICATION_MAX_AGE_DAYS: '-1' })).toBe(180);
    expect(maxAgeDays({ ADA_VERIFICATION_MAX_AGE_DAYS: 'abc' })).toBe(180);
    expect(maxAgeDays({ ADA_VERIFICATION_MAX_AGE_DAYS: '120' })).toBe(120);
  });
});

describe('SQL expressions are well formed and carry every condition', () => {
  const dialect = new PgDialect();
  const text = (q) => dialect.sqlToQuery(q).sql;
  const must = ['launch_eligible', 'verification_status', 'verified_by', 'territory_verified', 'publication_hold', 'data_origin', 'date_verification', 'source_url'];
  it('visibleWhere (drizzle) references every verification column', () => {
    const t = text(visibleWhere(Aide, 'aide', { now: NOW, mode: 'strict' }));
    for (const c of must) expect(t, c).toContain(c);
    expect(t).not.toMatch(/synthetic_fixture'/);
  });
  it('visibleSql (raw) references every verification column and honours the alias', () => {
    const t = text(visibleSql('structure', { alias: 'st', mode: 'strict' }));
    for (const c of must) expect(t, c).toContain(`"st"."${c}"`);
  });
  it('both SQL forms exclude archived aides in strict AND lab mode, and only for aides', () => {
    for (const mode of ['strict', 'lab']) {
      expect(text(visibleSql('aide', { mode }))).toMatch(/"status_code" <> 'ARCHIVED'/);
      expect(text(visibleSql('structure', { mode }))).not.toMatch(/ARCHIVED/);
      expect(text(visibleWhere(Aide, 'aide', { mode }))).toMatch(/"status_code" <> \$\d+/);
    }
  });
  it('strict SQL has no lab escape hatch, lab SQL does', () => {
    expect(text(visibleSql('aide', { mode: 'strict' }))).not.toMatch(/data_origin" IN/);
    expect(text(visibleSql('aide', { mode: 'lab' }))).toMatch(/data_origin" IN/);
    expect(text(visibleWhere(Structure, 'structure', { mode: 'lab' }))).toMatch(/"data_origin" in/i);
  });
  it('the alias is sanitised', () => {
    expect(text(visibleSql('aide', { alias: 'a"; DROP TABLE x;--', mode: 'strict' }))).not.toContain('DROP TABLE');
  });
});
