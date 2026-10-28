/**
 * RETIRED (PKG-3, owner decision 2026-10-19: implement video securely). This unrouted legacy handler created a PUBLIC meet.jit.si room, e-mailed its link and logged the
 * room name. It is replaced by POST /api/pro/appointments/visio (api/_handlers/pro/appointments/visio.js): approval of a VIDEO appointment, room-bound time-bound tokens,
 * no link by e-mail, production OFF until approved. Kept only so the orphan-handler contract keeps its entry; it answers 410 and does nothing.
 * @param {import('../../../_utils/http-types').ApiRequest} _req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */
export default async function handler(_req, res) {
  return res.status(410).json({ error: 'GONE', message: 'Remplacé par /api/pro/appointments/visio.' });
}
