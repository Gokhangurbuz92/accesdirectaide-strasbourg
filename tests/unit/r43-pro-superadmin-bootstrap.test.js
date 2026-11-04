/**
 * R43 (E3) — scripts/pro-superadmin-bootstrap.mjs: the decisions taken BEFORE any write (pure functions). The database path, the one-time rule, the audit
 * line and the redemption through the application's mechanism are in tests/integration/r43-pro-superadmin-bootstrap-db.test.js.
 */
import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { databaseName, deliverInvitation, invitationLink, linkOrigin, planDelivery, planTarget, validateIdentity, validatePassword, INVITATION_TTL_MS } from '../../scripts/pro-superadmin-bootstrap.mjs';

const REMOTE = 'postgresql://owner:PLANTED-DB-PASSWORD@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const LAB = 'postgresql://ada_test@127.0.0.1:55434/ada_r43_surf_test';

describe('pro SUPERADMIN bootstrap (decisions, no database)', () => {
  it('the host AND the database name are confirmed again and must match', () => {
    expect(databaseName(REMOTE)).toBe('neondb');
    expect(planTarget({ url: LAB })).toMatchObject({ ok: false, reason: expect.stringContaining('--confirm-database ada_r43_surf_test') });
    expect(planTarget({ url: LAB, confirmHost: 'localhost', confirmDatabase: 'ada_r43_surf_test' })).toMatchObject({ ok: false, reason: expect.stringContaining('hôte') });
    expect(planTarget({ url: LAB, confirmHost: '127.0.0.1', confirmDatabase: 'ada_r43_surf' })).toMatchObject({ ok: false, reason: expect.stringContaining('nom de base') });
    expect(planTarget({ url: LAB, confirmHost: '127.0.0.1', confirmDatabase: 'ada_r43_surf_test' })).toEqual({ ok: true, host: '127.0.0.1', name: 'ada_r43_surf_test', local: true, lab: true });
    expect(planTarget({ url: '', confirmHost: 'x', confirmDatabase: 'y' }).ok).toBe(false);
  });
  it('a database that is not a local LAB database needs --confirm-non-lab (remote, or a local database without a LAB/test name)', () => {
    const remote = { url: REMOTE, confirmHost: 'ep-x.eu-central-1.aws.neon.tech', confirmDatabase: 'neondb' };
    expect(planTarget(remote)).toMatchObject({ ok: false, reason: expect.stringContaining('--confirm-non-lab') });
    expect(planTarget({ ...remote, confirmNonLab: true })).toMatchObject({ ok: true, local: false, lab: false });
    expect(planTarget({ url: 'postgresql://u@127.0.0.1/accesdirectaide', confirmHost: '127.0.0.1', confirmDatabase: 'accesdirectaide' }).ok).toBe(false);
    expect(JSON.stringify(planTarget(remote))).not.toContain('PLANTED-DB-PASSWORD');
  });
  it('the link has a delivery channel before anything is written; the test outbox is accepted for a LAB database only', () => {
    expect(planDelivery({ provider: '', deliverable: false, lab: false })).toMatchObject({ ok: false, reason: expect.stringContaining('--link-file') });
    expect(planDelivery({ provider: 'noop', deliverable: false, lab: true }).ok).toBe(false);
    expect(planDelivery({ provider: 'test', deliverable: true, lab: false }).ok).toBe(false);
    expect(planDelivery({ provider: 'test', deliverable: true, lab: true })).toEqual({ ok: true, channel: 'mail' });
    expect(planDelivery({ provider: 'msgraph', deliverable: true, lab: false })).toEqual({ ok: true, channel: 'mail' });
    expect(planDelivery({ provider: 'msgraph', deliverable: false, lab: false }).ok).toBe(false);
    expect(planDelivery({ provider: '', deliverable: false, lab: false, linkFile: path.join(os.tmpdir(), `r43-nonexistent-${Date.now()}`) })).toEqual({ ok: true, channel: 'link-file' });
    expect(planDelivery({ provider: '', deliverable: false, lab: false, linkFile: 'CONTROL/link.txt' })).toMatchObject({ ok: false, reason: expect.stringContaining('hors du dépôt') });
    expect(planDelivery({ provider: '', deliverable: false, lab: false, linkFile: os.tmpdir() })).toMatchObject({ ok: false, reason: expect.stringContaining('existe déjà') });
  });
  it('one named person; a strong password (12+, upper, lower, digit)', () => {
    expect(validateIdentity({ email: 'prenom.nom@example.test', name: 'Prénom Nom', attest: 'oui' })).toBeNull();
    expect(validateIdentity({ email: 'x', name: 'Prénom Nom', attest: 'oui' })).toMatch(/adresse/);
    expect(validateIdentity({ email: 'prenom.nom@example.test', name: 'X', attest: 'oui' })).toMatch(/nom/);
    expect(validateIdentity({ email: 'prenom.nom@example.test', name: 'Prénom Nom', attest: 'non' })).toMatch(/personnel/);
    expect(validatePassword('Short1a')).toMatch(/12/);
    expect(validatePassword('alllowercase1234')).toMatch(/majuscule/);
    expect(validatePassword(['Synthetique', 'R43', 'Boot9'].join('-'))).toBeNull();
  });
  it('the link points at the public https site (http only on loopback for a local database), on the enrolment screen, token in the fragment', () => {
    expect(linkOrigin('https://www.accesdirectaide.fr/x', false)).toBe('https://www.accesdirectaide.fr');
    expect(linkOrigin('http://www.accesdirectaide.fr', false)).toBeNull();
    expect(linkOrigin('http://localhost:5185', false)).toBeNull();
    expect(linkOrigin('http://localhost:5185', true)).toBe('http://localhost:5185');
    expect(linkOrigin('https://localhost', false)).toBeNull();
    expect(invitationLink('https://www.example.test', 'ab12')).toBe('https://www.example.test/pro/mfa-settings#invitation=ab12');
    expect(INVITATION_TTL_MS).toBe(72 * 3600 * 1000);
  });
  it('mail delivery uses the configured mailer with the enrolment category and reports the ledger status only', async () => {
    const sent = [];
    const out = await deliverInvitation({ channel: 'mail', email: 'p@example.test', link: 'https://www.example.test/pro/mfa-settings#invitation=t', send: async (m) => { sent.push(m); return { outcome: 'PROVIDER_ACCEPTED' }; } });
    expect(out).toEqual({ delivered: true, status: 'PROVIDER_ACCEPTED' });
    expect(sent[0]).toMatchObject({ to: 'p@example.test', category: 'pro-mfa-invitation' });
    expect(sent[0].subject).not.toMatch(/invitation=/);
    const failed = await deliverInvitation({ channel: 'mail', email: 'p@example.test', link: 'x', send: async () => { throw new Error('down'); } });
    expect(failed).toEqual({ delivered: false, status: 'NOT_DELIVERED' });
  });
});
