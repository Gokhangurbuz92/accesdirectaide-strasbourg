/**
 * R47 journey 4 — CROSS-SURFACE CONSISTENCY on the REAL API and a Production-migrated LAB database (run-lab.mjs): every state change of one request is
 * read back on the three sides (the person, the assigned professional, the structure administrator) and in the rows (ProAppointment, AppointmentNotice,
 * ProNotification, AuditLog without personal data); cross-structure isolation: the witness structure's professional and administrator cannot read or act
 * on CDGG's appointment by id or by URL, another person cannot either.
 */
import { test, expect } from '@playwright/test';
import { BASE, CREDS, SLUG, SVC_APPROVAL, SVC_DIRECT, HAS_0045, db, person, citizenSignIn, proSignIn, allSlots, pickSlot, book, papi, notices, proNotices, expectNotice, auditWithoutPersonalData, axe } from './lib.mjs';

test.describe.configure({ mode: 'serial' });
const S = {};
let client; let other;
test.afterAll(async () => { for (const c of [client, other]) await c?.context.close(); });

const sides = async (id) => {
  const mine = (await client.api('GET', `/api/rdv/appointments/${id}`)).json;
  const assigned = (await db(`SELECT "createdByProUserId" p FROM "ProAppointment" WHERE id = $1`, [id]))[0].p;
  const proKey = Object.keys(CREDS.pros).find((k) => CREDS.pros[k].id === assigned);
  const pro = proKey ? (await papi(proKey, 'GET', `/api/pro/appointments?id=${encodeURIComponent(id)}`)).json.items?.[0] : null;
  const adm = (await papi('admin', 'GET', `/api/pro/appointments?id=${encodeURIComponent(id)}`)).json.items?.[0];
  const row = (await db(`SELECT status FROM "ProAppointment" WHERE id = $1`, [id]))[0];
  return { citizen: mine.state, pro: pro?.status, admin: adm?.status, row: row.status, proKey, notices: adm?.notices || [] };
};

