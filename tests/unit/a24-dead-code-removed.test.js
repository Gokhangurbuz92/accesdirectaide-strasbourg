/**
 * A-24 — dead or conflicting code removed after a grep of imports, routes and tests:
 *   - privacy.js verifyGuardianScope: no production caller, and weaker than the guardianship state machine (api/_services/guardianship.js) it competed with;
 *   - src/components/ReportContentButton.jsx: imported by nothing (so the « report content » control existed nowhere in the interface).
 * This test fails if either comes back. Not removed here (owned by the booking work): PublicRdvEntry.jsx, AppointmentCancel.jsx, AppointmentReschedule.jsx,
 * api/_handlers/public/appointments/{create,cancel}.js, api/_handlers/public/messages.js (cancel-token message proxy).
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPrivacyRightsService } from '../../api/_services/privacy.js';

describe('A-24 dead code stays removed', () => {
  it('the privacy service has no second, weaker guardian check', () => {
    const service = createPrivacyRightsService({ db: { query: {} }, cryptoLib: { createHash: () => ({ update() { return this; }, digest: () => 'x' }) } });
    expect(service.verifyGuardianScope).toBeUndefined();
    expect(fs.readFileSync('api/_services/privacy.js', 'utf8')).not.toMatch(/verifyGuardianScope/);
  });
  it('the unused « report content » component is gone and nothing imports it', () => {
    expect(fs.existsSync('src/components/ReportContentButton.jsx')).toBe(false);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(jsx?|tsx?)$/.test(e.name) ? [`${d}/${e.name}`] : []));
    expect(walk('src').filter((f) => /ReportContentButton/.test(fs.readFileSync(f, 'utf8')))).toEqual([]);
  });
});
