// R47 — the activation-readiness simulator (scripts/activation-simulator.mjs): derived from the code, every environment prerequisite necessary, the set
// sufficient, the rollback closing again, nothing secret in the report. Offline, synthetic values only.
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, hdsAttestation } from '../../api/_utils/capabilities.js';
import { NOT_OPENABLE, SCHEDULED_JOBS, SURFACES } from '../../api/_utils/public-beta.js';
import { personalSurfacesOpened } from '../../src/lib/publicBeta.js';
import { buildItems, finalConfig, simulate, syntheticHdsToken, toMarkdown, without, evaluate, SYNTHETIC } from '../../scripts/activation-simulator.mjs';

const env = finalConfig({ profile: 'production' });
const rep = simulate({ env });
const ids = new Set(rep.results.map((r) => r.id));

describe('R47 activation simulator — derivation', () => {
  it('has one item per openable surface, per capability and per scheduled job of the code', () => {
    for (const s of Object.keys(SURFACES).filter((x) => !NOT_OPENABLE.includes(x))) expect(ids.has(`surface.${s}`)).toBe(true);
    for (const c of Object.keys(CAPABILITIES)) expect(ids.has(`capability.${c}`)).toBe(true);
    for (const j of Object.keys(SCHEDULED_JOBS)) expect(ids.has(`job.${j}`)).toBe(true);
    for (const p of ['mail', 'sms', 'sms_stop', 'push', 'outlook', 'video', 'franceconnect', 'proconnect', 'openfisca', 'aides-territoires', 'sentry', 'alert']) expect(ids.has(`provider.${p}`)).toBe(true);
  });
  it('an out-of-AIPD capability needs ADA_CAPABILITIES_OPEN, an HDS one the attestation token', () => {
    for (const r of rep.results.filter((x) => x.kind === 'capability' && x.expected === 'open')) {
      const cap = CAPABILITIES[r.id.slice('capability.'.length)];
      expect(r.env.some((v) => v.name === 'ADA_CAPABILITIES_OPEN')).toBe(cap.aipd === 'out');
      expect(r.env.some((v) => v.name === 'ADA_HDS_CERTIFIED_HOSTING')).toBe(cap.requiresHds);
    }
  });
});

describe('R47 activation simulator — proof as Production evaluates it', () => {
  it('the final synthetic configuration opens every item except those closed by design, and each prerequisite removed closes it with a stable code', () => {
    expect(rep.summary.passed).toBe(rep.summary.items);
    expect(rep.summary.removalsChecked).toBeGreaterThan(150);
    for (const r of rep.results) for (const x of r.removals) { expect(x.closed).toBe(true); expect(typeof x.code).toBe('string'); }
  });
  it('closed by design stays closed in the final configuration: jobs surface, minors, unreviewed service, gdpr-purge (policy in code), legacy jobs', () => {
    expect(rep.summary.closedByDesign).toEqual(expect.arrayContaining(['surface.jobs', 'capability.citizen.minor_accounts', 'booking.unreviewed_service', 'job.gdpr-purge', 'job.ingest-demarches']));
    expect(rep.results.find((r) => r.id === 'job.gdpr-purge').final.code).toBe('STEP_NOT_APPROVED_IN_POLICY');   // policy approved (phase 1), no step record yet
    expect(rep.results.find((r) => r.id === 'booking.unreviewed_service').final.code).toBe('SERVICE_SENSITIVITY_UNREVIEWED');
  });
  it('gdpr-purge: with an approved policy record the three variables are each necessary', () => {
    expect(rep.gdprPurgeWithApprovedPolicyRecord.execute).toBe(true);
    expect(rep.gdprPurgeWithApprovedPolicyRecord.minusOne.map((m) => m.reason)).toEqual(['GDPR_PURGE_DISABLED', 'POLICY_VERSION_NOT_PINNED', 'NO_APPROVED_STEPS']);
  });
  it('rollback: removing the switch of a surface closes the surface and every capability on it', () => {
    const items = buildItems(); const byId = new Map(items.map((i) => [i.id, i]));
    const e = without(env, { name: 'ADA_BETA_OPEN_SURFACES', token: 'documents' });
    expect(evaluate(byId.get('surface.documents'), e, byId)).toMatchObject({ open: false, code: 'PUBLIC_BETA_RESTRICTED' });
    expect(evaluate(byId.get('capability.citizen.vault'), e, byId)).toMatchObject({ open: false, code: 'SURFACE_CLOSED' });
    expect(evaluate(byId.get('booking.sensitive'), without(env, { name: 'ADA_HDS_BOOKING_ASSESSED' }), byId)).toMatchObject({ open: false, code: 'SENSITIVE_BOOKING_NOT_OPEN' });
    expect(evaluate(byId.get('protected_store'), without(env, { name: 'ADA_HDS_CERTIFIED_HOSTING' }), byId)).toMatchObject({ open: false, code: 'HDS_ATTESTATION_ABSENT' });
  });
  it('the synthetic HDS token has the required format and says so; an expired one opens nothing', () => {
    expect(syntheticHdsToken()).toContain(SYNTHETIC);
    expect(hdsAttestation({ ADA_HDS_CERTIFIED_HOSTING: syntheticHdsToken() }).valid).toBe(true);
    expect(hdsAttestation({ ADA_HDS_CERTIFIED_HOSTING: syntheticHdsToken().replace('2099-12-31', '2020-01-01') }).reason).toBe('HDS_ATTESTATION_EXPIRED');
  });
});

describe('R47 activation simulator — the 38 « ready, nothing pending » rows of R46', () => {
  it('names the surface-wide gate that still closes the administration rows, Mon Espace and the veille rows in Production', () => {
    const a = new Map(rep.surfaceWideAudit.map((x) => [x.id, x]));
    for (const id of ['A01', 'A03', 'A15', 'A16', 'D01', 'M04', 'X11']) expect(a.get(id).gates.join(' ')).toMatch(/surface « admin »/);
    expect(a.get('C13').gates.join(' ')).toMatch(/surface « accounts »/);
    for (const id of ['D04', 'D07', 'D14']) expect(a.get(id).gates.join(' ')).toMatch(/tâche veille fermée/);
    expect(a.get('P16').gates.join(' ')).toMatch(/assistant\/recommendations/);
    for (const id of ['P02', 'P04', 'P08', 'P22', 'P24', 'D02', 'X10']) expect(a.get(id).closedInProduction).toBe(false);
  });
});

describe('R47 activation simulator — report hygiene', () => {
  it('the JSON and the French table carry names and switch tokens, never a value of the configuration', () => {
    const text = JSON.stringify(rep) + toMarkdown(rep);
    for (const k of ['JWT_SECRET', 'AUTH_SECRET', 'ADA_ENCRYPTION_KEY', 'MAILER_API_KEY', 'TWILIO_AUTH_TOKEN', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'VIDEO_JITSI_SECRET', 'ADA_PROTECTED_STORE_TOKEN', 'CRON_SECRET'])
      expect(text.includes(env[k])).toBe(false);
    expect(toMarkdown(rep)).toMatch(/^# R47 — Prérequis d’activation/);
  });
});

describe('R47 beta banner (defect fix)', () => {
  it('says « not open yet » only while the build opens none of accounts, appointments, documents', () => {
    expect(personalSurfacesOpened([])).toBe(false);
    expect(personalSurfacesOpened(['pro', 'admin', 'diagnostic'])).toBe(false);
    for (const s of ['accounts', 'appointments', 'documents']) expect(personalSurfacesOpened([s])).toBe(true);
  });
});
