/**
 * R3H — live audit 24/11/2026: with the appointments and assistant surfaces open (build « admin,accounts,pro,appointments,video,assistant,… »), /api/status
 * still said « Les rendez-vous et le partage de dossier ne sont pas encore ouverts » and « l'assistant n'est pas ouvert ». The status now follows the
 * server's own switches: the surface AND its capability (citizen.booking, ai.citizen_assistant); dossier sharing follows the « documents » surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ dbOk: true }));
vi.mock('../../src/db/index.js', () => ({ db: { execute: async () => { if (!h.dbOk) throw new Error('down'); return { rows: [{}] }; } } }));
vi.mock('../../api/_utils/mailer.js', () => ({ getMailerStatus: () => ({ provider: 'mailjet', deliverable: true, reason: 'ok' }) }));
const { computeStatus } = await import('../../api/_handlers/public-status.js');
const get = (b, id) => b.components.find((c) => c.id === id);
const ENV = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_CAPABILITIES_OPEN', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_HDS_CERTIFIED_HOSTING', 'VERCEL_ENV', 'HDS_SERVICE_URL', 'HDS_PRODUCTION_APPROVED', 'HDS_TICKET_KID', 'HDS_TICKET_PRIVATE_KEY'];
const { generateTicketKeyPair } = await import('../../api/lib/hds-ticket.js');
const { sharingAvailability } = await import('../../api/_utils/capabilities.js');
const ATTEST = `HDS1:scalingo:38436:2099-12-31:${'a'.repeat(64)}`;
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); process.env.ADA_PUBLIC_BETA_RESTRICTED = 'true'; h.dbOk = true; });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('R3H public status follows the opened surfaces', () => {
  it('Production 24/11 switches: appointments open, sharing closed, assistant open', async () => {
    process.env.ADA_BETA_OPEN_SURFACES = 'admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic';
    process.env.ADA_CAPABILITIES_OPEN = 'ai.citizen_assistant';
    const b = await computeStatus();
    const comptes = get(b, 'comptes').text;
    expect(comptes).toMatch(/demandes de rendez-vous en ligne sont ouvertes/);
    expect(comptes).toMatch(/Le partage de dossier n'est pas encore ouvert/);
    expect(comptes).not.toMatch(/rendez-vous et le partage de dossier ne sont pas encore ouverts/);
    expect(get(b, 'assistant').text).toMatch(/L'assistant citoyen est ouvert/);
    expect(get(b, 'assistant').text).toMatch(/seul l'organisme concerné décide de vos droits/);
  });
  it('assistant surface open but its capability not listed: still announced closed', async () => {
    process.env.ADA_BETA_OPEN_SURFACES = 'accounts,assistant';
    delete process.env.ADA_CAPABILITIES_OPEN;
    const b = await computeStatus();
    expect(get(b, 'assistant').text).toMatch(/l'assistant n'est pas ouvert/);
    expect(get(b, 'comptes').text).toMatch(/rendez-vous et le partage de dossier ne sont pas encore ouverts/);
  });
  it('appointments open with the database down: the appointments are said unavailable too', async () => {
    process.env.ADA_BETA_OPEN_SURFACES = 'accounts,appointments'; h.dbOk = false;
    const b = await computeStatus();
    expect(get(b, 'comptes')).toMatchObject({ state: 'unavailable' });
    expect(get(b, 'comptes').text).toMatch(/comptes personnels et les rendez-vous sont indisponibles/);
  });
  it('G14-R4: the documents surface open but citizen.shared_dossier closed — sharing announced closed, features say so', async () => {
    process.env.ADA_BETA_OPEN_SURFACES = 'accounts,documents,diagnostic';
    delete process.env.ADA_CAPABILITIES_OPEN;
    const b = await computeStatus();
    expect(get(b, 'comptes').text).toMatch(/partage de dossier ne sont pas encore ouverts|Le partage de dossier n'est pas encore ouvert/);
    expect(b.features).toEqual({ sharedDossiers: false, diagnosticShare: false });
  });
  it('G14-R4: LAB (beta) with documents + diagnostic and both capabilities listed — sharing open and the diagnostic share served', async () => {
    process.env.ADA_BETA_OPEN_SURFACES = 'accounts,documents,diagnostic';
    process.env.ADA_CAPABILITIES_OPEN = 'citizen.shared_dossier,citizen.saved_diagnostic';
    process.env.ADA_HDS_CERTIFIED_HOSTING = ATTEST;
    const b = await computeStatus();
    expect(get(b, 'comptes').text).not.toMatch(/partage de dossier n'est pas encore ouvert/);
    expect(b.features).toEqual({ sharedDossiers: true, diagnosticShare: true });
  });
  it('G14-R4: deployed with the HDS gateway — shared dossiers open (at the HDS service) but the account-free diagnostic link is never served (409)', () => {
    const env = { ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'accounts,documents,diagnostic', ADA_CAPABILITIES_OPEN: 'citizen.shared_dossier,citizen.saved_diagnostic,citizen.vault',
      ADA_HDS_CERTIFIED_HOSTING: ATTEST, VERCEL_ENV: 'production', HDS_SERVICE_URL: 'https://ada-hds-strasbourg.osc-fr1.scalingo.io', HDS_PRODUCTION_APPROVED: 'true',
      HDS_TICKET_KID: 'k1', HDS_TICKET_PRIVATE_KEY: generateTicketKeyPair().privateKeyB64 };
    expect(sharingAvailability(env)).toEqual({ sharedDossiers: true, diagnosticShare: false });
    expect(sharingAvailability({ ...env, HDS_SERVICE_URL: '' })).toEqual({ sharedDossiers: false, diagnosticShare: false });
  });
});
