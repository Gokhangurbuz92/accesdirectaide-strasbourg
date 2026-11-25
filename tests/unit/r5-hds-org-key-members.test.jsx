// @vitest-environment jsdom
/**
 * R5 — ADA Pro « Dossiers chiffrés » (/pro/partages-chiffres), organisation key administration:
 *   - « Retirer l'accès » per member (administrator only) behind a confirmation that states the effect and recommends « Changer la clé »; it calls
 *     DELETE /v1/pro/org-keys/members through the professional ticket (src/lib/hdsClient.js);
 *   - giving access (after a key change too) skips every member whose ADA Pro account is not ACTIVE: the HDS service does not know the account status and
 *     still lists a deactivated member's personal key as « to wrap »; without the team list nothing is wrapped (fail closed).
 * No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: /** @type {Array<{ cap: string, path: string, opts: any }>} */ ([]), state: /** @type {any} */ (null) }));
vi.mock('../../src/lib/hdsClient.js', () => ({
  hdsRequest: vi.fn(async (cap, path, opts = {}) => { h.calls.push({ cap, path, opts }); return path === '/v1/pro/keys' ? h.state : { ok: true }; }),
  saveBlob: vi.fn(),
}));
vi.mock('../../src/lib/hdsKeys.js', () => ({ getMemberKey: () => ({ k: 'member' }), getOrgKey: () => null, setOrgKey: vi.fn(), setMemberKey: vi.fn(), subscribeKeys: () => () => {} }));
vi.mock('../../src/lib/dossierCrypto.js', () => ({
  openOrgPrivateJwk: vi.fn(async () => ({ kty: 'EC' })),
  wrapOrgPrivateFor: vi.fn(async (_jwk, kid, pub) => ({ wrappedFor: pub.id, kid })),
}));

const hs = await import('../../src/lib/hdsSharing.js');
const OrgKeyMembers = (await import('../../src/components/hds/OrgKeyMembers.jsx')).default;

const ADMIN = 'u-admin'; const ACTIVE = 'u-active'; const GONE = 'u-disabled';
const pending = (/** @type {string} */ id) => ({ memberRef: id, publicJwk: { id } });

beforeEach(() => {
  h.calls = [];
  h.state = { memberRef: ADMIN, role: 'STRUCTURE_ADMIN', member: { publicJwk: {} }, orgKeys: [{ kid: 'k2', active: true, wrappedPrivate: { box: 1 } }, { kid: 'k1', active: false, wrappedPrivate: { box: 2 } }],
    pendingMembers: [pending(ACTIVE), pending(GONE)] };
});
afterEach(() => { cleanup(); });

