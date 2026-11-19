/**
 * 19/11/2026 (campaign G3) — the public status said « les comptes … ne sont pas encore ouverts » and « aucun e-mail n'est envoyé » after the 6B opening
 * (live /api/status checked 19/11 03:43Z). During the beta: accounts closed → unchanged texts; accounts open → personal accounts follow the database,
 * appointments/dossier sharing still announced closed, e-mails follow the real mail configuration (account e-mails only, never « rappels »).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ dbOk: true, mail: { provider: 'mailjet', deliverable: true, reason: 'ok' } }));
vi.mock('../../src/db/index.js', () => ({ db: { execute: async () => { if (!h.dbOk) throw new Error('down'); return { rows: [{}] }; } } }));
vi.mock('../../api/_utils/mailer.js', () => ({ getMailerStatus: () => h.mail }));
const { computeStatus } = await import('../../api/_handlers/public-status.js');
const get = (b, id) => b.components.find((c) => c.id === id);
const ENV = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES'];
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); process.env.ADA_PUBLIC_BETA_RESTRICTED = 'true'; h.dbOk = true; h.mail = { provider: 'mailjet', deliverable: true, reason: 'ok' }; });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('public status during the beta, before and after the accounts opening', () => {
  it('accounts closed: the beta texts are unchanged', async () => {
    delete process.env.ADA_BETA_OPEN_SURFACES;
    const b = await computeStatus();
    expect(get(b, 'comptes')).toMatchObject({ state: 'info' }); expect(get(b, 'comptes').text).toMatch(/ne sont pas encore ouverts/);
    expect(get(b, 'emails')).toMatchObject({ state: 'info' }); expect(get(b, 'emails').text).toMatch(/aucun e-mail/);
  });
  it('accounts open (6B): accounts work, appointments and sharing still closed, account e-mails sent', async () => {
    process.env.ADA_BETA_OPEN_SURFACES = 'accounts';
    const b = await computeStatus();
    expect(get(b, 'comptes').state).toBe('operational');
    expect(get(b, 'comptes').text).toMatch(/comptes personnels fonctionnent/); expect(get(b, 'comptes').text).toMatch(/rendez-vous et le partage de dossier ne sont pas encore ouverts/);
    expect(get(b, 'emails').state).toBe('operational'); expect(get(b, 'emails').text).not.toMatch(/rappel/i); expect(get(b, 'emails').text).not.toMatch(/aucun e-mail/);
  });
  it('accounts open but database down / mail not configured: said plainly', async () => {
    process.env.ADA_BETA_OPEN_SURFACES = 'accounts'; h.dbOk = false; h.mail = { provider: 'none', deliverable: false, reason: 'missing' };
    const b = await computeStatus();
    expect(get(b, 'comptes').state).toBe('unavailable'); expect(get(b, 'emails').state).toBe('unavailable');
  });
});
