/**
 * R45 integration (ENG-LR-2 × ENG-LR-3) — the real sensitivity resolver of the notifications about one appointment. It reads the VERIFIED classification of
 * the appointment's service (Structure.settings_json.serviceSensitivity, api/_services/service-sensitivity-review.js); anything else — no structure or
 * service id, a missing row, a read failure, an unreviewed service — is 'unknown', which api/lib/notification-privacy.js turns into the minimal message.
 * Thin records (e.g. { id, structureId, citizenUserId } from rdv-requests.js) are completed from ProAppointment by id. Never throws.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProAppointment } from '../../src/db/schema.js';
import { SENSITIVITY } from '../lib/service-sensitivity.js';
import { readServiceSensitivity } from './service-sensitivity-review.js';

/** @param {unknown} v */
const idOf = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** @param {any} record @param {any} [database] @returns {Promise<'sensitive' | 'ordinary' | 'unknown'>} */
export async function resolveAppointmentSensitivity(record, database = defaultDb) {
  try {
    if (!record || typeof record !== 'object') return SENSITIVITY.UNKNOWN;
    let structureId = idOf(record.structureId); let serviceId = idOf(record.serviceId);
    if ((!structureId || !serviceId) && idOf(record.id)) {
      const [row] = await database.select({ structureId: ProAppointment.structureId, serviceId: ProAppointment.serviceId })
        .from(ProAppointment).where(eq(ProAppointment.id, record.id)).limit(1);
      structureId = structureId || idOf(row?.structureId); serviceId = serviceId || idOf(row?.serviceId);
    }
    if (!structureId || !serviceId) return SENSITIVITY.UNKNOWN;
    return /** @type {any} */ (await readServiceSensitivity(structureId, serviceId, database));
  } catch {
    return SENSITIVITY.UNKNOWN;
  }
}