test('cross-surface fr: request → accepted → moved → accepted → cancelled by the person — the same state on the three sides and in the rows at every step', async ({ browser }) => {
  client = await person(browser);
  const page = await client.context.newPage();
  await citizenSignIn(page, CREDS.citizens.client, '/compte');
  const slots = await allSlots(client, SVC_APPROVAL, { windows: 2 });
  const r = await book(client, SVC_APPROVAL, pickSlot(slots, { nth: 4 }).startAt);
  expect(r.status).toBe(201); S.id = r.json.id;
  let s = await sides(S.id);
  expect(s).toMatchObject({ citizen: 'REQUESTED', pro: 'requested', admin: 'requested', row: 'requested' });
  await expectNotice(S.id, 'REQUEST_RECEIVED', 'citizen'); await expectNotice(S.id, 'REQUEST_RECEIVED', 'structure', 'in_app');
  expect((await proNotices(S.id)).some((n) => n.type === 'rdv_request_received')).toBe(true);
  // the professional's agenda shows it as a request; the administrator's too (browser)
  const ap = await (await person(browser)).context.newPage();
  await proSignIn(ap, 'admin', { next: '/pro/rdv/agenda' });
  const card = ap.getByTestId('pro-agenda-detail').and(ap.locator(`[href="/pro/appointments/${encodeURIComponent(S.id)}"]`)).locator('xpath=ancestor::div[contains(@class,"md:justify-between")][1]');
  await expect(card.getByTestId('pro-agenda-accept')).toBeVisible();
  await card.getByTestId('pro-agenda-accept').click();
  await expect.poll(async () => (await sides(S.id)).row).toBe('confirmed');
  s = await sides(S.id);
  expect(s).toMatchObject({ citizen: 'CONFIRMED', pro: 'confirmed', admin: 'confirmed' });
  await expectNotice(S.id, 'REQUEST_ACCEPTED', 'citizen');
  await page.goto(`${BASE}/compte/rendez-vous`);
  await expect(page.getByTestId('rdv-item').filter({ hasText: CREDS.services.approval.name }).filter({ hasText: 'Confirmé' }).first()).toBeVisible();
  // attendance cannot be recorded before the start
  const early = await papi('admin', 'PATCH', `/api/pro/appointments?id=${encodeURIComponent(S.id)}`, { status: 'done' });
  expect(early.status).toBe(409); expect(early.json.code || early.json.error).toBe('ATTENDANCE_TOO_EARLY');
  // the person moves it: back to a request everywhere
  // (a time the assigned professional is free at: a slot taken for them answers 409 SLOT_TAKEN and the next one is tried)
  // (test fix 08/11/2026: every refused try is a write of the person, and the public write limit is 10/min per account and address — on days where many
  // listed times are already taken for the assigned professional, the tries ate the budget and the cancellation below got 429. The candidate times are
  // now the listed ones where that professional has no active appointment in the database; the product's own refusal is still checked when it happens.)
  const own = (await db(`SELECT "createdByProUserId" p FROM "ProAppointment" WHERE id = $1`, [S.id]))[0];
  const busy = (await db(`SELECT "startAt" s, "endAt" e FROM "ProAppointment" WHERE "createdByProUserId" = $1 AND id <> $2 AND status IN ('requested','confirmed')`, [own.p, S.id]))
    .map((r) => [new Date(r.s).getTime(), new Date(r.e).getTime()]);
  const durMs = (await db(`SELECT EXTRACT(EPOCH FROM ("endAt" - "startAt"))::int * 1000 ms FROM "ProAppointment" WHERE id = $1`, [S.id]))[0].ms;
  const freeForPro = slots.slice(7).filter((x) => { const st = new Date(x.startAt).getTime(); return !busy.some(([bs, be]) => st < be && st + durMs > bs); });
  expect(freeForPro.length, 'a listed time where the assigned professional is free').toBeGreaterThan(0);
  let mv; const tried = [];
  for (const x of freeForPro.slice(0, 5)) { mv = await client.api('POST', `/api/rdv/appointments/${S.id}/reschedule`, { startAt: x.startAt }); if (mv.status !== 409) break; tried.push(mv.json.code); }
  expect(mv.status, tried.join(',')).toBe(200);
  expect(tried.every((c) => c === 'SLOT_TAKEN')).toBe(true);
  s = await sides(S.id);
  expect(s).toMatchObject({ citizen: 'REQUESTED', pro: 'requested', admin: 'requested', row: 'requested' });
  await expectNotice(S.id, 'RESCHEDULED', 'citizen'); await expectNotice(S.id, 'RESCHEDULED', 'structure', 'in_app');
  const acc = await papi('admin', 'PATCH', `/api/pro/appointments?id=${encodeURIComponent(S.id)}`, { decision: 'ACCEPT', expectedStartAt: mv.json.startsAt });
  expect(acc.status).toBe(200);
  // the person cancels: cancelled everywhere, the structure told (ledger + console)
  const c = await client.api('POST', `/api/rdv/appointments/${S.id}/cancel`, {});
  expect(c.status).toBe(200);
  s = await sides(S.id);
  expect(s).toMatchObject({ citizen: 'CANCELLED', pro: 'cancelled', admin: 'cancelled', row: 'cancelled' });
  await expectNotice(S.id, 'CANCELLED_BY_CITIZEN', 'structure', 'in_app');
  expect((await proNotices(S.id)).some((n) => n.type === 'rdv_cancelled_by_citizen')).toBe(true);
  // the professional view lists the notices it holds (kinds and outcomes, never a text)
  const kinds = new Set(s.notices.map((n) => n.kind));
  for (const k of ['RESCHEDULED', 'CANCELLED_BY_CITIZEN', ...(HAS_0045 ? ['REQUEST_RECEIVED', 'REQUEST_ACCEPTED'] : [])]) expect(kinds.has(k), k).toBe(true);
  for (const n of await notices(S.id)) expect(['DELIVERED', 'PROVIDER_ACCEPTED', 'TEST_RECORDED', 'NOT_DELIVERED', 'NO_CONSENT', 'NO_RECIPIENT', 'FAILED']).toContain(n.status);
  await ap.close(); await page.close();
});

