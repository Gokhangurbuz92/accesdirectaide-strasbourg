// @ts-check
/**
 * D8 (owner decision 17/11/2026: Production restructuring DEFERRED, LAB analysis and adapters YES) — a READ-ONLY adapter that shows the one `Structure`
 * table as the target model of docs/vision/D8_ORGANISATION_ETABLISSEMENT_SERVICE_DESIGN.md: Organisation / Établissement / Service. Nothing here writes,
 * fetches or guesses: every value is read from what the record (and the duplicate register) already holds, with the basis it was derived from. An unknown
 * stays null. No schema change; current code keeps reading `Structure` as before.
 *
 *  - Organisation: the legal or operating body. Known only through an identifier the record carries: the SIREN (first 9 digits of a 14-digit SIRET, INSEE
 *    rule), the RNA number of an association, or — for a record the duplicate register put aside as « the same organisation » — the record it keeps. Without
 *    any of them the record is its own (unidentified) organisation: never merged on a name or an address.
 *  - Établissement: the record itself as a place (FINESS ET number, SIRET, Annuaire entry, address). Whether it is a reception site, a headquarters or a phone
 *    line is NOT derivable today (type_structure has no closed vocabulary — PKG-1 N2): reported as unknown, never guessed from a name. The FINESS EJ (legal
 *    entity) is NOT stored by the importers today: it is reported missing, never inferred.
 *  - Service: what is offered, with its origin — the authorised activities the register lists (`services`, FINESS), the services other platforms list
 *    (`services_externes`, data·inclusion, attributed to their producer, not verified by the State), and the bookable services of the organisation's ADA Pro
 *    space (ProRdvService). A FINESS activity is an authorisation, never a free place.
 */
import { sql } from 'drizzle-orm';

