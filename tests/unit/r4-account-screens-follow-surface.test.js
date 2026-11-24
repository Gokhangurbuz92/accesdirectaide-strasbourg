// R4 fix (owner report 24/11/2026): /compte/messages showed « Cette fonction n'est pas encore ouverte » although messaging was open on the server
// (release 3), and Mon Coffre / the shared-dossier detail stayed closed after release 4. These screens sit under /compte, which the narrow accounts scope
// does not open: they must follow their own surface, like the server (api/_utils/public-beta.js SURFACES).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';

// Production after release 4 (activate_g14_r4.sh, 24/11/2026)
const OPEN = 'admin,accounts,pro,appointments,video,assistant,social_referrals,diagnostic,events,communications,documents,stories,testimonials,notices,employment'.split(',');
const SUB = { accountsScope: 'booking', proSelfRegistration: false, accountsExtras: 'parcours,push,assist,household,guardians,delegations,legal_protection'.split(',') };

describe('account screens follow their own surface', () => {
  it('messages follow « communications »', () => {
    expect(isBetaRestrictedPath('/compte/messages', OPEN, SUB)).toBe(false);
    expect(isBetaRestrictedPath('/compte/messages/abc', OPEN, SUB)).toBe(false);
    expect(isBetaRestrictedPath('/compte/messages', OPEN.filter((x) => x !== 'communications'), SUB)).toBe(true);
  });
  it('Mon Coffre and the shared-dossier detail follow « documents »', () => {
    for (const p of ['/compte/coffre', '/compte/partages/abc']) {
      expect(isBetaRestrictedPath(p, OPEN, SUB)).toBe(false);
      expect(isBetaRestrictedPath(p, OPEN.filter((x) => x !== 'documents'), SUB)).toBe(true);
    }
  });
  it('with the release-4 lists, only the intentionally closed screens stay closed', () => {
    const src = readFileSync(resolve(__dirname, '../../src/pages/index.jsx'), 'utf8');
    const routes = [...new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))];
    const closed = routes.filter((r) => isBetaRestrictedPath(r.replace(/:[A-Za-z]+/g, 'x').replace(/\*$/, ''), OPEN, SUB, true)).sort();
    // X03 entraide, favourites/history and referrals (full scope / pro.referrals not opened), institution portal, Sentry test pages
    const allowed = /^\/(compte\/(entraide|favoris|historique|orientations)|institution|__sentry_test|sentry-test)(\/|$)/;
    expect(closed.filter((r) => !allowed.test(r))).toEqual([]);
  });
});
