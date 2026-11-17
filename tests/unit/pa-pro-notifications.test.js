/**
 * RECON Pro 2026-11-15 — A01, A10, A11 (server side), A26. Offline: the real services with an in-memory database double.
 *  A01  a person's message goes to the appointment's professional (else the team), through the catalogue (in-app notice + preference-aware e-mail)
 *  A10  a decided structure proposal notifies the administrators and the author
 *  A11  notify() reaches every member (no cap at 25), the e-mail links to the record, the catalogue holds no entry without an emitter
 *  A26  one organisation audit route: pro/audit/list (a table no code writes) is gone
 */
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: async () => undefined }) } }));

import { CATALOGUE, MEMBER_PAGE, notificationPath, notify } from '../../api/_services/pro-notifications.js';
import { notifyStructureOfMessage } from '../../api/_utils/rdv-messaging.js';

/** a database double for notify(): `members` are returned page by page (in the order given), `unread` = user ids that already hold an unread notice */
function fakeDb(members, unread = []) {
  const inserted = []; let page = 0; const limits = [];
  const memberQuery = () => { const q = { where: () => q, orderBy: () => q, limit: async (n) => { limits.push(n); const out = members.slice(page * n, (page + 1) * n); page += 1; return out; } }; return q; };
  return { inserted, limits,
    select: (fields) => ({ from: () => (fields && 'email' in fields ? memberQuery() : { where: async () => unread.map((userId) => ({ userId })) }) }),
    insert: () => ({ values: async (v) => { inserted.push(v); } }) };
}
const member = (i, extra = {}) => ({ id: `m${String(i).padStart(4, '0')}`, email: `m${i}@example.test`, notificationEmailEnabled: true, notificationPrefs: {}, ...extra });

