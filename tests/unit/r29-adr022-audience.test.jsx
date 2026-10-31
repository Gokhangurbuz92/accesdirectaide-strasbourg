// @vitest-environment jsdom
/**
 * ADR-022 — no audience measurement by default: the scripts load only with VITE_AUDIENCE_MEASUREMENT=on (never in the beta), and the public texts follow.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

describe('ADR-022 audience measurement', () => {
  it('the flag is off unless explicitly on, and never on in the beta or in mock mode', () => {
    expect(read('src/config/env.js')).toMatch(/audienceMeasurement: import\.meta\.env\.VITE_AUDIENCE_MEASUREMENT === 'on' && import\.meta\.env\.VITE_PUBLIC_BETA !== 'true' && import\.meta\.env\.VITE_USE_MOCKS !== 'true'/);
    expect(read('src/App.jsx')).toMatch(/const ANALYTICS_ENABLED = frontendEnv\.flags\.audienceMeasurement;/);
  });
  it('banner, cookie page and privacy page have a « not measured » wording outside the beta', () => {
    expect(read('src/components/CookieBanner.jsx')).toMatch(/!frontendEnv\.flags\.audienceMeasurement \? \(/);
    const cookies = read('src/pages/Cookies.jsx');
    expect(cookies).toMatch(/data-testid="no-analytics"/);
    expect(cookies).toMatch(/La mesure d\\'audience n\\'est pas activée sur ce site/);
    const privacy = read('src/pages/Confidentialite.jsx');
    expect(privacy).toMatch(/Nous ne mesurons pas l&apos;audience ; nous enregistrons les erreurs techniques/);
    expect(privacy).toMatch(/Pendant la bêta publique, ni mesure d&apos;audience ni journal d&apos;erreurs chez un prestataire/);
  });
  it('the decision is documented', () => {
    const adr = read('docs/ADR-022-audience-measurement.md');
    expect(adr).toMatch(/No audience measurement by default/);
    expect(adr).toMatch(/No tracker that needs consent, ever, without a new ADR/);
  });
  it('the Content Security Policies do not allow the measurement script host while measurement is off (least privilege)', () => {
    for (const f of ['vercel.json', 'api/_services/page-head.js', 'api/_utils/security.js']) expect(read(f), f).not.toMatch(/va\.vercel-scripts\.com/);
  });
  it('no measurement script is referenced by the HTML shell', () => {
    expect(read('index.html')).not.toMatch(/plausible|matomo|googletagmanager|gtag\(|va\.vercel-scripts/);
  });
});