const digits = (/** @type {unknown} */ v) => String(v ?? '').replace(/\D+/g, '');
const alnum = (/** @type {unknown} */ v) => String(v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

/** the SIREN of a 14-digit SIRET (its first 9 digits), else null @param {unknown} siret */
export function sirenOf(siret) {
  const d = digits(siret);
  return d.length === 14 ? d.slice(0, 9) : null;
}

/**
 * Who the organisation of a record is, and on what basis. `keptId` / `keptSiret`: the record an ACTIVE SAME_ENTITY decision of the duplicate register keeps
 * instead of this one (and its SIRET), when there is one.
 * @param {{ id: string, siret?: string | null, rna_id?: string | null, keptId?: string | null, keptSiret?: string | null }} r
 * @returns {{ key: string, basis: 'SIREN' | 'RNA' | 'DUPLICATE_DECISION' | 'RECORD', siren: string | null, rna: string | null }}
 */
export function organisationOf(r) {
  const siren = sirenOf(r.keptId ? r.keptSiret : r.siret);
  if (siren) return { key: `siren:${siren}`, basis: 'SIREN', siren, rna: null };
  if (r.keptId) return { key: `id:${r.keptId}`, basis: 'DUPLICATE_DECISION', siren: null, rna: null };
  const rna = alnum(r.rna_id) || null;
  if (rna) return { key: `rna:${rna}`, basis: 'RNA', siren: null, rna };
  return { key: `id:${r.id}`, basis: 'RECORD', siren: null, rna: null };
}

/**
 * The contributor of a record's counts in the observatory (api/_services/territorial-stats.js): its organisation. The RNA is not used there (an association
 * record without SIRET stays its own contributor, as before D8): only SIREN and the duplicate register group records.
 * @param {{ id: string, siret?: string | null, keptId?: string | null, keptSiret?: string | null }} r
 */
export function contributorKey(r) {
  const o = organisationOf({ ...r, rna_id: null });
  return o.key;
}

/**
 * The record seen as an establishment. `address`: 'KNOWN' or 'NONE' (a record without a street address is no place to go to); `siteKind` stays null: the
 * reception / headquarters / phone-line classification needs the closed vocabulary that does not exist yet (never guessed from a free-text kind or a name).
 * @param {Record<string, any>} r a Structure row
 */
export function establishmentOf(r) {
  return {
    id: String(r.id),
    name: r.nom ?? null,
    kindText: r.type_structure ?? null,
    siteKind: null,
    addressState: String(r.adresse || '').trim() ? 'KNOWN' : 'NONE',
    address: { street: r.adresse ?? null, postalCode: r.code_postal ?? null, city: r.ville ?? null },
    identifiers: { siret: digits(r.siret).length === 14 ? digits(r.siret) : null, finessEt: alnum(r.numero_finess) || null, finessEj: null, annuaire: r.source_annuaire ?? null },
    missing: ['finessEj'],   // the importers do not keep the FINESS EJ number (the CSV connector does not extract it; verification/finess.js parses it from FINESS+ and nothing stores it)
  };
}

/**
 * The services of a record, each with its origin. Nothing is merged across origins and nothing is added.
 * @param {Record<string, any>} r a Structure row
 * @param {{ id: string, name: string, isActive?: boolean, modes?: string[] }[]} [bookable] the ProRdvService rows of the record (ADA Pro)
 */
export function servicesOf(r, bookable = []) {
  const out = [];
  const registered = Array.isArray(r.services) ? r.services.filter((s) => typeof s === 'string' && s.trim()) : [];
  const fromRegister = r.numero_finess ? 'FINESS_ACTIVITY' : 'DIRECTORY_TEXT';
  for (const label of registered) out.push({ origin: fromRegister, label, establishmentId: String(r.id), bookable: false });
  const ext = r.services_externes && Array.isArray(r.services_externes.services) ? r.services_externes.services : [];
  for (const s of ext) out.push({ origin: 'DATA_INCLUSION', label: s?.name ?? s?.nom ?? null, producer: s?.producerLabel ?? null, establishmentId: String(r.id), bookable: false });
  for (const s of bookable) if (s && s.isActive !== false) out.push({ origin: 'ADA_PRO', label: s.name, serviceId: s.id, modes: s.modes || [], establishmentId: String(r.id), bookable: true });
  return out;
}

/**
 * The model view of ONE record, read from the database (read-only). Unknown id → null.
 * @param {any} db a drizzle handle @param {string} id
 */
export async function structureModelView(db, id) {
  const [r] = (await db.execute(sql`SELECT s.*, k.id AS "keptId", k.siret AS "keptSiret" FROM "Structure" s
    LEFT JOIN LATERAL (SELECT p.id, p.siret FROM "StructureDuplicateDecision" dd JOIN "Structure" p ON p.id = dd."primaryId" WHERE dd."supersededAt" IS NULL AND dd.decision = 'SAME_ENTITY'
      AND (dd."structureA" = s.id OR dd."structureB" = s.id) AND dd."primaryId" <> s.id ORDER BY dd."decidedAt" DESC LIMIT 1) k ON TRUE
    WHERE s.id = ${String(id || '')}`)).rows;
  if (!r) return null;
  const bookable = (await db.execute(sql`SELECT id, name, "isActive", modes FROM "ProRdvService" WHERE "structureId" = ${r.id} ORDER BY name`)).rows;
  const organisation = organisationOf(r);
  // the other records that carry a SIRET of the same SIREN (same legal entity): names only, at most 50
  const siblings = organisation.siren
    ? (await db.execute(sql`SELECT id, nom FROM "Structure" WHERE id <> ${r.id} AND length(regexp_replace(coalesce(siret, ''), '\\D', '', 'g')) = 14
        AND left(regexp_replace(siret, '\\D', '', 'g'), 9) = ${organisation.siren} ORDER BY nom, id LIMIT 50`)).rows
    : [];
  return { organisation: { ...organisation, otherEstablishments: siblings.map((/** @type {any} */ x) => ({ id: x.id, name: x.nom })) }, establishment: establishmentOf(r), services: servicesOf(r, bookable) };
}
