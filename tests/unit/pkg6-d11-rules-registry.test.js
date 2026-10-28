/**
 * PKG-6 / D11 — the research register of official rules per right (data/rules/rights-rules.v1.json). It guards what the register may claim:
 * every condition cites an official page (with the page's own « Vérifié le » date when shown, and the consultation date); nothing is EXPERT_VALIDATED without a named
 * reviewer, a date and passing reference cases; while no right is validated, the assessment keeps saying that no validated rule backs a result (D20).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildAssessment } from '../../api/lib/assessmentContract.js';

const reg = JSON.parse(fs.readFileSync('data/rules/rights-rules.v1.json', 'utf8'));
const OFFICIAL = /^https:\/\/(www\.)?(service-public\.gouv\.fr|legifrance\.gouv\.fr|caf\.fr|francetravail\.fr|unedic\.org|ameli\.fr|solidarites\.gouv\.fr|alsace\.eu|strasbourg\.eu|bas-rhin\.gouv\.fr)\//;

describe('PKG-6 / D11 rules register', () => {
  it('covers the rights named by D11 and declares itself unvalidated research', () => {
    expect(reg.schema).toBe('ada.rights-rules.v1');
    expect(reg.rights.map((r) => r.id).sort()).toEqual(['aah', 'apa', 'apl', 'are', 'c2s', 'faj-strasbourg', 'prime-activite', 'rsa']);
    expect(reg.statement).toMatch(/NOTHING here is validated/);
  });
  it('every right cites official pages (https, official domain, consultation date); every condition points to one of them', () => {
    for (const r of reg.rights) {
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      for (const s of r.sources) { expect(s.url, r.id).toMatch(OFFICIAL); expect(s.consultedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); if (s.pageVerifiedOn !== null) expect(s.pageVerifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/); }
      expect(r.conditions.length, r.id).toBeGreaterThan(0);
      for (const c of r.conditions) {
        expect(typeof c.text === 'string' && c.text.length > 5, `${r.id}.${c.fact}`).toBe(true);
        expect(r.sources.some((s) => s.url.includes(c.source) || (c.source === 'strasbourg.eu' && s.url.includes('strasbourg.eu'))), `${r.id}.${c.fact} source ${c.source}`).toBe(true);
      }
    }
  });
  it('no right is EXPERT_VALIDATED without a named reviewer, a date and passing reference cases (none is today)', () => {
    for (const r of reg.rights) {
      expect(reg.statuses).toContain(r.status);
      if (r.status === 'EXPERT_VALIDATED') {
        expect(r.expertReview?.name && r.expertReview?.date && r.expertReview?.role, r.id).toBeTruthy();
        expect(r.referenceCases.length, r.id).toBeGreaterThan(0);
      } else {
        expect(r.expertReview, r.id).toBeNull();
      }
    }
    expect(reg.rights.filter((r) => r.status === 'EXPERT_VALIDATED')).toEqual([]);
  });
  it('while nothing is validated, the assessment never presents a rule or an official source as applied (D20 stays honest)', () => {
    const a = buildAssessment({ answers: { birthDate: '1990-01-01', householdSize: 1, income: { salary: 800 }, housing: { status: 'locataire', rent: 400 }, territory: '67000' } });
    for (const it of a.items) { expect(it.authoritative).toBe(false); expect(it.whyFr).toMatch(/source officielle/); }
  });
});
