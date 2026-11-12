/**
 * Registre des doublons — evidence assistance (api/_services/duplicate-evidence.js) on copies of REAL proposed pairs (tests/fixtures/duplicate-pairs-lab.json)
 * and on the owner's rules: same address ≠ same establishment; mairie / CCAS / France services are distinct functions; a dental and a medical centre are
 * never merged on their address; different FINESS numbers → separately registered establishments; same name + address → a candidate duplicate only with a
 * stable identifier; conflicting data → a data-quality issue; insufficient evidence → no suggestion. Never an invented URL; a score is never a decision.
 */
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/duplicate-pairs-lab.json';
import { assessPair, functionOf, identityOf } from '../../api/_services/duplicate-evidence.js';

const P = fixture.pairs;
const env = {};
const clone = (r, patch = {}) => ({ ...JSON.parse(JSON.stringify(r)), ...patch });
const codes = (list) => list.map((x) => x.code);
const urlsOf = (r) => [...(r.auto_check?.sources || []).map((s) => s.url), r.source_url].filter(Boolean);

describe('evidence assistance on copies of the real pairs', () => {
  it('FAM PHV le Castel / Fas-FAM le Castel: two FINESS establishments → distinct, high, with both FINESS pages', () => {
    const r = assessPair(P.castel.A, P.castel.B, { env });
    expect([r.suggestion, r.confidence, r.basis, r.wellDocumented]).toEqual(['DISTINCT', 'high', 'FINESS_DIFFERENT', true]);
    expect(r.note).toMatch(/670015072/); expect(r.note).toMatch(/670017722/);
    expect(r.evidenceUrl).toMatch(/^https:\/\/finess\.esante\.gouv\.fr\//);
    expect(codes(r.warnings)).toContain('SAME_ADDRESS_NOT_PROOF');
  });
  it('Mairie / CCAS at the same address: two Annuaire offices → distinct functions', () => {
    const r = assessPair(P.mairie_ccas.A, P.mairie_ccas.B, { env });
    expect([r.suggestion, r.basis]).toEqual(['DISTINCT', 'ANNUAIRE_DIFFERENT']);
    expect(codes(r.reasons)).toContain('FUNCTIONS_DIFFER');
    expect(r.evidenceUrl).toMatch(/^https:\/\/lannuaire\.service-public\.gouv\.fr\//);
  });
  it('Mairie / France services: distinct', () => {
    const r = assessPair(P.mairie_france_services.A, P.mairie_france_services.B, { env });
    expect(r.suggestion).toBe('DISTINCT');
    expect(r.reasons.find((x) => x.code === 'FUNCTIONS_DIFFER')?.params).toEqual({ a: 'mairie', b: 'france_services' });
  });
  it('dental / medical centres at one address are not merged (different FINESS, and the dental/medical rule)', () => {
    const r = assessPair(P.dental_medical.A, P.dental_medical.B, { env });
    expect(r.suggestion).toBe('DISTINCT');
    expect(codes(r.reasons)).toEqual(expect.arrayContaining(['FINESS_DIFFERENT', 'DENTAL_VS_MEDICAL']));
    // even without any identifier, the dental/medical pair is never suggested as the same establishment
    const bare = (x) => clone(x, { numero_finess: null, siret: null, source_annuaire: null });
    expect(assessPair(bare(P.dental_medical.A), bare(P.dental_medical.B), { env }).suggestion).not.toBe('SAME_ENTITY');
  });
  it('identically named CCAS with two Annuaire entries: distinct suggested, but only medium (same name, name/type mismatch) — never preselected', () => {
    const r = assessPair(P.same_name_ccas.A, P.same_name_ccas.B, { env });
    expect([r.suggestion, r.confidence, r.wellDocumented]).toEqual(['DISTINCT', 'medium', false]);
    expect(codes(r.warnings)).toEqual(expect.arrayContaining(['SAME_NAME', 'NAME_TYPE_MISMATCH']));
  });
  it('false positive (two town halls sharing an address): distinct', () => {
    const r = assessPair(P.false_positive.A, P.false_positive.B, { env });
    expect([r.suggestion, r.basis]).toEqual(['DISTINCT', 'ANNUAIRE_DIFFERENT']);
  });
  it('missing evidence (one Annuaire office, one SIRENE record, nothing tells them apart or together): no suggestion', () => {
    const r = assessPair(P.missing_evidence.A, P.missing_evidence.B, { env });
    expect([r.suggestion, r.confidence, r.basis, r.evidenceUrl, r.note]).toEqual([null, null, 'INSUFFICIENT', null, null]);
  });
  it('a true duplicate (a copy of a real FINESS record, same number, same address): same establishment, high, the most complete record kept', () => {
    const real = P.camsp.A.numero_finess === '670797158' ? P.camsp.A : P.camsp.B;
    const copy = clone(real, { id: 'zzz-copy', nom: `${real.nom} (doublon)`, telephone: null });
    const r = assessPair(real, copy, { env });
    expect([r.suggestion, r.confidence, r.basis, r.primaryId]).toEqual(['SAME_ENTITY', 'high', 'FINESS_SAME', real.id]);
    expect(r.evidenceUrl).toMatch(/^https:\/\/finess\.esante\.gouv\.fr\//);
  });
  it('conflicting data (same FINESS number, different address): a data-quality issue, not a duplicate', () => {
    const real = P.camsp.A;
    const r = assessPair(real, clone(real, { id: 'zzz-conflict', adresse: '1 rue Ailleurs', code_postal: '67000' }), { env });
    expect([r.suggestion, r.basis]).toEqual([null, 'DATA_CONFLICT']);
    expect(codes(r.warnings)).toContain('DATA_CONFLICT');
  });
});

describe('rules', () => {
  const base = { id: 'a', nom: 'Accueil X', type_structure: 'Association', adresse: '1 rue Une', code_postal: '67000', ville: 'Strasbourg' };
  it('same name and address without any identifier: no suggestion (a candidate duplicate needs a stable identifier)', () => {
    const r = assessPair(base, { ...base, id: 'b' }, { env });
    expect(r.suggestion).toBeNull(); expect(codes(r.warnings)).toEqual(expect.arrayContaining(['SAME_ADDRESS_NOT_PROOF', 'SAME_NAME']));
  });
  it('never invents a URL: a non-official or http source is not offered; no URL → no suggestion even on a stable identifier', () => {
    const a = { ...base, numero_finess: '670000001', auto_check: { sources: [{ kind: 'FINESS', url: 'http://finess.esante.gouv.fr/x' }, { kind: 'X', url: 'https://example.com/x' }] } };
    const b = { ...base, id: 'b', numero_finess: '670000001', source_url: 'https://evil.example/?gouv.fr' };
    expect(identityOf(a, env).sources).toEqual([]);
    const r = assessPair(a, b, { env });
    expect([r.suggestion, r.evidenceUrl, r.evidence]).toEqual([null, null, []]);
  });
  it('every URL offered is one a record carries', () => {
    for (const p of Object.values(P)) {
      const r = assessPair(p.A, p.B, { env });
      const carried = [...urlsOf(p.A), ...urlsOf(p.B)];
      for (const u of [r.evidenceUrl, ...r.evidence.map((e) => e.url)].filter(Boolean)) expect(carried).toContain(u);
    }
  });
  it('same SIRET with two different FINESS numbers: one manager, two establishments → distinct', () => {
    const a = { ...base, siret: '26670067300053', numero_finess: '670014034', auto_check: { sources: [{ kind: 'FINESS', url: 'https://finess.esante.gouv.fr/a' }] } };
    const b = { ...a, id: 'b', numero_finess: '670013093', auto_check: { sources: [{ kind: 'FINESS', url: 'https://finess.esante.gouv.fr/b' }] } };
    const r = assessPair(a, b, { env });
    expect(r.suggestion).toBe('DISTINCT'); expect(codes(r.reasons)).toContain('SAME_SIRET'); expect(r.note).toMatch(/gestionnaire/);
  });
  it('a held record lowers the confidence (never preselected)', () => {
    const real = P.camsp.A;
    const r = assessPair(real, clone(real, { id: 'zzz-held', publication_hold: 'Signalement' }), { env });
    expect([r.suggestion, r.confidence, r.wellDocumented]).toEqual(['SAME_ENTITY', 'medium', false]);
  });
  it('functions: the most specific first', () => {
    expect(functionOf('Point-justice en France services de Haguenau')).toBe('point_justice');
    expect(functionOf("Centre communal d'action sociale (CCAS) - Lobsann")).toBe('ccas');
    expect(functionOf('Mairie - Gries')).toBe('mairie');
    expect(functionOf('Centre de Sante Dentaire de Saverne')).toBe('dentaire');
  });
});
