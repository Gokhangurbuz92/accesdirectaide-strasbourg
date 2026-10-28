/**
 * DTA S1D — POST /api/download (signed attachment token).  The token (1 h) is a bearer capability issued to the uploading organization; before S1D a grant revocation did not
 * stop it (no grant re-check).  Contract: the organization that owns the file (file.structureId) must STILL hold an active grant; revoked / absent => the same 404 as an unknown file.
 * Legacy file entries without structureId keep the previous behaviour (no owner to check) — recorded as a limit, not hidden.  Mocked sinks (db, storage, crypto, data-keys).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ shared: null, grant: null, tokenValue: 'sd1:f1', downloads: 0, grantCalls: [] }));
vi.mock('../../src/db/index.js', () => ({ db: { query: { SharedDiagnostic: { findFirst: async () => S.shared } }, insert: () => ({ values: async (v) => { (S.audits ||= []).push(v); } }) } }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('../../api/lib/crypto.js', () => ({ verifyAttachmentToken: (t) => (t === 'good' ? S.tokenValue : null) }));
vi.mock('../../api/lib/data-keys.js', () => ({ openBuffer: () => Buffer.from('PDFDATA'), openText: () => 'doc.pdf' }));
vi.mock('../../api/lib/storage.js', () => ({ storage: { download: async () => { S.downloads += 1; return Buffer.from('x'); } } }));
vi.mock('../../api/_utils/share-access.js', () => ({ findGrant: async (shareId, structureId) => { S.grantCalls.push([shareId, structureId]); return S.grant; } }));
// PKG-11 audit: the handler also re-checks the restriction of processing (art. 18); mocked here like the grant (assertions unchanged)
vi.mock('../../api/_services/processing-restriction.js', () => ({ isDossierRestricted: async () => Boolean(S.restricted) }));

import handler from '../../api/_handlers/download.js';
import crypto from 'node:crypto';

const sum = crypto.createHash('sha256').update(Buffer.from('PDFDATA')).digest('hex');
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(d) { this.body = d; return this; } });
const call = async (token = 'good') => { const r = mk(); await handler({ method: 'POST', body: { token }, headers: {} }, r); return r; };
const file = (extra = {}) => ({ id: 'f1', encrypted: true, storageKey: 'k', filenameEncrypted: 'e', checksumSha256: sum, mimeType: 'application/pdf', ...extra });
beforeEach(() => { S.downloads = 0; S.grantCalls.length = 0; S.grant = { revokedAt: null }; S.restricted = false; S.shared = { id: 'sd1', expiresAt: new Date(Date.now() + 86400000), results: { _files: [file({ structureId: 'S1' })] } }; });

describe('download token vs grant revocation', () => {
  it('an active grant of the file-owning organization: 200 and the file is served', async () => {
    const r = await call(); expect(r.statusCode).toBe(200); expect(S.downloads).toBe(1);
    // R12 (R16): the download is written to the person's access journal with the owning organization
    expect(S.audits.at(-1)).toMatchObject({ action: 'DOSSIER_FILE_DOWNLOADED', entity_id: S.tokenValue.split(':')[0], details: { fileId: S.tokenValue.split(':')[1] } });
    expect(S.grantCalls).toEqual([['sd1', 'S1']]);
  });
  it('a REVOKED grant: 404 "Document not found" (same as an unknown file), nothing is read from storage', async () => {
    S.grant = { revokedAt: new Date() };
    const r = await call(); expect(r.statusCode).toBe(404); expect(r.body).toEqual({ error: 'Document not found' }); expect(S.downloads).toBe(0);
  });
  it('NO grant row for the file-owning organization: 404, nothing read', async () => {
    S.grant = null; const r = await call(); expect(r.statusCode).toBe(404); expect(S.downloads).toBe(0);
  });
  it('the uniform 404 is identical for unknown token, unknown dossier, unknown file and revoked grant', async () => {
    const bodies = [];
    bodies.push((await call('bad')).body);
    S.shared = null; bodies.push((await call()).body);
    S.shared = { id: 'sd1', expiresAt: new Date(Date.now() + 86400000), results: { _files: [] } }; bodies.push((await call()).body);
    S.shared = { id: 'sd1', expiresAt: new Date(Date.now() + 86400000), results: { _files: [file({ structureId: 'S1' })] } }; S.grant = { revokedAt: new Date() }; bodies.push((await call()).body);
    for (const b of bodies) expect(b).toEqual({ error: 'Document not found' });
  });
  it('an expired dossier keeps 410 (unchanged)', async () => {
    S.shared.expiresAt = new Date(Date.now() - 1000); expect((await call()).statusCode).toBe(410); expect(S.downloads).toBe(0);
  });
  it('LIMIT (recorded): a legacy file entry without structureId has no owning organization to re-check and is served as before', async () => {
    S.shared.results._files = [file()]; const r = await call(); expect(r.statusCode).toBe(200); expect(S.grantCalls).toHaveLength(0);
  });  it('PKG-11 audit: a token minted before the person restricted processing (art. 18) stops working: the same 404, nothing read', async () => {
    S.restricted = true; const r = await call(); expect(r.statusCode).toBe(404); expect(r.body).toEqual({ error: 'Document not found' }); expect(S.downloads).toBe(0);
  });
});
