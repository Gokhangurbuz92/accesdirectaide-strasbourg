/**
 * PKG-11 / P16 — the /orientation wizard builds its diagnostic request with the /diagnostic contract (src/lib/wizardDiagnostic.js):
 * explicit SIMULATION_MODE, blank amounts are « not answered » (never 0), an exact date wins over an age band, rent only for tenants,
 * territory only as a readable postal code, and nothing free-text (need, urgency) is kept with a shared dossier. The browser journey is DTA-B53.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answered, buildWizardDiagnostic, defaultHousehold, isTenant } from '../../src/lib/wizardDiagnostic.js';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';

describe('PKG-11 / P16 wizard diagnostic request', () => {
  it('blank amounts are not answered; an explicit 0 is a known zero; non-numbers are dropped', () => {
    expect(answered('salary', '')).toEqual({});
    expect(answered('salary', '   ')).toEqual({});
    expect(answered('salary', undefined)).toEqual({});
    expect(answered('salary', 'abc')).toEqual({});
    expect(answered('salary', '0')).toEqual({ salary: 0 });
    expect(answered('salary', '812.5')).toEqual({ salary: 812.5 });
  });

  it('a blank form sends SIMULATION_MODE with no invented facts and the assessment reports them as missing', () => {
    const { body, situation } = buildWizardDiagnostic({ need: 'logement', urgency: 'haute', territory: 'Strasbourg' });
    expect(body.mode).toBe('SIMULATION_MODE');
    expect(body.answers.territory).toBe('');                 // a city name is not a readable postal code
    expect(body.answers.income).toEqual({});
    expect(body.answers).not.toHaveProperty('householdSize');
    expect(body.answers).not.toHaveProperty('birthDate');
    expect(body.answers).not.toHaveProperty('ageBand');
    expect(JSON.stringify(body)).not.toMatch(/logement|haute/);  // free fields are not answers
    expect(Object.keys(situation).sort()).toEqual(['ageBand', 'birthDate', 'householdSize', 'housingStatus', 'zipCode']);
    const a = buildAssessment({ answers: body.answers, unsupportedRights: UNSUPPORTED_RIGHTS });
    for (const it of a.items) { expect(it.authoritative).toBe(false); expect(it.state).not.toMatch(/ELIGIBLE/); }
  });

  it('an exact date wins over an age band; the band alone is kept otherwise', () => {
    expect(buildWizardDiagnostic({ birthDate: '1990-05-01', ageBand: '25-59' }).body.answers).toMatchObject({ birthDate: '1990-05-01' });
    expect(buildWizardDiagnostic({ birthDate: '1990-05-01', ageBand: '25-59' }).body.answers).not.toHaveProperty('ageBand');
    expect(buildWizardDiagnostic({ birthDate: '1990-05-01', ageBand: '25-59' }).situation.ageBand).toBe('');
    expect(buildWizardDiagnostic({ ageBand: '18-24' }).body.answers).toMatchObject({ ageBand: '18-24' });
  });

  it('rent only for tenants; household from the profile only when it is not a guess', () => {
    expect(isTenant('tenant')).toBe(true); expect(isTenant('tenant_hlm')).toBe(true); expect(isTenant('owner')).toBe(false);
    expect(buildWizardDiagnostic({ housingStatus: 'tenant', rent: '450', territory: '67000' }).body.answers.housing).toEqual({ rent: 450, status: 'tenant' });
    expect(buildWizardDiagnostic({ housingStatus: 'tenant', rent: '' }).body.answers.housing).toEqual({ status: 'tenant' });
    expect(buildWizardDiagnostic({ housingStatus: 'owner', rent: '450' }).body.answers.housing).toEqual({ rent: 0, status: 'owner' });
    expect(buildWizardDiagnostic({ territory: ' 67000 ' }).body.answers.territory).toBe('67000');
    expect(defaultHousehold('seul')).toBe('1'); expect(defaultHousehold('couple')).toBe('2'); expect(defaultHousehold('famille')).toBe('');
  });

  it('the wizard no longer reads the legacy rights list and posts with the CSRF helper', () => {
    const src = fs.readFileSync('src/components/assistant/Wizard.jsx', 'utf8');
    expect(src).toMatch(/csrfFetch/);
    expect(src).toMatch(/buildWizardDiagnostic/);
    expect(src).not.toMatch(/DiagnosticResults/);
  });
});
