// @vitest-environment jsdom
/**
 * G8 (live check 19/11/2026 after the G4 opening): /politique-confidentialite § 2 still said that the questionnaire's answers are sent to the server and
 * kept 24 h on the device, while /orientation runs entirely in the browser. With VITE_ORIENTATION_BROWSER_ONLY=1 the page now shows the APPROVED privacy
 * notice v8 paragraph (no new legal wording), and names the approved notice in force; the « relecture juridique en cours » status stays visible.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH } from '../../src/config/legal-drafts.js';

const APPROVED = 'cgu-citoyen@v7-2026-11-18,notice-confidentialite@v8-2026-11-19,cgu-professionnel@v8-2026-11-19,conditions-structures@v8-2026-11-19';
const OLD = 'Vos réponses sont envoyées à notre serveur pour le calcul';

async function renderPrivacy() {
  vi.resetModules();
  const mod = await import('../../src/pages/Confidentialite.jsx');
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/politique-confidentialite'] }, createElement(mod.default))));
}

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('G8: privacy page § 2 follows the orientation mode', () => {
  it('Production G4 settings: the approved v8 paragraph, no server/24 h sentence, no device-erase button, the notice in force is named', async () => {
    vi.stubEnv('VITE_ORIENTATION_BROWSER_ONLY', '1');
    vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', APPROVED);
    const { container } = await renderPrivacy();
    expect(screen.getByTestId('privacy-questionnaire-browser-only')).toHaveTextContent(LEGAL_DRAFTS_V8_BROWSER_ONLY_PARAGRAPH);
    expect(container.textContent).not.toContain(OLD);
    expect(container.textContent).not.toContain('Effacer mes réponses enregistrées sur cet appareil');
    expect(screen.getByTestId('privacy-reference-notice')).toHaveTextContent('version v8-2026-11-19');
    expect(within(screen.getByTestId('privacy-reference-notice')).getByRole('link')).toHaveAttribute('href', '/confidentialite/notice');
    expect(container.textContent).toContain('relecture juridique en cours');
  });

  it('flag off (server orientation): the previous text and the erase button stay; no notice named while none is approved', async () => {
    vi.stubEnv('VITE_ORIENTATION_BROWSER_ONLY', '');
    vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', '');
    const { container } = await renderPrivacy();
    expect(container.textContent).toContain(OLD);
    expect(screen.queryByTestId('privacy-questionnaire-browser-only')).toBeNull();
    expect(screen.queryByTestId('privacy-reference-notice')).toBeNull();
  });
});

describe('G8: cookies page shared-device warning follows the orientation mode', () => {
  const renderCookies = async () => { vi.resetModules(); const mod = await import('../../src/pages/Cookies.jsx');
    return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/cookies'] }, createElement(mod.default)))); };
  it('browser-only: no « vos réponses au questionnaire restent sur l\'appareil »', async () => {
    vi.stubEnv('VITE_ORIENTATION_BROWSER_ONLY', '1');
    await renderCookies();
    expect(screen.queryByTestId('cookies-shared-device')).toBeNull();
  });
  it('server orientation: the warning stays', async () => {
    vi.stubEnv('VITE_ORIENTATION_BROWSER_ONLY', '');
    await renderCookies();
    expect(screen.getByTestId('cookies-shared-device')).toBeInTheDocument();
  });
});

describe('G9: retention paragraph matches the schedule and the approval', () => {
  it('daily purge at 3 a.m. UTC (vercel.json « 0 3 * * * »), never « hebdomadaire »; « pas encore validées » hidden once the notice is approved', async () => {
    const vercel = JSON.parse((await import('node:fs')).readFileSync('vercel.json', 'utf8'));
    expect(vercel.crons.find((c) => c.path === '/api/cron/gdpr-purge').schedule).toBe('0 3 * * *');
    vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', APPROVED);
    const { container } = await renderPrivacy();
    expect(container.textContent).toContain('tâche automatique quotidienne (chaque jour à 3 h, heure UTC)');
    expect(container.textContent).not.toMatch(/hebdomadaire|chaque dimanche/);
    expect(container.textContent).not.toContain("n'ont pas encore été validées par le responsable de traitement");
  });
  it('nothing approved: the « not validated » sentence stays', async () => {
    vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', '');
    const { container } = await renderPrivacy();
    expect(container.textContent).toContain("n'ont pas encore été validées par le responsable de traitement");
  });
});

