/**
 * DTA S4A — record-level TECHNICAL findings on the WS2 launch data (scripts/ws2-findings.mjs).
 * Technical findings are not official verification: nothing here may flip launchReady, and the real-data counts are pinned as a ratchet so a silent change of the data files is noticed
 * (a lower count must be an intentional, human-validated data change; this test then gets updated with the new evidence).
 */
import { describe, expect, it } from 'vitest';
import { collectWs2Findings, findingsFrom, spRef } from '../../scripts/ws2-findings.mjs';

const SHA = 'a'.repeat(64);
const base = (o = {}) => ({ slug: 's', summary_falc: 'x', conditions_falc: 'x', pour_qui: 'x', ou_faire: 'x', etapes: 'x', nom: 'n', adresse: '1 rue A', code_postal: '67000', provenance: `Service-Public:F1;recordSha256=${SHA}`, verifiedCurrent: 'true', launchEligible: 'true', ...o });
const codes = (r) => r.findings.map((f) => `${f.dataset}/${f.slug}/${f.code}`).sort();

describe('rules (synthetic)', () => {
  it('a clean record yields no finding, but launchReady stays false while the manifest says false', () => {
    const r = findingsFrom({ datasets: { aides: [base()] }, snapshotById: { F1: { recordSha256: SHA } }, manifest: { launchReady: false } });
    expect(r.findings).toEqual([]); expect(r.launchReady).toBe(false);
    expect(findingsFrom({ datasets: { aides: [base()] }, snapshotById: { F1: { recordSha256: SHA } }, manifest: { launchReady: true } }).launchReady).toBe(true);
  });
  it('flags, empty required fields, empty provenance, unknown/mismatching source hash are BLOCKING', () => {
    const r = findingsFrom({
      datasets: { demarches: [base({ slug: 'a', verifiedCurrent: 'false', summary_falc: ' ' }), base({ slug: 'b', provenance: '' }), base({ slug: 'c', provenance: 'Service-Public:F9;recordSha256=' + SHA }), base({ slug: 'd', provenance: 'Service-Public:F1;recordSha256=' + 'b'.repeat(64) })] },
      snapshotById: { F1: { recordSha256: SHA } }, manifest: { launchReady: true } });
    expect(codes(r)).toEqual(expect.arrayContaining(['demarches/a/FLAG_NOT_VERIFIED_CURRENT', 'demarches/a/REQUIRED_FIELD_EMPTY', 'demarches/b/PROVENANCE_EMPTY', 'demarches/c/SOURCE_ABSENT_FROM_SNAPSHOT', 'demarches/d/SOURCE_HASH_MISMATCH']));
    expect(r.launchReady, 'any blocking finding keeps launchReady false even if the manifest claimed true').toBe(false);
  });
  it('a record without Service-Public source is REVIEW (not an invented failure, not accepted either)', () => {
    const r = findingsFrom({ datasets: { aides: [base({ slug: 'x', provenance: 'Autre source' })] }, snapshotById: {}, manifest: {} });
    expect(r.findings.map((f) => [f.code, f.severity])).toEqual([['NO_SERVICE_PUBLIC_SOURCE', 'REVIEW']]);
  });
  it('PKG-1 / N1: mobile numbers (06/07, +33 6/7, spaced or dotted) are PRIVACY_REVIEW hints; service lines (01-05, 08, 3-digit, 09) are not; the number is never reproduced', () => {
    const mk = (slug, telephone) => base({ slug, telephone, adresse: `adr ${slug}`, provenance: 'source=x' });
    const r = findingsFrom({ datasets: { structures: [mk('m1', '06 12 34 56 78'), mk('m2', '+33 7 12 34 56 78'), mk('m3', '07.12.34.56.78'), mk('f1', '03 88 12 34 56'), mk('f2', '115'), mk('f3', '0 800 123 456'), mk('f4', '09 12 34 56 78'), mk('f5', '')] }, manifest: {} });
    const hit = r.findings.filter((f) => f.code === 'PERSONAL_PHONE_REVIEW');
    expect(hit.map((f) => f.slug).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(hit.every((f) => f.severity === 'PRIVACY_REVIEW')).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/12 34|12\.34|\+33/);
  });
  it('structures: same address => POSSIBLE_DUPLICATE for each; nominative e-mail => PRIVACY_REVIEW with no address in the output; functional e-mails are not flagged', () => {
    const rows = [base({ slug: 'p', email: 'marie.dupont@caf.example', provenance: 'source=x' }), base({ slug: 'q', email: 'contact@caf.example', provenance: 'source=x' }), base({ slug: 's', adresse: 'autre', email: 'espace-jeunes@ml.example', provenance: 'source=x' }), base({ slug: 'r', adresse: 'ailleurs', provenance: 'source=x' })];
    const r = findingsFrom({ datasets: { structures: rows }, manifest: {} });
    expect(codes(r)).toEqual(expect.arrayContaining(['structures/p/POSSIBLE_DUPLICATE', 'structures/q/POSSIBLE_DUPLICATE', 'structures/p/NOMINATIVE_EMAIL']));
    expect(codes(r)).not.toContain('structures/q/NOMINATIVE_EMAIL'); expect(codes(r)).not.toContain('structures/s/NOMINATIVE_EMAIL'); expect(codes(r)).not.toContain('structures/r/POSSIBLE_DUPLICATE');
    expect(JSON.stringify(r)).not.toMatch(/marie|dupont|@/);
  });
  it('territory consistency (S6): a national statutory regime narrowed to a locality, or a "Grand Est" list with outside départements, is REVIEW; consistent records are not flagged; nothing is rewritten', () => {
    const rows = [base({ slug: 'apl', territoires: 'Strasbourg', departements: '67' }), base({ slug: 'rsa', territoires: 'France entière', departements: '' }),
      base({ slug: 'g1', territoires: 'Grand Est', departements: '67|68|33' }), base({ slug: 'g2', territoires: 'Grand Est', departements: '67|68|57' }), base({ slug: 'local', territoires: 'Strasbourg', departements: '67' })];
    const r = findingsFrom({ datasets: { aides: rows }, snapshotById: { F1: { recordSha256: SHA } }, manifest: {} });
    expect(codes(r).filter((c) => /TERRITORY/.test(c))).toEqual(['aides/apl/TERRITORY_NATIONAL_REGIME_NARROWED', 'aides/g1/TERRITORY_DEPARTMENTS_OUTSIDE_SCOPE']);
    expect(r.findings.filter((f) => /TERRITORY/.test(f.code)).every((f) => f.severity === 'REVIEW')).toBe(true);
  });
  it('spRef reads both provenance spellings', () => {
    expect(spRef(`Service-Public:F10009;archiveMember=F10009.xml;recordSha256=${SHA}`)).toEqual({ id: 'F10009', sha: SHA });
    expect(spRef(`Service-Public:F10027[archiveMember=F10027.xml,recordSha256=${SHA}`)).toEqual({ id: 'F10027', sha: SHA });
    expect(spRef('')).toEqual({ id: null, sha: null });
  });
});