test('isolation: the witness structure (another organisation) cannot read or act on CDGG\'s appointment — by id, by URL, by decision, cancel, ICS or hours; another person cannot either', async ({ browser }) => {
  const slots = await allSlots(client, SVC_DIRECT, { windows: 1 });
  const r = await book(client, SVC_DIRECT, pickSlot(slots, { nth: 9 }).startAt);
  expect(r.status).toBe(201); S.victim = r.json.id;
  for (const k of ['temoinPro', 'temoinAdmin']) {
    const byId = await papi(k, 'GET', `/api/pro/appointments?id=${encodeURIComponent(S.victim)}`);
    expect([200, 404]).toContain(byId.status);
    expect(JSON.stringify(byId.json)).not.toContain(S.victim);
    const list = await papi(k, 'GET', '/api/pro/appointments?pageSize=50');
    expect((list.json.items || []).some((a) => a.id === S.victim)).toBe(false);
    expect((await papi(k, 'PATCH', `/api/pro/appointments?id=${encodeURIComponent(S.victim)}`, { status: 'no_show' })).status).toBe(404);
    expect((await papi(k, 'POST', '/api/pro/appointments/cancel', { id: S.victim })).status).toBe(404);
    const ics = await papi(k, 'GET', `/api/pro/appointments/ics?id=${encodeURIComponent(S.victim)}`);   // the ICS export is always the caller's own structure
    expect(ics.status).toBe(200); expect(ics.text).not.toContain(S.victim); expect(ics.text).not.toContain('CDGG');
  }
  expect((await papi('temoinAdmin', 'PUT', '/api/pro/rdv/hours', { memberId: CREDS.pros.p1.id, weekly: [], exceptions: [] })).status).toBe(404);
  expect((await papi('temoinAdmin', 'DELETE', `/api/pro/team?userId=${encodeURIComponent(CREDS.pros.p1.id)}`)).status).toBe(404);
  expect((await db(`SELECT status FROM "ProUser" WHERE id = $1`, [CREDS.pros.p1.id]))[0].status).toBe('active');
  // by URL in the witness professional's browser: nothing of CDGG's appointment is shown
  const wp = await (await person(browser)).context.newPage();
  await proSignIn(wp, 'temoinPro', { next: '/pro/rdv/agenda' });
  await wp.goto(`${BASE}/pro/appointments/${encodeURIComponent(S.victim)}`);
  await wp.waitForLoadState('networkidle').catch(() => {});
  await expect(wp.locator('main')).not.toContainText(CREDS.citizens.client.name);
  await expect(wp.getByTestId('pro-agenda-detail').and(wp.locator(`[href="/pro/appointments/${encodeURIComponent(S.victim)}"]`))).toHaveCount(0);
  await axe(wp, 'witness professional, foreign appointment URL');
  // another person
  other = await person(browser);
  const op = await other.context.newPage();
  await citizenSignIn(op, CREDS.citizens.second, '/compte');
  expect((await other.api('GET', `/api/rdv/appointments/${S.victim}`)).status).toBe(404);
  expect((await other.api('POST', `/api/rdv/appointments/${S.victim}/cancel`, {})).status).toBe(404);
  expect((await other.api('POST', `/api/rdv/appointments/${S.victim}/reschedule`, { startAt: pickSlot(slots, { nth: 10 }).startAt })).status).toBe(404);
  expect((await other.api('POST', `/api/rdv/appointments/${S.victim}/message/withdraw`, {})).status).toBe(404);
  await op.goto(`${BASE}/compte/rendez-vous`);
  await expect(op.getByTestId('compte-rdv')).toBeVisible();
  expect((await db(`SELECT status FROM "ProAppointment" WHERE id = $1`, [S.victim]))[0].status).toBe('confirmed');
  // anonymous: every booking route refuses
  const anon = await person(browser);
  for (const [m, p] of [['GET', '/api/rdv/appointments'], ['GET', `/api/rdv/appointments/${S.victim}`], ['POST', `/api/rdv/appointments/${S.victim}/cancel`], ['POST', '/api/rdv/appointments'], ['GET', '/api/pro/appointments'], ['GET', '/api/citizen/notifications']]) {
    const x = await anon.api(m, p, m === 'GET' ? undefined : { structureSlug: SLUG, serviceId: SVC_DIRECT, startAt: new Date().toISOString(), idempotencyKey: 'anon' });
    expect([401, 403], `${m} ${p}`).toContain(x.status);
  }
  await anon.context.close();
  await client.api('POST', `/api/rdv/appointments/${S.victim}/cancel`, {});
  await wp.close();
});

test('AuditLog of the whole run: no e-mail address, no name of a person, no free text of a message', async () => {
  const { rows, leaks } = await auditWithoutPersonalData(new Date(Date.now() - 6 * 3600_000), Object.values(CREDS.pros).map((p) => p.email));
  expect(rows.length).toBeGreaterThan(20);
  expect(leaks).toEqual([]);
  const msgs = await db(`SELECT count(*)::int n FROM "AuditLog" WHERE details::text ILIKE '%Motif fictif R47%'`);
  expect(msgs[0].n).toBe(0);
});
