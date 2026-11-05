/**
 * R45 — SYNTHETIC data for the LAB restore rehearsal and the purge readiness dry run (ENG-LR-7 / ENG-LR-9). Schema 0042 columns only (no guest column,
 * no 0045 notice kind). Every identifier starts with « r45- », every address is …@example.test, every text is a fixed placeholder: no real person, no
 * real content. Volumes are « realistic » for a restricted beta (hundreds of accounts, about a thousand appointments, thousands of audit rows), spread
 * over three years so that each retention step has rows on both sides of its cutoff.
 *
 * The caller passes a pg client connected to a LOCAL disposable database (the rehearsal scripts refuse anything else).
 */

/** the bulk volumes (also printed in the evidence: counts, never values) */
export const VOLUMES = Object.freeze({ structures: 12, prosPerStructure: 2, citizens: 300, appointmentsPerCitizen: 3, structureRecorded: 60, conversations: 200, auditRows: 3000 });

const STATUSES = ['confirmed', 'done', 'no_show', 'cancelled', 'refused', 'expired', 'requested', 'booked'];

/** @param {{ query: (q: string, p?: any[]) => Promise<any> }} c */
export async function seedRealistic(c) {
  const V = VOLUMES;
  const q = (/** @type {string} */ s, /** @type {any[]} */ p = []) => c.query(s, p);
  await q(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, is_pro_enabled, "updatedAt", "createdAt")
    SELECT 'r45-str-' || lpad(g::text, 2, '0'), 'Structure synthétique ' || g, 'r45-structure-' || g, 'association', '1 rue Synthétique', 'Strasbourg', '67000', true,
      ARRAY['accueil'], ARRAY['tout_public'], ARRAY['social'], true, now(), now() - interval '1000 days' FROM generate_series(1, $1) g`, [V.structures]);
  await q(`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt")
    SELECT 'r45-svc-' || lpad(g::text, 2, '0'), 'r45-str-' || lpad(g::text, 2, '0'), 'Permanence synthétique', 30, now() FROM generate_series(1, $1) g`, [V.structures]);
  await q(`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt", "createdAt")
    SELECT 'r45-pro-' || lpad(s::text, 2, '0') || '-' || k, 'test.pro+r45-' || s || '-' || k || '@example.test', 'synthetic-not-a-hash', CASE WHEN k = 1 THEN 'admin' ELSE 'agent' END,
      CASE WHEN s = 1 AND k = 2 THEN 'disabled' ELSE 'active' END, 'r45-str-' || lpad(s::text, 2, '0'), now() - (CASE WHEN s = 1 AND k = 2 THEN interval '400 days' ELSE interval '1 day' END), now() - interval '900 days'
    FROM generate_series(1, $1) s, generate_series(1, $2) k`, [V.structures, V.prosPerStructure]);
  // citizens: last sign-in spread over 3 years (some inactive > 24 months: report-only E7)
  await q(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt", "lastSeenAt")
    SELECT 'r45-c-' || lpad(g::text, 4, '0'), 'test.citizen+r45-' || g || '@example.test', 'synthetic-not-a-hash', now() - interval '1000 days',
      now() - interval '1000 days', now() - ((g % 37) * interval '25 days'), now() - ((g % 37) * interval '25 days') FROM generate_series(1, $1) g`, [V.citizens]);
  await q(`INSERT INTO "CitizenProfile" ("userId", "displayName", "preferredLanguage", "updatedAt", "createdAt")
    SELECT id, 'Personne synthétique', 'fr', now(), now() FROM "CitizenUser" WHERE id LIKE 'r45-c-%'`);
  // citizen appointments: statuses cycle, slots from 900 days ago to 30 days ahead; a message on one in three
  await q(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "beneficiaryPhone", notes, "createdByProUserId", "citizenUserId",
      "citizenEmailSnapshot", "cancelledAt", "createdAt", "updatedAt")
    SELECT 'r45-a-' || lpad(g::text, 4, '0') || '-' || k, 'r45-str-' || lpad((1 + (g + k) % $2)::text, 2, '0'), 'r45-svc-' || lpad((1 + (g + k) % $2)::text, 2, '0'),
      now() + ((30 - ((g * 7 + k * 131) % 930)) * interval '1 day'), now() + ((30 - ((g * 7 + k * 131) % 930)) * interval '1 day') + interval '30 minutes',
      ($3::text[])[1 + (g + k) % 8], 'Personne synthétique', NULL, CASE WHEN (g + k) % 3 = 0 THEN 'Message synthétique' ELSE NULL END,
      'r45-pro-' || lpad((1 + (g + k) % $2)::text, 2, '0') || '-1', 'r45-c-' || lpad(g::text, 4, '0'), 'test.citizen+r45-' || g || '@example.test',
      CASE WHEN ($3::text[])[1 + (g + k) % 8] = 'cancelled' THEN now() + ((30 - ((g * 7 + k * 131) % 930)) * interval '1 day') - interval '2 days' ELSE NULL END,
      now() + ((30 - ((g * 7 + k * 131) % 930)) * interval '1 day') - interval '10 days', now()
    FROM generate_series(1, $1) g, generate_series(1, $4) k`, [V.citizens, V.structures, STATUSES, V.appointmentsPerCitizen]);
  // appointments a structure recorded without a platform account (the structure's own record: separate, shared-controller step)
  await q(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", notes, "createdByProUserId", "createdAt", "updatedAt")
    SELECT 'r45-sa-' || lpad(g::text, 3, '0'), 'r45-str-' || lpad((1 + g % $2)::text, 2, '0'), 'r45-svc-' || lpad((1 + g % $2)::text, 2, '0'),
      now() - (g * 15) * interval '1 day', now() - (g * 15) * interval '1 day' + interval '30 minutes', 'done', 'Personne synthétique', 'Note de la structure (synthétique)',
      'r45-pro-' || lpad((1 + g % $2)::text, 2, '0') || '-1', now() - (g * 15 + 5) * interval '1 day', now() FROM generate_series(1, $1) g`, [V.structureRecorded, V.structures]);
  await q(`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status, "createdAt")
    SELECT 'r45-n-' || a.id, a.id, 'BOOKED_BY_STRUCTURE', 'citizen', 'email', 'NOT_DELIVERED', a."createdAt" FROM "ProAppointment" a WHERE a.id LIKE 'r45-a-%'`);
  await q(`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status, "createdAt")
    SELECT 'r45-n2-' || a.id, a.id, 'REMINDER_J1', 'citizen', 'email', 'NO_CONSENT', a."startAt" - interval '1 day' FROM "ProAppointment" a WHERE a.id LIKE 'r45-a-%' AND a.status IN ('confirmed', 'done', 'booked')`);
  // conversations with three messages each (citizen, structure, citizen)
  await q(`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "lastMessageAt", "createdAt", "updatedAt")
    SELECT 'r45-conv-' || a.id, a.id, a."structureId", a."citizenUserId", a."startAt" - interval '1 day', a."createdAt", now()
    FROM (SELECT * FROM "ProAppointment" WHERE id LIKE 'r45-a-%' AND status IN ('confirmed', 'done', 'booked', 'no_show') ORDER BY id LIMIT $1) a`, [V.conversations]);
  await q(`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", "senderCitizenUserId", "senderProUserId", body, "createdAt")
    SELECT 'r45-msg-' || c.id || '-' || k, c.id, CASE WHEN k = 2 THEN 'PRO' ELSE 'CITIZEN' END, CASE WHEN k = 2 THEN NULL ELSE c."citizenUserId" END,
      CASE WHEN k = 2 THEN 'r45-pro-' || substr(c."structureId", 9) || '-1' ELSE NULL END, 'Texte synthétique', c."createdAt" + k * interval '1 hour'
    FROM "RdvConversation" c, generate_series(1, 3) k WHERE c.id LIKE 'r45-conv-%'`);
  // consents: the 18+ declaration; a superseded analytics pair (old proof 3+ years); the booking-message consent of each message
  await q(`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision, created_at, collection_channel, guardian_involved, proof_level)
    SELECT 'r45-cl-age-' || u.id, 'r45-v1', 'r45-v1:AGE', 'CITIZEN_USER', u.id, 'AGE_DECLARATION_ADULT', true, u."createdAt", 'signup', false, 'EXPLICIT_CHECKBOX' FROM "CitizenUser" u WHERE u.id LIKE 'r45-c-%'`);
  await q(`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision, created_at, collection_channel, guardian_involved, proof_level)
    SELECT 'r45-cl-an' || k || '-' || u.id, 'r45-v1', 'r45-v1:ANALYTICS', 'CITIZEN_USER', u.id, 'AUDIENCE_MEASUREMENT', k = 1,
      now() - (CASE WHEN k = 1 THEN 1200 ELSE 10 + (substr(u.id, 7)::int % 300) END) * interval '1 day', 'settings', false, 'EXPLICIT_CHECKBOX'
    FROM "CitizenUser" u, generate_series(1, 2) k WHERE u.id LIKE 'r45-c-%'`);
  await q(`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision, created_at, collection_channel, guardian_involved, proof_level)
    SELECT 'r45-cl-msg-' || a.id, 'r43-e6-2026-11-04', 'r43-e6-2026-11-04:BOOKING_MESSAGE_TRANSMISSION:' || a.id, 'CITIZEN_USER', a."citizenUserId", 'BOOKING_MESSAGE_TRANSMISSION', true,
      a."createdAt", 'booking', false, 'EXPLICIT_CHECKBOX' FROM "ProAppointment" a WHERE a.id LIKE 'r45-a-%' AND a.notes IS NOT NULL`);
  // audit trail over two years (no IP in clear: ip_hash only)
  await q(`INSERT INTO "AuditLog" (id, action, actor, target, details, timestamp, actor_id, entity, entity_id, ip_hash)
    SELECT 'r45-al-' || g, (ARRAY['CITIZEN_LOGIN', 'APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'PRO_LOGIN', 'DSR_EXPORT_COMPLETED'])[1 + g % 5], 'synthetic', NULL,
      jsonb_build_object('synthetic', true), now() - (g % 730) * interval '1 day', 'r45-c-' || lpad((1 + g % $2)::text, 4, '0'), 'CitizenUser', 'r45-c-' || lpad((1 + g % $2)::text, 4, '0'),
      md5('r45-' || g) FROM generate_series(1, $1) g`, [V.auditRows, V.citizens]);
  await q(`INSERT INTO "ProAuditLog" (id, "createdAt", "proUserId", action, "entityType", "entityId", "structureId")
    SELECT 'r45-pal-' || g, now() - (g % 700) * interval '1 day', 'r45-pro-' || lpad((1 + g % $1)::text, 2, '0') || '-1', 'APPOINTMENT_VIEWED', 'ProAppointment', NULL,
      'r45-str-' || lpad((1 + g % $1)::text, 2, '0') FROM generate_series(1, 400) g`, [V.structures]);
  await q(`INSERT INTO "ProNotification" (id, "userId", "structureId", type, title, message, "createdAt")
    SELECT 'r45-pn-' || g, 'r45-pro-' || lpad((1 + g % $1)::text, 2, '0') || '-1', 'r45-str-' || lpad((1 + g % $1)::text, 2, '0'), 'NEW_BOOKING', 'Titre synthétique', 'Texte synthétique',
      now() - (g % 360) * interval '1 day' FROM generate_series(1, 240) g`, [V.structures]);
  await q(`INSERT INTO "PushSubscription" (id, "userId", "endpointHash", "subscriptionEncrypted", "pushHost", status, "failureCount", "lastSuccessAt", "lastFailureAt", "createdAt")
    SELECT 'r45-ps-' || g, 'r45-c-' || lpad(g::text, 4, '0'), md5('r45-ps-' || g), 'synthetic-sealed', 'push.example.test', CASE WHEN g % 3 = 0 THEN 'FAILING' ELSE 'ACTIVE' END, g % 3,
      now() - interval '90 days', CASE WHEN g % 3 = 0 THEN now() - (g % 60) * interval '1 day' ELSE NULL END, now() - interval '200 days' FROM generate_series(1, 60) g`);
  await q(`INSERT INTO "SupportRequest" (id, category, "messageEncrypted", status, "createdAt", "updatedAt", "closedAt")
    SELECT 'r45-sr-' || g, 'BOOKING', 'synthetic-sealed', CASE WHEN g % 2 = 0 THEN 'CLOSED' ELSE 'OPEN' END, now() - (g * 20) * interval '1 day', now(),
      CASE WHEN g % 2 = 0 THEN now() - (g * 20 - 5) * interval '1 day' ELSE NULL END FROM generate_series(1, 30) g`);
  await q(`INSERT INTO "SharedDiagnostic" (id, "createdAt", "expiresAt", situation, results, "viewCount", "ownerCitizenId", "privacySubjectId", "subjectType")
    SELECT 'r45-sd-' || g, now() - (g * 5) * interval '1 day', now() - (g * 5 - 7) * interval '1 day', '{"synthetic":true}'::jsonb, '{"synthetic":true}'::jsonb, 0,
      'r45-c-' || lpad(g::text, 4, '0'), 'r45-c-' || lpad(g::text, 4, '0'), 'CITIZEN_USER' FROM generate_series(1, 40) g`);
  await q(`INSERT INTO "ProCase" (id, "sharedDiagnosticId", "structureId", status, "openedAt", "updatedAt")
    SELECT 'r45-pc-' || g, 'r45-sd-' || g, 'r45-str-01', 'IN_PROGRESS', now() - (g * 5) * interval '1 day', now() FROM generate_series(30, 34) g`);
  await q(`INSERT INTO "ProCaseNote" (id, "caseId", "structureId", "authorProUserId", visibility, "bodyEncrypted", "createdAt")
    SELECT 'r45-pcn-' || g, 'r45-pc-' || g, 'r45-str-01', 'r45-pro-01-1', 'INTERNAL', 'synthetic-sealed', now() FROM generate_series(30, 34) g`);
  await q(`INSERT INTO "SharedDossierThread" (id, "sharedDiagnosticId", "structureId", "openedByProUserId", "createdAt", "lastMessageAt")
    SELECT 'r45-sdt-' || g, 'r45-sd-' || g, 'r45-str-02', 'r45-pro-02-1', now() - (g * 5) * interval '1 day', now() - (g * 5) * interval '1 day' FROM generate_series(36, 38) g`);
  await q(`INSERT INTO "SharedDossierMessage" (id, "threadId", "senderType", "senderProUserId", body, "createdAt")
    SELECT 'r45-sdm-' || g, 'r45-sdt-' || g, 'PRO', 'r45-pro-02-1', 'Texte synthétique', now() - (g * 5) * interval '1 day' FROM generate_series(36, 38) g`);
  // rights requests: open access requests, an active restriction, old completed ones; legal holds (active, released long ago)
  await q(`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "createdAt", "completedAt") VALUES
    ('r45-dsr-access-open', 'CITIZEN_USER', 'r45-c-0011', 'ACCESS', 'IN_REVIEW', 'HUMAN_REVIEW_REQUIRED', '[]', now() - interval '5 days', NULL),
    ('r45-dsr-restrict', 'CITIZEN_USER', 'r45-c-0012', 'RESTRICT', 'ACTIVE', 'HUMAN_REVIEW_REQUIRED', '[]', now() - interval '40 days', NULL),
    ('r45-dsr-access-old', 'CITIZEN_USER', 'r45-c-0013', 'ACCESS', 'COMPLETED', 'AUTOMATED', '[]', now() - interval '1500 days', now() - interval '1490 days'),
    ('r45-dsr-delete-old', 'CITIZEN_USER', 'r45-gone-0001', 'DELETE', 'COMPLETED', 'HUMAN_REVIEW_REQUIRED', '["CitizenProfile"]', now() - interval '500 days', now() - interval '480 days')`);
  await q(`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision, created_at, collection_channel, guardian_involved, proof_level)
    VALUES ('r45-cl-gone', 'r45-v1', 'r45-v1:AGE', 'CITIZEN_USER', 'r45-gone-0001', 'AGE_DECLARATION_ADULT', true, now() - interval '900 days', 'signup', false, 'EXPLICIT_CHECKBOX')`);
  await q(`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt", "releasedAt", "releaseProposedBy", "releasedBy") VALUES
    ('r45-lh-active-1', 'CitizenUser', 'r45-c-0014', 'SYNTHETIC_LITIGATION', 'r45-admin-1', 'ACTIVE', now() - interval '60 days', NULL, NULL, NULL),
    ('r45-lh-active-2', 'Structure', 'r45-str-03', 'SYNTHETIC_LITIGATION', 'r45-admin-1', 'ACTIVE', now() - interval '60 days', NULL, NULL, NULL),
    ('r45-lh-released', 'CitizenUser', 'r45-c-0015', 'SYNTHETIC_LITIGATION', 'r45-admin-1', 'RELEASED', now() - interval '900 days', now() - interval '700 days', 'r45-admin-1', 'r45-admin-2')`);
  // operational tables
  await q(`INSERT INTO "EntityVersion" (id, entity_type, entity_id, snapshot_json, reason, "createdAt")
    SELECT 'r45-ev-' || g || '-' || k, 'Structure', 'r45-str-' || lpad((1 + g % $1)::text, 2, '0'), '{"synthetic":true}'::jsonb, 'update', now() - (k * 100 + g) * interval '1 day'
    FROM generate_series(1, 20) g, generate_series(1, 3) k`, [VOLUMES.structures]);
  await q(`INSERT INTO "UpdateLog" (ran_at, status, items_fetched_count, items_created_count, items_updated_count, items_skipped_count, errors, source_name, is_dry_run)
    SELECT now() - g * interval '3 days', 'success', 1, 0, 0, 1, ARRAY[]::text[], 'synthetic', false FROM generate_series(1, 80) g`);
  await q(`INSERT INTO "ConversationLog" (id, "createdAt", message, intent, "sourceCount", "sessionId")
    SELECT 'r45-cv-' || g, now() - g * interval '2 days', 'Question synthétique', 'search', 0, 'r45-sess-' || g FROM generate_series(1, 120) g`);
  await q(`INSERT INTO "AiMetric" (id, type, model, "createdAt") SELECT 'r45-aim-' || g, 'chat', 'synthetic-model', now() - g * interval '2 days' FROM generate_series(1, 120) g`);
  await q(`INSERT INTO "AuthToken" (id, "userId", type, "tokenHash", "expiresAt", "createdAt")
    SELECT 'r45-at-' || g, 'r45-c-' || lpad(g::text, 4, '0'), 'EMAIL_VERIFY', md5('r45-at-' || g), now() + (g - 25) * interval '1 day', now() - interval '30 days' FROM generate_series(1, 50) g`);
  await q(`INSERT INTO "Invitation" (id, "structureId", email, role, token, expires_at, "createdAt")
    SELECT 'r45-inv-' || g, 'r45-str-' || lpad((1 + g % $1)::text, 2, '0'), 'test.invite+r45-' || g || '@example.test', 'agent', md5('r45-inv-' || g), now() - (g * 10) * interval '1 day', now() - (g * 10 + 7) * interval '1 day'
    FROM generate_series(1, 10) g`, [VOLUMES.structures]);
  return countAll(c);
}

/** the tables the evidence counts (rows only) */
export const COUNTED = Object.freeze(['Structure', 'ProRdvService', 'ProUser', 'CitizenUser', 'CitizenProfile', 'ProAppointment', 'AppointmentNotice', 'RdvConversation', 'RdvConversationMessage',
  'ConsentLog', 'AuditLog', 'ProAuditLog', 'ProNotification', 'PushSubscription', 'SupportRequest', 'SharedDiagnostic', 'ProCase', 'ProCaseNote', 'SharedDossierThread', 'SharedDossierMessage',
  'DSRRequest', 'LegalHold', 'EntityVersion', 'UpdateLog', 'ConversationLog', 'AiMetric', 'AuthToken', 'Invitation']);

/** row counts of every public table (counts only) @param {{ query: Function }} c @returns {Promise<Record<string, number>>} */
export async function countAll(c) {
  const tables = (await c.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows.map((r) => r.t);
  /** @type {Record<string, number>} */ const out = {};
  for (const t of tables) out[t] = Number((await c.query(`SELECT count(*)::int AS n FROM "${t.replace(/"/g, '')}"`)).rows[0].n);
  return out;
}