describe('the real LAB data (ratchet; technical findings only)', () => {
  it('stays fail-closed and the counts match the closure matrix', async () => {
    const r = await collectWs2Findings();
    expect(r.launchReady).toBe(false);
    expect(r.summary.bySeverity).toEqual({ BLOCKING: 19, REVIEW: 19, PRIVACY_REVIEW: 0 });   // S6: +2 territory-consistency findings (apl, carte-solidaire-grand-est). R33: 0 privacy findings — the public export removed the 2 nominative e-mails and the mobile number (CAF 67, Mission locale), and the last hit was a service mailbox (« espace-… »), no longer flagged
    const by = (code) => r.findings.filter((f) => f.code === code);
    expect(by('TERRITORY_NATIONAL_REGIME_NARROWED').map((f) => f.slug)).toEqual(['apl']);
    expect(by('TERRITORY_DEPARTMENTS_OUTSIDE_SCOPE').map((f) => f.slug)).toEqual(['carte-solidaire-grand-est']);
    expect(by('FLAG_NOT_VERIFIED_CURRENT').map((f) => f.dataset).sort()).toEqual(['demarches', 'demarches', 'structures', 'structures', 'structures', 'structures', 'structures']);
    expect(by('REQUIRED_FIELD_EMPTY').map((f) => `${f.slug}:${f.detail}`).sort()).toEqual(expect.arrayContaining(['rdv-social-alsace:summary_falc', 'rdv-social-alsace:pour_qui', 'rdv-social-alsace:etapes']));
    expect(by('SOURCE_ABSENT_FROM_SNAPSHOT')).toEqual([]); expect(by('SOURCE_HASH_MISMATCH')).toEqual([]);
    expect(by('NO_SERVICE_PUBLIC_SOURCE').map((f) => f.slug).sort()).toEqual(['carte-fluo-alsace', 'carte-solidaire-grand-est', 'faj-strasbourg', 'inscription-ccas', 'rdv-social-alsace']);
    expect(by('POSSIBLE_DUPLICATE')).toHaveLength(12); expect(by('NOMINATIVE_EMAIL')).toEqual([]);
    expect(by('PERSONAL_PHONE_REVIEW')).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/@/);
  });
});
