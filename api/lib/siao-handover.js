/**
 * R46 / R22 — SI-SIAO interoperability: an HONEST DISCONNECTED adapter.
 *
 * No official interface specification of SI-SIAO (the national information system of the SIAO, operated for the State) is held in this repository, and no
 * operator convention exists. The former handler POSTed a home-made payload to `${SIAO_API_URL}/v2/demande` « DGCS standard 2.0 » — an endpoint and a format
 * nobody documented: it is removed. Until the owner obtains the official specification and the convention, ADA:
 *   - never calls any SIAO network service (status DISCONNECTED, reason NO_OFFICIAL_INTERFACE_SPEC);
 *   - prepares, for a dossier whose owner allowed THIS organization to pass the housing request to the SIAO (purpose PURP-07), a minimal handover sheet in
 *     ADA's own documented format `ada.siao-handover/1` — for the professional to enter in the operator's own tool through their existing access. It is
 *     labelled as ADA's format, never as the national standard;
 *   - carries a keyed pseudonym (never the dossier id), the postal code and the urgency stated by the person, the date of the dossier, and the list of
 *     elements the person did not state (never invented).
 * When a specification exists, a transport implements `transmit(handover)` behind `siaoAdapterStatus` (status CONNECTED) — not before.
 *
 * Format ada.siao-handover/1 (JSON, UTF-8):
 *   { format: 'ada.siao-handover/1', generatedAt: ISO-8601, transmission: 'MANUAL_BY_PROFESSIONAL',
 *     notice: string (French: not the national format, no automatic transmission),
 *     request: { reference: 'ADA-SIAO-<12 hex>', pseudonym: <24 hex>, postalCode: '67xxx' | null, urgent: boolean | null, dossierDate: ISO-8601 | null },
 *     missing: ('postalCode' | 'urgent')[], consent: { purpose: 'PURP-07', recordedFor: 'this organization' } }
 */
import crypto from 'node:crypto';

export const SIAO_HANDOVER_FORMAT = 'ada.siao-handover/1';
export const SIAO_PURPOSE = 'PURP-07';
export const SIAO_NOTICE = 'Fiche préparée par Accès Direct Aide dans son propre format (ada.siao-handover/1), qui n’est pas le format national SI-SIAO. Aucune transmission automatique : '
  + 'à saisir par le professionnel dans l’outil de l’opérateur du SIAO, avec ses propres accès, uniquement avec l’accord de la personne.';

/** the adapter state (no value, no secret) */
export function siaoAdapterStatus() {
  return { provider: 'si-siao', status: 'DISCONNECTED', reason: 'NO_OFFICIAL_INTERFACE_SPEC', transmission: 'MANUAL_BY_PROFESSIONAL', format: SIAO_HANDOVER_FORMAT };
}

/** keyed pseudonym of a dossier for the SIAO handover (stable per dossier, not reversible without the server secret) @param {string} shareId @param {string} secret */
export function siaoPseudonym(shareId, secret) {
  if (!secret) throw new Error('SIAO pseudonym key missing');
  const key = crypto.createHmac('sha256', String(secret)).update('ada:siao-handover:key:v1').digest();
  return crypto.createHmac('sha256', key).update(`siao:${shareId}`).digest('hex').slice(0, 24);
}

/**
 * @param {{ shareId: string, situation: unknown, createdAt?: Date | string | null, secret: string, now?: Date }} input
 */
export function buildSiaoHandover({ shareId, situation, createdAt, secret, now = new Date() }) {
  const s = situation && typeof situation === 'object' && !Array.isArray(situation) ? /** @type {Record<string, unknown>} */ (situation) : {};
  const postalCode = typeof s.zipCode === 'string' && /^\d{5}$/.test(s.zipCode) ? s.zipCode : null;
  const urgent = typeof s.isUrgent === 'boolean' ? s.isUrgent : null;
  const missing = /** @type {('postalCode' | 'urgent')[]} */ ([...(postalCode === null ? ['postalCode'] : []), ...(urgent === null ? ['urgent'] : [])]);
  const date = createdAt ? new Date(createdAt) : null;
  return {
    format: SIAO_HANDOVER_FORMAT,
    generatedAt: now.toISOString(),
    transmission: 'MANUAL_BY_PROFESSIONAL',
    notice: SIAO_NOTICE,
    request: {
      reference: `ADA-SIAO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      pseudonym: siaoPseudonym(shareId, secret),
      postalCode, urgent,
      dossierDate: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    },
    missing,
    consent: { purpose: SIAO_PURPOSE, recordedFor: 'this organization' },
  };
}

/** structural check of a handover document (used by the tests and by a future transport) @param {any} doc */
export function validateSiaoHandover(doc) {
  const problems = [];
  if (!doc || doc.format !== SIAO_HANDOVER_FORMAT) problems.push('format');
  if (doc?.transmission !== 'MANUAL_BY_PROFESSIONAL') problems.push('transmission');
  if (!/^ADA-SIAO-[0-9A-F]{12}$/.test(String(doc?.request?.reference))) problems.push('reference');
  if (!/^[0-9a-f]{24}$/.test(String(doc?.request?.pseudonym))) problems.push('pseudonym');
  if (doc?.request?.postalCode !== null && !/^\d{5}$/.test(String(doc?.request?.postalCode))) problems.push('postalCode');
  if (doc?.request?.urgent !== null && typeof doc?.request?.urgent !== 'boolean') problems.push('urgent');
  if (doc?.consent?.purpose !== SIAO_PURPOSE) problems.push('consent');
  const allowed = new Set(['format', 'generatedAt', 'transmission', 'notice', 'request', 'missing', 'consent']);
  if (doc && Object.keys(doc).some((k) => !allowed.has(k))) problems.push('extra-field');
  if (doc?.request && Object.keys(doc.request).some((k) => !['reference', 'pseudonym', 'postalCode', 'urgent', 'dossierDate'].includes(k))) problems.push('extra-request-field');
  return problems;
}
