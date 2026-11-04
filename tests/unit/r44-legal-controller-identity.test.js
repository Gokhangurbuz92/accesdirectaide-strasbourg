// R44 (LCEN analysis I-1): the privacy notice names the controller from its own build value, falling back to the publisher identity.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('R44 controller identity in the privacy notice', () => {
  it('uses VITE_LEGAL_CONTROLLER_IDENTITY when set, never the publisher value', async () => {
    vi.stubEnv('VITE_LEGAL_PUBLISHER_IDENTITY', 'Éditeur test - domicile test');
    vi.stubEnv('VITE_LEGAL_CONTROLLER_IDENTITY', 'Responsable test - personne physique');
    const { LEGAL_PLACEHOLDERS } = await import('@/config/legal-documents');
    expect(LEGAL_PLACEHOLDERS.controllerIdentity).toBe('Responsable test - personne physique');
    expect(LEGAL_PLACEHOLDERS.publisherIdentity).toBe('Éditeur test - domicile test');
  });
  it('falls back to the publisher identity, then to a visible placeholder', async () => {
    vi.stubEnv('VITE_LEGAL_CONTROLLER_IDENTITY', '');
    vi.stubEnv('VITE_LEGAL_PUBLISHER_IDENTITY', 'Éditeur test');
    let mod = await import('@/config/legal-documents');
    expect(mod.LEGAL_PLACEHOLDERS.controllerIdentity).toBe('Éditeur test');
    vi.resetModules();
    vi.stubEnv('VITE_LEGAL_PUBLISHER_IDENTITY', '');
    mod = await import('@/config/legal-documents');
    expect(mod.LEGAL_PLACEHOLDERS.controllerIdentity).toMatch(/^\[À COMPLÉTER : identité du responsable de traitement/);
  });
  it('the privacy page renders the controller value, not the publisher value', () => {
    const src = fs.readFileSync('src/pages/Confidentialite.jsx', 'utf8');
    expect(src).toContain('LEGAL_PLACEHOLDERS.controllerIdentity');
    expect(src).not.toContain('LEGAL_PLACEHOLDERS.publisherIdentity');
  });
});
