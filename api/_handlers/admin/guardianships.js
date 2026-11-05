// @ts-nocheck
import { eq } from 'drizzle-orm';
import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { requireCapability } from '../../_utils/capabilities.js';
import { db } from '../../../src/db/index.js';
import { AuditLog, CitizenProfile, CitizenUser, GuardianRelationship } from '../../../src/db/schema.js';
import { appendConsent } from '../../_services/citizen-account.js';
import { drizzleGuardianStore, loadGuardianPolicy, recordStrongVerification } from '../../_services/guardianship.js';

/**
 * R46 / C05 — the verifier's side of the guardian state machine (api/_services/guardianship.js): the strong check of a minor ↔ guardian link is recorded by
 * an administrator, never by the two people themselves.
 *   POST /api/admin/guardianships { action: 'list' }                         links waiting for the strong check (id, since) + the policy's allowed methods
 *   POST /api/admin/guardianships { action: 'record', id, method, reason }    STRONGER_VERIFICATION_REQUIRED → VERIFIED_STRONG with a method the policy allows
 * Named administrator session with MFA (adminGate write). No e-mail, name or account identifier of either person is returned. The reason (10–500 characters)
 * goes to the AuditLog row (« guardian.strong_verification_recorded »), the consent ledger gets the transition (guardianship.js). While the DPO has not
 * configured ADA_AGE_POLICY_JSON.guardianVerification, no method is allowed and every record answers POLICY_PENDING (fail-closed).
 * Capability citizen.guardians (closed outside the LAB until the AIPD extension).
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!requireCapability(res, 'citizen.guardians')) return undefined;
  const auth = await adminGate(req, res, { write: true }); if (!auth) return undefined;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const policy = loadGuardianPolicy();
    if (body.action === 'list') {
      const rows = await db.select({ id: GuardianRelationship.id, createdAt: GuardianRelationship.createdAt }).from(GuardianRelationship)
        .where(eq(GuardianRelationship.status, 'STRONGER_VERIFICATION_REQUIRED')).limit(200);
      return res.status(200).json({ pending: rows, policy: { strongVerification: policy.strongMethods.length ? 'CONFIGURED' : 'POLICY_PENDING', methods: policy.strongMethods } });
    }
    if (body.action !== 'record') return res.status(400).json({ error: 'invalid_action', message: 'action : « list » ou « record ».' });
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 10 || reason.length > 500 || /[<>]/.test(reason)) {
      return res.status(400).json({ error: 'reason_required', message: 'Indiquez comment la vérification a été faite (10 à 500 caractères, texte simple).' });
    }
    const store = drizzleGuardianStore(db, { GuardianRelationship, CitizenUser, CitizenProfile }, appendConsent);
    const out = await recordStrongVerification({ verifierId: String(auth.email), isVerifier: true }, body.id, { method: String(body.method || '') }, store);
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    await db.insert(AuditLog).values({ action: 'guardian.strong_verification_recorded', actor: String(auth.email), actor_id: String(auth.email), entity: 'GuardianRelationship',
      entity_id: out.guardianship.id, details: { method: String(body.method), reason } });
    return res.status(200).json({ guardianship: out.guardianship });
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.code || error?.cause?.code } }, '[admin/guardianships] failed');
    return res.status(500).json({ error: 'GUARDIANSHIPS_FAILED' });
  }
}
