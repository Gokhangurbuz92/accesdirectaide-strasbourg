import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('WS7 bounded blocker remediation invariants', () => {
  it('persists encrypted dossier bytes and exposes body-only download capabilities', () => {
    const upload = read('api/_handlers/pro/dossier/upload-secure.js');
    const download = read('api/_handlers/download.js');

    expect(upload).toContain("import { storage } from '../../../lib/storage.js'");
    expect(upload).toContain("sealBuffer(fileBuffer, { purpose: 'dossier-file', context: fileContext })");   // RC5-product: envelope v2 (random per-file data key, AAD = dossier + file)
    expect(upload).toContain('await storage.upload(encryptedBuffer, actualMimeType)');
    expect(upload).toContain("crypto.createHash('sha256').update(fileBuffer)");
    expect(upload).toContain('await storage.delete(storageKey).catch');
    expect(upload).toContain('generateAttachmentToken(`${shareId}:${fileId}`');
    expect(upload).not.toContain('fileName: originalName');

    expect(download).toContain("req.method !== 'POST'");
    expect(download).toContain("const token = String(req.body?.token || '').trim()");
    expect(download).not.toContain('req.query');
    expect(download).toContain('db.query.SharedDiagnostic.findFirst');
    expect(download).toContain('await storage.download(attachment.storageKey)');
    expect(download).toContain("openBuffer(encryptedBuffer, { purpose: 'dossier-file', context: fileContext })");
    expect(download).toContain('Document integrity check failed');
  });

  it('protects public diagnostic shares with a fragment-derived capability', () => {
    const create = read('api/_handlers/share/create.js');
    const get = read('api/_handlers/share/get.js');
    const page = read('src/pages/SharedDiagnostic.jsx');

    expect(create).toContain("crypto.randomBytes(32).toString('base64url')");
    expect(create).toContain('rightsSecretHash');
    expect(create).toContain('#capability=');
    expect(create).toContain('viewCount: 0');

    expect(get).toContain("req.method !== 'POST'");
    expect(get).toContain('req.body?.capability');
    expect(get).toContain('crypto.timingSafeEqual');
    expect(get).not.toContain('searchParams.get');

    expect(page).toContain("window.location.hash.replace(/^#/, '')");
    expect(page).toContain('window.history.replaceState');
    expect(page).toMatch(/csrfFetch\('\/api\/share\/get', \{/);   // DTA S1D (normative, explained): the same protected POST now goes through csrfFetch (bootstrap + one safe retry); endpoint, method, body-only capability unchanged
    expect(page).toContain('body: JSON.stringify({ id, capability })');
  });

  it('routes RDV manage capabilities to an allowlisted fragment receiver and body-only confirmation lookup', () => {
    const rdv = read('api/_handlers/rdv.js');
    const booking = read('src/pages/PublicBooking.jsx');

    expect(rdv).toContain('/booking?${params.toString()}');
    expect(rdv).toContain("fragment.set('token', token)");
    expect(rdv).toContain('const token = toTrimmedString(req.body?.token);');
    expect(rdv).not.toContain('const token = toTrimmedString(req.query?.token);');
    expect(rdv).toContain("method === 'POST'");

    expect(booking).toContain("window.location.hash.replace(/^#/, '')");
    expect(booking).toContain('window.history.replaceState');
    expect(booking).toContain('/confirmation`');
    expect(booking).toContain("method: 'POST'");
    expect(booking).toContain('body: JSON.stringify({ token: manageCapability })');
  });
});