describe('A11 notify(): every member, deep link, live catalogue', () => {
  it('reaches all 230 active members page by page (it used to stop at 25)', async () => {
    const db = fakeDb(Array.from({ length: 230 }, (_, i) => member(i)));
    const sendMail = vi.fn(async () => ({ outcome: 'TEST_RECORDED' }));
    const sum = await notify({ structureId: 's', to: 'members', type: 'referral_received', metadata: { referralId: 'r1' } }, { db, sendMail });
    expect(sum.inApp).toBe(230);
    expect(sum.recipients).toBe(230);
    expect(new Set(db.inserted.map((r) => r.userId)).size).toBe(230);
    expect(db.limits.every((n) => n === MEMBER_PAGE)).toBe(true);
  });

  it('the e-mail links to the record the notice is about, not to the dashboard for every event', async () => {
    const db = fakeDb([member(1)]);
    const sendMail = vi.fn(async () => ({ outcome: 'TEST_RECORDED' }));
    await notify({ structureId: 's', to: 'members', type: 'referral_received', metadata: { referralId: 'ref-42' } }, { db, sendMail });
    expect(sendMail.mock.calls[0][0].text).toContain('/pro/orientations/ref-42');
    expect(sendMail.mock.calls[0][0].text).not.toContain('/pro/dashboard');
  });

  it('notificationPath maps the stored identifiers; a value that is not a plain id never becomes an address', () => {
    expect(notificationPath('case_assigned', { caseId: 'c1' })).toBe('/pro/dossiers/c1');
    expect(notificationPath('rdv_rescheduled', { appointmentId: 'a1' })).toBe('/pro/appointments/a1');
    expect(notificationPath('message_received', { appointmentId: 'a1', conversationId: 'conv1' })).toBe('/pro/messages/conv1');
    expect(notificationPath('structure_proposal_decided', { proposalId: 'p1' })).toBe('/pro/structure');
    expect(notificationPath('team_role_change', {})).toBe('/pro/team');
    expect(notificationPath('NEW_AIDE', null)).toBe('/pro/dashboard');
    expect(notificationPath('case_assigned', { caseId: '../../admin' })).toBe('/pro/dashboard');
    expect(notificationPath('case_assigned', { caseId: 'https://evil.example' })).toBe('/pro/dashboard');
  });

  it('every catalogue entry has an emitter in api/ (dead entries removed), and message_received exists in « appointments »', () => {
    for (const dead of ['rdv_reminder_j1', 'rdv_visio_approved', 'rdv_visio_revoked', 'rdv_booked_by_guest']) expect(CATALOGUE[dead], dead).toBeUndefined();
    expect(CATALOGUE.message_received).toMatchObject({ category: 'appointments', email: true });
    const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    const source = files('api').filter((f) => !f.endsWith('_services/pro-notifications.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const viaNoticeKind = (type) => type.startsWith('rdv_') && new RegExp(`noticeStructure\\([^,]+, '${type.slice(4).toUpperCase()}'`).test(source);   // appointment-notices: rdv_<kind>
    for (const type of Object.keys(CATALOGUE)) expect(source.includes(`'${type}'`) || viaNoticeKind(type), `no emitter for ${type}`).toBe(true);
  });

  it("to: 'admins' + also — and coalesceUnread skips a member who still holds an unread notice for the appointment (no second e-mail)", async () => {
    const db = fakeDb([member(1), member(2)], ['m0002']);
    const sendMail = vi.fn(async () => ({ outcome: 'TEST_RECORDED' }));
    const sum = await notify({ structureId: 's', to: 'members', type: 'message_received', metadata: { appointmentId: 'a1' }, coalesceUnread: true }, { db, sendMail });
    expect(sum.recipients).toBe(2);
    expect(db.inserted.map((r) => r.userId)).toEqual(['m0001']);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('the « appointments » preference switches the message e-mail off, never the in-app notice', async () => {
    const db = fakeDb([member(1, { notificationPrefs: { appointments: false } })]);
    const sendMail = vi.fn();
    const sum = await notify({ structureId: 's', to: ['m0001'], type: 'message_received', metadata: { appointmentId: 'a1' } }, { db, sendMail });
    expect(sendMail).not.toHaveBeenCalled();
    expect(sum.email.OFF_BY_PREFERENCE).toBe(1);
    expect(db.inserted[0]).toMatchObject({ userId: 'm0001', type: 'message_received', metadata: { appointmentId: 'a1', delivery: { inApp: 'STORED', email: 'OFF_BY_PREFERENCE' } } });
  });
});

describe('A01 a person’s message: the appointment’s professional, else the team', () => {
  const conversation = (owner) => ({ id: 'conv1', structureId: 's', appointmentId: 'a1', appointment: { id: 'a1', createdByProUserId: owner } });
  it('the professional who holds the appointment is the only recipient when the account is an active member', async () => {
    const calls = []; const notifyImpl = async (args) => { calls.push(args); return { recipients: 1, inApp: 1 }; };
    const out = await notifyStructureOfMessage({ conversation: conversation('pro-young'), messageId: 'msg1' }, { notify: notifyImpl });
    expect(out.target).toBe('owner');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ structureId: 's', to: ['pro-young'], type: 'message_received', metadata: { appointmentId: 'a1', conversationId: 'conv1' }, coalesceUnread: true });
    expect(JSON.stringify(calls[0])).not.toMatch(/body|content/i);
  });
  it('no professional on the appointment, or an account that left: every active member', async () => {
    for (const owner of [null, 'pro-gone']) {
      const calls = []; const notifyImpl = async (args) => { calls.push(args); return { recipients: Array.isArray(args.to) ? 0 : 3, inApp: 3 }; };
      const out = await notifyStructureOfMessage({ conversation: conversation(owner), messageId: 'msg1' }, { notify: notifyImpl });
      expect(out.target).toBe('members');
      expect(calls[calls.length - 1].to).toBe('members');
    }
  });
  it('the citizen handler no longer picks the oldest account of the structure', () => {
    const src = fs.readFileSync('api/_handlers/messages.js', 'utf8');
    expect(src).not.toMatch(/asc\(pro\.createdAt\)/);
    expect(src).toMatch(/notifyStructureOfMessage\(/);
    expect(src).toMatch(/createdByProUserId: true/);
  });
});

describe('A10 a decided proposal is announced', () => {
  it('decide() emits structure_proposal_decided to the administrators and the author, with identifiers only', async () => {
    vi.resetModules();
    const sent = [];
    vi.doMock('../../api/_services/pro-notifications.js', () => ({ notify: async (args) => { sent.push(args); return {}; } }));
    vi.doMock('../../api/_services/content-versions.js', () => ({ snapshotRow: async () => undefined }));
    const { decide } = await import('../../api/_services/structure-proposals.js');
    const proposal = { id: 'prop1', structureId: 's1', proposedByProUserId: 'author1', field: 'horaires', proposedValue: 'x', previousValue: 'y', status: 'REJECTED', reviewNote: 'motif confidentiel' };
    const tx = { update: () => ({ set: () => ({ where: () => ({ returning: async () => [proposal] }) }) }), insert: () => ({ values: async () => undefined }) };
    const db = { transaction: async (fn) => fn(tx) };
    const out = await decide('prop1', 'REJECT', 'motif confidentiel', 'reviewer@example.test', db, {});
    expect(out.ok).toBe(true);
    expect(out.notice, 'the internal notice data is not part of the answer').toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ structureId: 's1', to: 'admins', also: ['author1'], type: 'structure_proposal_decided', metadata: { proposalId: 'prop1', kind: 'REJECTED' } });
    expect(JSON.stringify(sent[0])).not.toContain('motif confidentiel');
    vi.doUnmock('../../api/_services/pro-notifications.js'); vi.doUnmock('../../api/_services/content-versions.js');
  });
});

describe('A26 one organisation audit path', () => {
  it('pro/audit/list is not routed and its handler is gone; pro/audit stays', () => {
    const routes = fs.readFileSync('api/routes.js', 'utf8');
    expect(routes).not.toMatch(/path: 'pro\/audit\/list'/);
    expect(routes).toMatch(/path: 'pro\/audit', match: 'exact'/);
    expect(fs.existsSync('api/_handlers/pro/audit/list.js')).toBe(false);
  });
});
