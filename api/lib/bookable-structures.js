// @ts-check
/**
 * G14-FIND (owner 23/11/2026, « find and book ») — which directory places can really be asked for an appointment online NOW, as ONE SQL predicate on a
 * "Structure" row, so the Annuaire filter « Rendez-vous en ligne » and its badge are computed server side, paginated, without one query per place.
 *
 * A place is bookable online when ALL of these hold — the same gates as the booking routes (api/_handlers/rdv.js), never weaker:
 *   1. booking is open on this deployment (the « appointments » surface, and « accounts » since a request needs a citizen account — R42 / R47 F1);
 *   2. its booking setup is published (StructureRdvSettings.isPublished, else the legacy is_pro_enabled flag: loadStructureBySlug);
 *   3. the organisation is active AND identity-verified (api/_utils/org-eligibility.js orgVerifiedActiveSql);
 *   4. at least one ACTIVE service whose sensitivity an administrator REVIEWED as « ordinary » (api/lib/service-sensitivity.js): a sensitive service
 *      needs the separate art. 9 consent and an unreviewed one is refused wherever the review is enforced (Production) — neither earns the badge;
 *   5. that service is offered in a modality the structure offers (bookingMode) — VIDEO only while the video capability is open (offeredModes);
 *   6. an ACTIVE opening period of the structure serves that modality (ProAvailabilityRule.modes: rulesFor), i.e. the agenda can produce slots;
 *   7. with team choice on, at least one active, MFA-enabled professional of the structure takes bookings for that service (rdv-team candidatesFor).
 * The D-5 public visibility of the record (visibleSql) is applied by the caller's list query.
 *
 * Limit (said, not hidden): this is a property of the published agenda, not a slot computation. A place whose every slot of the next 14 days is
 * already taken or closed by an absence keeps the badge; its page (GET /api/rdv/structures/:slug/profile) states the real first free day.
 */
import { sql } from 'drizzle-orm';
import { isAllowedInPublicBeta, isPublicBetaRestricted } from '../_utils/public-beta.js';
import { publicVideoStatus } from './video-provider.js';

/** is online booking usable on this deployment (outside the beta, or with appointments AND the citizen booking path opened) @param {Record<string, string | undefined>} [env] */
export function bookingOpenOnServer(env = process.env) {
  if (!isPublicBetaRestricted(env)) return true;
  // reading the public booking profile (appointments) and creating an appointment as a signed-in citizen (appointments + accounts)
  return isAllowedInPublicBeta('GET', 'rdv/structures/x/profile', env) && isAllowedInPublicBeta('POST', 'rdv/appointments', env);
}

/**
 * The predicate on the row aliased `S` ("Structure" by default). `video`: whether the VIDEO modality is bookable now (publicVideoStatus().available).
 * @param {{ alias?: string, video?: boolean }} [opts]
 */
export function bookableStructureSql({ alias = 'Structure', video = false } = {}) {
  const S = sql.raw(`"${alias.replace(/[^A-Za-z0-9_]/g, '')}"`);
  const allowed = video ? sql`ARRAY['IN_PERSON', 'VIDEO']::text[]` : sql`ARRAY['IN_PERSON']::text[]`;
  // the structure's modalities (structureModes): BOTH → both, VIDEO → video, anything else (no row, IN_PERSON) → in person
  const structureModes = sql`(CASE rs."bookingMode"::text WHEN 'BOTH' THEN ARRAY['IN_PERSON', 'VIDEO']::text[] WHEN 'VIDEO' THEN ARRAY['VIDEO']::text[] ELSE ARRAY['IN_PERSON']::text[] END)`;
  const review = sql`(${S}.settings_json -> 'serviceSensitivity' -> 'services' -> svc.id)`;
  const team = sql`(${S}.settings_json -> 'rdvBooking' -> 'team')`;
  return sql`(${S}.statut = 'actif' AND ${S}.verification_status = 'VERIFIED'
    AND COALESCE((SELECT rs0."isPublished" FROM "StructureRdvSettings" rs0 WHERE rs0."structureId" = ${S}.id LIMIT 1), ${S}.is_pro_enabled, false) = true
    AND EXISTS (
      SELECT 1 FROM "ProRdvService" svc
        LEFT JOIN "StructureRdvSettings" rs ON rs."structureId" = svc."structureId"
        CROSS JOIN LATERAL unnest(CASE WHEN cardinality(svc.modes) > 0 THEN svc.modes ELSE ARRAY['IN_PERSON']::text[] END) AS m(mode)
      WHERE svc."structureId" = ${S}.id AND svc."isActive" = true
        AND m.mode = ANY(${structureModes}) AND m.mode = ANY(${allowed})
        AND ${review} ->> 'value' = 'ordinary'
        AND btrim(COALESCE(${review} ->> 'reviewedBy', '')) <> ''
        AND COALESCE(${review} ->> 'reviewedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}'
        AND EXISTS (SELECT 1 FROM "ProAvailabilityRule" r WHERE r."structureId" = ${S}.id AND r."isActive" = true AND (r.modes IS NULL OR m.mode = ANY(r.modes)))
        AND (COALESCE(${team} ->> 'enabled', 'false') <> 'true' OR EXISTS (
          SELECT 1 FROM "ProUser" u WHERE u."structureId" = ${S}.id AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN') AND u.mfa_enabled = true
            AND ${team} -> 'members' -> u.id ->> 'bookable' = 'true'
            AND (jsonb_typeof(${team} -> 'members' -> u.id -> 'serviceIds') IS DISTINCT FROM 'array'
              OR jsonb_array_length(${team} -> 'members' -> u.id -> 'serviceIds') = 0
              OR (${team} -> 'members' -> u.id -> 'serviceIds') @> jsonb_build_array(svc.id))))
    ))`;
}

/** the predicate with this deployment's video state @param {{ alias?: string }} [opts] @param {Record<string, string | undefined>} [env] */
export function bookableStructureSqlNow(opts = {}, env = process.env) {
  return bookableStructureSql({ ...opts, video: Boolean(publicVideoStatus(env).available) });
}
