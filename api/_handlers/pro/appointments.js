// @ts-nocheck
/**
 * GET|POST|PATCH /api/pro/appointments — the professional's appointments of their structure.
 * PKG-3 / B08: this route used to point to a GET-only list (full rows, including the citizen e-mail snapshot and the idempotency key), so the professional "new appointment"
 * screen (POST) could never succeed. It now serves the structure-scoped, column-filtered handler in ./appointments/index.js (pro auth, tenant rate limit, booking lock,
 * modality, recorded consent of the person). Kept as a file because the route table and contract tests name it.
 */
import handler from './appointments/index.js';

export default handler;
