/**
 * G14-R4b — the three blockers that prevented opening Mon Coffre (group B), found by a live-checked review of 395a8abe:
 *   a. release preflight storage.configured FAILED with the documents surface open and no STORAGE_*, although the Coffre lives at the HDS service;
 *   b. an HDS attestation (ADA_HDS_CERTIFIED_HOSTING) opened messaging.conversations for ESSMS / health / unreviewed services although the messages are
 *      stored in Neon — the owner approved messaging for NOT_ESSMS + « ordinary » only (P29, 24/11/2026);
 *   c. /diagnostic and the status page announced dossier sharing from the build switch alone (covered in g3-diagnostic-share-beta, g14-r3h-*).
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilityState, closedCapabilityOfRoute, STORED_OUTSIDE_HDS } from '../../api/_utils/capabilities.js';
import { conversationDecision } from '../../api/_services/messaging-policy.js';
import { documentsStorageCheck, evaluateReleasePreflight, messagingCheck } from '../../scripts/release-preflight.mjs';

const { generateTicketKeyPair } = await import('../../api/lib/hds-ticket.js');
const ATTEST = `HDS1:scalingo:38436:2099-12-31:${'a'.repeat(64)}`;
const GATEWAY = { HDS_SERVICE_URL: 'https://ada-hds-strasbourg.osc-fr1.scalingo.io', HDS_PRODUCTION_APPROVED: 'true', HDS_TICKET_KID: 'k1',
  HDS_TICKET_PRIVATE_KEY: generateTicketKeyPair().privateKeyB64, ADA_HDS_CERTIFIED_HOSTING: ATTEST };
const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1', MAILER_PROVIDER: 'noop' };
const STORAGE = { STORAGE_ENDPOINT: 'https://s3.example.eu', STORAGE_BUCKET: 'b', STORAGE_ACCESS_KEY_ID: 'id', STORAGE_SECRET_ACCESS_KEY: 'secret' };
const storage = (env) => evaluateReleasePreflight(env, { legalText: 'ok' }).find((c) => c.id === 'storage.configured');
const getOf = (env) => (k) => String(env[k] ?? '').trim();

describe('a. storage.configured with the documents surface open', () => {
  const docs = { ...BETA, ADA_BETA_OPEN_SURFACES: 'accounts,documents', ADA_CAPABILITIES_OPEN: 'citizen.vault' };
  it('the HDS service serves the vault (allow-listed origin, approval, ticket key, attestation of the same provider): no bucket required', () => {
    const r = storage({ ...docs, ...GATEWAY });
    expect(r.status).toBe('PASS');
    expect(r.detail).toMatch(/HDS service \(https:\/\/ada-hds-strasbourg\.osc-fr1\.scalingo\.io\)/);
    expect(r.detail).toMatch(/no bucket needed/);
    const both = storage({ ...docs, ...GATEWAY, ADA_CAPABILITIES_OPEN: 'citizen.vault,citizen.shared_dossier' });
    expect(both.status).toBe('PASS'); expect(both.detail).toMatch(/shared dossiers/);
  });
  it('fail closed: no gateway, an origin off the allow-list, no approval, a mismatching attestation or no attestation — STORAGE_* required', () => {
    expect(storage(docs).status).toBe('FAIL');
    expect(storage(docs).detail).toMatch(/HDS_SERVICE_URL_ABSENT/);
    expect(storage({ ...docs, ...GATEWAY, HDS_SERVICE_URL: 'https://ada.example.com' }).status).toBe('FAIL');
    expect(storage({ ...docs, ...GATEWAY, HDS_PRODUCTION_APPROVED: '' }).status).toBe('FAIL');
    expect(storage({ ...docs, ...GATEWAY, ADA_HDS_CERTIFIED_HOSTING: `HDS1:otherhost:38436:2099-12-31:${'a'.repeat(64)}` }).detail).toMatch(/HDS_ATTESTATION_PROVIDER_MISMATCH/);
    expect(storage({ ...docs, ...GATEWAY, ADA_HDS_CERTIFIED_HOSTING: '' }).status).toBe('FAIL');
    expect(storage({ ...docs, ...STORAGE }).status).toBe('PASS');   // the bucket still satisfies the check, as before
  });
  it('guard: every capability of the documents surface is served by the HDS service today — a new one keeping files here must be reviewed with this check', () => {
    // documentsStorageCheck requires the bucket as soon as an OPEN documents capability is not HDS-served; none exists today
    const docCaps = Object.entries(CAPABILITIES).filter(([, c]) => c.surface === 'documents').map(([k]) => k).sort();
    expect(docCaps).toEqual(['citizen.shared_dossier', 'citizen.vault']);
    const env = { ...docs, ...GATEWAY };
    expect(documentsStorageCheck(env, getOf(env))[0]).toBe('PASS');
    expect(documentsStorageCheck(docs, getOf(docs))[0]).toBe('FAIL');
  });
  it('the documents surface closed: PASS as before, whatever the switches', () => {
    expect(storage({ ...BETA }).status).toBe('PASS');
  });
});

describe('b. messaging stays NOT_ESSMS + « ordinary » whatever the HDS attestation says', () => {
  const env = { ...BETA, ADA_BETA_OPEN_SURFACES: 'communications,appointments', ADA_CAPABILITIES_OPEN: 'messaging.conversations,messaging.attachments', ...GATEWAY, VERCEL_ENV: 'production' };
  const ESSMS = { statut: 'actif', verification_status: 'VERIFIED', numero_finess: '670000000', type_finess: '177', type_structure: 'CHRS', nom: 'CHRS du quartier',
    sensitivity: { value: 'ordinary', reviewedAt: '2026-11-20T10:00:00.000Z', reviewedBy: 'admin@example.test' } };
  const ORDINARY = { statut: 'actif', verification_status: 'VERIFIED', numero_finess: null, type_finess: null, type_structure: 'centre social', nom: 'Centre social du quartier',
    sensitivity: { value: 'ordinary', reviewedAt: '2026-11-20T10:00:00.000Z', reviewedBy: 'admin@example.test' } };
  const UNREVIEWED = { ...ORDINARY, sensitivity: null };
  it('the capability: open for NOT_ESSMS; closed for anything else even with a valid attestation (messages are stored in Neon)', () => {
    expect(capabilityState('messaging.conversations', env, { structureCategory: 'NOT_ESSMS' }).open).toBe(true);
    for (const c of [undefined, 'UNKNOWN', 'ESSMS', 'HEALTH']) expect(capabilityState('messaging.conversations', env, c ? { structureCategory: c } : {}), String(c)).toEqual({ open: false, reason: STORED_OUTSIDE_HDS });
    expect(CAPABILITIES['messaging.conversations'].hdsWaiverOnly).toBe(true);
  });
  it('per conversation: an ESSMS structure or an unreviewed service stays closed with HDS attested; a NOT_ESSMS + ordinary one is served', () => {
    expect(conversationDecision(ORDINARY, env)).toEqual({ open: true, reason: null });
    expect(conversationDecision(ESSMS, env).open).toBe(false);
    expect(conversationDecision(ESSMS, env).reason).toMatch(/^HDS_REQUIRED:/);
    expect(conversationDecision(UNREVIEWED, env)).toEqual({ open: false, reason: 'HDS_REQUIRED:SERVICE_NOT_REVIEWED_ORDINARY' });
    expect(conversationDecision(ESSMS, { ...env, ADA_HDS_CERTIFIED_HOSTING: '' }).open).toBe(false);
  });
  it('the attachments path IS stored at the HDS service: it keeps its own HDS rule (gateway + attestation), only inside a served conversation', () => {
    expect(capabilityState('messaging.attachments', env).open).toBe(true);
    expect(capabilityState('messaging.attachments', { ...env, ADA_HDS_CERTIFIED_HOSTING: '' }).open).toBe(false);
    expect(closedCapabilityOfRoute('messages/conversations/c1/attachments/a1', env)).toBe(null);   // route gate: best case; the handler decides each conversation
  });
  it('release preflight: WARN naming the NOT_ESSMS + ordinary scope, never « open for every structure »', () => {
    const r = messagingCheck(env, { betaOn: true, opened: new Set(['communications', 'appointments']) });
    expect(r[0]).toBe('WARN');
    expect(r[1]).toMatch(/NOT_ESSMS structures and services reviewed « ordinary » only/);
    expect(r[1]).toMatch(/attachments open \(stored at the HDS service\)/);
    expect(r[1]).not.toMatch(/every structure/);
  });
});