describe('giving access to the organisation key: active ADA Pro accounts only', () => {
  it('after a key change, a deactivated member still holding a personal key is not re-wrapped; the active one gets every key', async () => {
    expect(await hs.proWrapPending(new Set([ADMIN, ACTIVE]))).toBe(1);
    const posts = h.calls.filter((c) => c.path === '/v1/pro/org-keys/members');
    expect(posts).toHaveLength(1);
    expect(posts[0].opts).toMatchObject({ method: 'POST', side: 'pro', body: { memberRef: ACTIVE } });
    expect(posts[0].opts.body.wraps.map((/** @type {any} */ w) => w.kid)).toEqual(['k2', 'k1']);
    expect(JSON.stringify(h.calls)).not.toContain(GONE);
  });

  it('fails closed without the team list (nothing wrapped), and eligiblePending never offers an unknown or deactivated member', async () => {
    await expect(hs.proWrapPending(/** @type {any} */ (undefined))).rejects.toMatchObject({ code: 'ACTIVE_MEMBERS_UNKNOWN' });
    expect(h.calls).toEqual([]);
    expect(hs.eligiblePending(h.state, new Set([ACTIVE])).map((m) => m.memberRef)).toEqual([ACTIVE]);
    expect(hs.eligiblePending(h.state, new Set())).toEqual([]);
  });

  it('the page passes the active members of the team list and counts only them', () => {
    const page = readFileSync('src/pages/pro/PartagesChiffres.jsx', 'utf8');
    expect(page).toMatch(/team\.users\.filter\(\(u\) => u\.status === 'active'\)/);
    expect(page).toMatch(/hs\.proWrapPending\(activeRefs\)/);
    expect(page).toMatch(/n: eligible\.length/);
    expect(page).toMatch(/proRdvRequest\('\/api\/pro\/team'/);
  });
});

describe('« Retirer l’accès » (administrator)', () => {
  it('calls DELETE /v1/pro/org-keys/members with the member ref through the professional ticket of citizen.shared_dossier', async () => {
    await hs.proRemoveMember(GONE);
    expect(h.calls).toEqual([{ cap: 'citizen.shared_dossier', path: '/v1/pro/org-keys/members', opts: { method: 'DELETE', body: { memberRef: GONE }, side: 'pro' } }]);
  });

  it('lists the other members with their state; the confirmation states the effect and recommends a key change; only then is the member removed', () => {
    const onRemove = vi.fn();
    render(createElement(OrgKeyMembers, {
      members: [{ memberRef: ADMIN, hasAccess: true }, { memberRef: ACTIVE, hasAccess: true }, { memberRef: GONE, hasAccess: false }, { memberRef: 'u-erased', hasAccess: true }],
      self: ADMIN, busy: false, onRemove,
      team: [{ id: ADMIN, email: 'admin@example.test', status: 'active' }, { id: ACTIVE, email: 'active@example.test', status: 'active' }, { id: GONE, email: 'gone@example.test', status: 'disabled' }],
    }));
    const rows = screen.getAllByTestId('pro-hds-member');
    expect(rows).toHaveLength(3);   // never myself
    expect(rows[0]).toHaveTextContent('active@example.test'); expect(rows[0]).toHaveTextContent('Peut ouvrir les dossiers'); expect(rows[0]).not.toHaveTextContent('Compte désactivé');
    expect(rows[1]).toHaveTextContent('gone@example.test'); expect(rows[1]).toHaveTextContent('Compte désactivé'); expect(rows[1]).toHaveTextContent('Accès pas encore donné');
    expect(rows[2]).toHaveTextContent('Compte supprimé ou inconnu');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Retirer l’accès' }));
    expect(onRemove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Retirer l’accès de gone@example.test ?');
    expect(dialog).toHaveTextContent(/ne pourra plus ouvrir les dossiers partagés avec la clé de la structure/);
    expect(dialog).toHaveTextContent(/changez ensuite la clé de la structure avec « Changer la clé de la structure »/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Retirer l’accès' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByTestId('pro-hds-member-confirm-remove'));
    expect(onRemove).toHaveBeenCalledWith(GONE);
  });

  it('an HDS service deployed before R5 (no `members`): every other member of the team is offered; buttons are disabled while busy', () => {
    render(createElement(OrgKeyMembers, { members: undefined, self: ADMIN, busy: true, onRemove: vi.fn(),
      team: [{ id: ADMIN, email: 'admin@example.test', status: 'active' }, { id: ACTIVE, email: 'active@example.test', status: 'active' }] }));
    const rows = screen.getAllByTestId('pro-hds-member');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByRole('button', { name: 'Retirer l’accès' })).toBeDisabled();
  });

  it('six languages: every new key is translated in the five locale files', () => {
    const KEYS = ['hds.admin_only', 'hds.invalid_member', 'hds.team_failed', 'hds.member_removed', 'hds.inactive_skipped', 'hds.members_title', 'hds.member_unknown', 'hds.member_disabled',
      'hds.member_has_access', 'hds.member_no_access', 'hds.member_remove', 'hds.members_empty', 'hds.member_remove_title', 'hds.member_remove_effect', 'hds.cancel', 'hds.member_remove_confirm'];
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}/pro.json`, 'utf8'));
      for (const k of KEYS) expect(typeof loc[k], `${lang} ${k}`).toBe('string');
      expect(loc['hds.inactive_skipped'], lang).toContain('{{n}}');
      expect(loc['hds.member_remove_title'], lang).toContain('{{who}}');
    }
  });
});
