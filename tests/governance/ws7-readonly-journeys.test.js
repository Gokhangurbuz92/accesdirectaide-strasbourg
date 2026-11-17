import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('WS7 read-only journey preservation', () => {
  it('preserves diagnostic and dossier-sharing boundaries', () => {
    // DTA S1 2b (normative change, same behaviour): the result area (share + QR) moved from the page into DiagnosticOutcome.jsx; both files together keep the contract.
    const diagnostic = read('src/pages/DiagnosticPage.jsx') + '\n' + read('src/components/diagnostic/DiagnosticOutcome.jsx');

    expect(diagnostic).toMatch(/csrfFetch\('\/api\/diagnostic'/);   // DTA S1D (normative, explained): same endpoint, now through csrfFetch
    expect(diagnostic).toMatch(/csrfFetch\('\/api\/share\/create'/);
    expect(diagnostic).toContain('QRCode');
    expect(diagnostic).toContain('Simulation locale');
  });

  it('preserves emergency/accessibility resource lookup', () => {
    const page = read('src/pages/Ressources.jsx');
    const handler = read('api/_handlers/ressources.js');

    expect(page).toContain("let url = '/api/ressources'");
    expect(handler).toContain("eq(ResourceAccessibility.status, 'published')");
    expect(handler).toContain("checkRateLimit('SEARCH_RESSOURCES'");
  });

  it('preserves secure local-storage adapter behavior without logging document content', () => {
    const storage = read('api/lib/storage.js');

    expect(storage).toContain('LocalFilesystemStorage');
    expect(storage).toContain('localStorage.upload(buffer)');
    expect(storage).toContain('localStorage.download(key)');
    expect(storage).toContain('localStorage.delete(key)');
    expect(storage).toContain('buffer.length');
    expect(storage).not.toContain('logger.info(buffer');
    expect(storage).not.toContain('logger.error(buffer');
  });

  it('preserves fragment capability handling and immediate history scrubbing', () => {
    // A-24: the unrouted AppointmentCancel / AppointmentReschedule pages were deleted; the capability link of the e-mail opens the routed manage view
    // of /rdv/:slug/booking (PublicBooking.jsx), which keeps the same contract: token read from the fragment only, history scrubbed at once, POST body only
    const manage = read('src/pages/PublicBooking.jsx');
    expect(manage).toContain("window.location.hash.replace(/^#/, '')");
    expect(manage).toContain("params.get('token') || ''");
    expect(manage).toContain('window.history.replaceState');
    expect(manage).toContain('window.location.pathname');
    expect(manage).toContain('window.location.search');
    expect(manage).not.toContain('const { token } = useParams()');
    expect(manage).toContain('body: JSON.stringify({ token: manageCapability })');
  });
});
