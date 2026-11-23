// @ts-check
/**
 * G14-PS (owner decision 23/11/2026: « we do not host health data and we pay nothing ») — the rules of the SOCIAL referral (« orientation sociale »):
 * a limited, non-HDS orientation between two verified, active organisations that are NOT medico-social or health establishments, with the person's consent.
 *
 * What makes it non-HDS BY CONSTRUCTION (deterministic, checked by the server before any database write):
 *   1. CLOSED reasons only (SOCIAL_REASONS, 1 to 3 codes): practical social needs. None names or lets one infer health, disability, addiction, sexual life
 *      (RGPD art. 9), an offence (art. 10) or a situation of reinforced protection (right of residence, violence, child protection, legal protection of
 *      adults, extreme precariousness / emergency housing) — the SAME exclusion list as the limited Mon Parcours (data/reference/parcours-step-types.v1.json
 *      `excluded`, groups A, B and C). Every label is also run through the G8 sensitive-words guard at load time (api/lib/parcours-sensitivity.js).
 *   2. NO free text and NO document anywhere: the request contract (socialReferralRequestRefusal) refuses every field that is not on the list of its action
 *      (400 FIELD_NOT_ALLOWED, the names only — never the values). Decline motives are closed codes too.
 *   3. Only organisations positively classified NOT_ESSMS (socialReferralStructureClass): active, identity-verified, WITHOUT a FINESS number or FINESS
 *      category (a FINESS registration = an authorised medico-social or health establishment), whose `type_structure` is one of the reviewed non-medical kinds
 *      below and whose name and kind do not trip the sensitive-words guard. Unknown kind = refused (fail closed), exactly like `hdsDependsOnStructure`.
 * The HDS referral of a dossier (`pro.referrals`, api/_services/referrals.js) is untouched and stays closed until certified hosting exists.
 * Residual limit (stated in the report, [REVUE JURIDIQUE]): an association record without a FINESS number may still manage an ESSMS elsewhere; the kind
 * list is a proposal to review, and no reviewed per-structure classification table exists yet.
 */
import { sensitiveTextCategories } from './parcours-sensitivity.js';

/** the closed reasons — code → French label (the interface translates the code; the label is the canonical wording) */
export const SOCIAL_REASONS = Object.freeze({
  HOUSING: 'Logement (recherche, maintien, démarches de logement)',
  EMPLOYMENT: 'Emploi et insertion professionnelle',
  TRAINING: 'Formation et apprentissage',
  INCOME_BUDGET: 'Ressources et budget',
  ENERGY: 'Énergie et factures du quotidien',
  ADMIN_PROCEDURES: 'Démarches administratives',
  ACCESS_TO_RIGHTS: 'Accès aux droits sociaux',
  MOBILITY: 'Mobilité et transport',
  DIGITAL: 'Accompagnement numérique',
  FOOD: 'Alimentation (aide alimentaire)',
});
export const SOCIAL_REASON_CODES = Object.freeze(Object.keys(SOCIAL_REASONS));
export const MAX_REASONS = 3;

/** the closed motives of a decline */
export const SOCIAL_DECLINE_CODES = Object.freeze(['OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'OUT_OF_TERRITORY']);

/** the excluded categories — the same groups as the limited Mon Parcours (shown to the professional; nothing is stored) */
export const SOCIAL_EXCLUDED_TOPICS = Object.freeze([
  'santé, handicap, perte d’autonomie, addiction, grossesse, vie sexuelle (RGPD art. 9)',
  'infractions, condamnations, procédures pénales (RGPD art. 10)',
  'droit au séjour, asile, naturalisation',
  'violences subies',
  'aide sociale à l’enfance, protection de l’enfance',
  'protection juridique des majeurs (tutelle, curatelle)',
  'précarité extrême, hébergement d’urgence',
]);

export const STATUSES = Object.freeze(['PENDING_CITIZEN', 'SENT', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED', 'WITHDRAWN', 'EXPIRED', 'CLOSED']);
/** states in which the referral still lives (the receiver may see the contact the person chose to share only in SENT / ACCEPTED) */
export const LIVE_STATUSES = Object.freeze(['PENDING_CITIZEN', 'SENT', 'ACCEPTED']);
export const TERMINAL_STATUSES = Object.freeze(['DECLINED', 'COMPLETED', 'CANCELLED', 'WITHDRAWN', 'EXPIRED', 'CLOSED']);
/** states the person can withdraw from (after consent) */
export const WITHDRAWABLE = Object.freeze(['SENT', 'ACCEPTED']);
export const CONSENT_CHANNELS = Object.freeze(['MON_ESPACE', 'ASSISTED_ON_SCREEN']);

/** delays (days) */
export const CLAIM_CODE_DAYS = 14;            // an unclaimed / undecided proposal expires (nothing was shared)
export const ANSWER_DAYS = 10;                // the receiver's answer is due 10 days after the person's consent (one in-app reminder)
export const EXPIRE_AFTER_DUE_DAYS = 14;      // no answer 14 days after the due date: EXPIRED (the contact is no longer shown)
export const ACCEPTED_IDLE_CLOSE_DAYS = 180;  // accepted, nothing recorded for 180 days: CLOSED by the system (no outcome is claimed)

/** the consent wording (French canonical; version recorded in ConsentLog) [PROPOSITION — À VALIDER PAR LE RESPONSABLE DE TRAITEMENT] */
export const SOCIAL_REFERRAL_CONSENT_PURPOSE = 'SOCIAL_REFERRAL';
export const SOCIAL_REFERRAL_CONSENT_VERSION = 'g14-ps-2026-11-23-draft';
export const SOCIAL_REFERRAL_CONSENT_TEXT = 'J’accepte que la structure qui m’accompagne m’oriente vers la structure indiquée, pour le ou les motifs affichés. '
  + 'Seuls ces motifs et les coordonnées que je choisis sont transmis. Aucun document et aucune information de santé ne sont transmis. '
  + 'Je peux retirer mon accord à tout moment depuis Mon Espace.';

/* ---------------------------------------------------------------------------------------------------------------- structure classification */

/** fold: lower case, no accents, apostrophes unified */
const fold = (/** @type {unknown} */ s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Reviewed non-medical kinds (folded `type_structure` prefixes) [PROPOSITION — À REVOIR]. Includes the Mon Parcours structure kinds (mairie, CCAS, France
 * Services, maison des solidarités, mission locale, France Travail, Caf, CIO, information jeunesse) plus associations, centres sociaux, housing bodies, ADIL,
 * digital help points, food aid and budget advice. CPAM / assurance maladie are NOT listed (health insurance), nor any FINESS category.
 */
export const NON_ESSMS_KINDS = Object.freeze([
  'mairie', 'ccas', "centre communal d'action sociale", 'centre intercommunal d\'action sociale', 'cias', 'espace france services', 'france services',
  'maison des solidarites', 'mission locale', 'france travail', 'caf', "caisse d'allocations familiales", 'cio', 'information jeunesse',
  'association', 'centre social', 'espace de vie sociale', 'bailleur social', 'office public de l\'habitat', 'organisme hlm', 'adil',
  'point d\'accueil numerique', 'conseiller numerique', 'epicerie sociale', 'epicerie solidaire', 'banque alimentaire', 'point conseil budget', 'service public',
]);
/** folded words in a kind that always mean medico-social / health / protected (checked before the allow list) */
const ESSMS_WORDS = /(?:^| )(ehpad|ssiad|esat|ime|itep|sessad|savs|samsah|camsp|cmpp?|csapa|caarud|chrs|cada|huda|mecs|lhss|lam|mdph|pmi|cpam|ars|hopital|clinique|sante|medic\w*|soins?|handicap\w*|psych\w*|addicto\w*|hebergement|foyer|mandataire|mjpm|tutel\w*|curatel\w*|aide sociale a l'enfance|protection de l'enfance|victimes?|spip|pjj|etablissement|residence)(?= |$)/;

/**
 * The classification of a Structure row for the social referral. Returns { category, reason } — only `NOT_ESSMS` may send or receive.
 * @param {{ statut?: string | null, verification_status?: string | null, numero_finess?: string | null, type_finess?: string | null, type_structure?: string | null, nom?: string | null } | null | undefined} s
 * @returns {{ category: 'NOT_ESSMS' | 'ESSMS_OR_HEALTH' | 'UNKNOWN' | 'INELIGIBLE', reason: string | null }}
 */
export function socialReferralStructureClass(s) {
  if (!s) return { category: 'INELIGIBLE', reason: 'NOT_FOUND' };
  if (s.statut !== 'actif' || s.verification_status !== 'VERIFIED') return { category: 'INELIGIBLE', reason: 'NOT_VERIFIED_ACTIVE' };
  if (String(s.numero_finess ?? '').trim() || String(s.type_finess ?? '').trim()) return { category: 'ESSMS_OR_HEALTH', reason: 'FINESS_REGISTERED' };
  const kind = fold(s.type_structure);
  const plain = kind.replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (ESSMS_WORDS.test(plain) || sensitiveTextCategories(String(s.type_structure ?? '')).length) return { category: 'ESSMS_OR_HEALTH', reason: 'SENSITIVE_KIND' };
  if (sensitiveTextCategories(String(s.nom ?? '')).length) return { category: 'ESSMS_OR_HEALTH', reason: 'SENSITIVE_NAME' };
  if (!plain || !NON_ESSMS_KINDS.some((k) => plain === k || plain.startsWith(`${k} `) || plain.startsWith(`${k}(`))) return { category: 'UNKNOWN', reason: 'KIND_NOT_REVIEWED' };
  return { category: 'NOT_ESSMS', reason: null };
}

/* ---------------------------------------------------------------------------------------------------------------- request contract */

/** the fields each action accepts (action included). There is no free-text field and no file field in any of them. */
export const PRO_POST_FIELDS = Object.freeze({
  propose: ['action', 'toStructureId', 'reasonCodes', 'idempotencyKey'],
  accept: ['action', 'id'],
  decline: ['action', 'id', 'responseCode'],
  complete: ['action', 'id'],
  cancel: ['action', 'id'],
  new_code: ['action', 'id'],
  // the person consents ON THE PROFESSIONAL'S SCREEN, re-authenticating with their own account (never stored, never shown to the professional)
  assisted_consent: ['action', 'id', 'email', 'password', 'decision', 'shareEmail', 'sharePhone'],
});
export const PRO_GET_QUERY = Object.freeze(['box', 'id', 'receivers']);
export const CITIZEN_POST_FIELDS = Object.freeze({
  claim: ['action', 'code'],
  decide: ['action', 'id', 'decision', 'shareEmail', 'sharePhone'],
  withdraw: ['action', 'id'],
});
export const CITIZEN_GET_QUERY = /** @type {readonly string[]} */ (Object.freeze([]));

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** claim code: 10 characters of an unambiguous alphabet, optionally grouped with « - » or spaces */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normaliseCode = (/** @type {unknown} */ v) => String(v ?? '').toUpperCase().replace(/[\s-]+/g, '');
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{10}$`);

const bad = (/** @type {string} */ code, /** @type {string} */ message, status = 400) => ({ ok: false, status, code, message });
const notAllowed = (/** @type {string[]} */ fields) => bad('FIELD_NOT_ALLOWED', `Champ non accepté par l’orientation sociale : ${fields.join(', ')}.`);
const plain = (/** @type {unknown} */ v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const boolOrAbsent = (/** @type {unknown} */ v) => v === undefined || typeof v === 'boolean';

/**
 * The shape check of one request (both sides). Returns null when the request may go on, else the refusal. Meaning (does the structure qualify, is the
 * referral the caller's) is checked by the service.
 * @param {'pro' | 'citizen'} side @param {{ method: string, body?: unknown, query?: Record<string, unknown> }} req
 */
export function socialReferralRequestRefusal(side, { method, body, query }) {
  if (method === 'GET') {
    const allowedQ = side === 'pro' ? PRO_GET_QUERY : CITIZEN_GET_QUERY;
    const extra = Object.keys(query || {}).filter((k) => !allowedQ.includes(k));
    if (extra.length) return notAllowed(extra);
    const q = query || {};
    if (q.id !== undefined && (typeof q.id !== 'string' || !ID_RE.test(q.id))) return bad('INVALID_ID', 'Identifiant invalide.');
    if (q.box !== undefined && !['inbox', 'outbox'].includes(String(q.box))) return bad('INVALID_BOX', 'Liste inconnue.');
    if (q.receivers !== undefined && (typeof q.receivers !== 'string' || q.receivers.length > 60)) return bad('INVALID_QUERY', 'Tapez au plus 60 caractères.');
    return null;
  }
  if (method !== 'POST') return bad('METHOD_NOT_ALLOWED', 'Méthode non acceptée.', 405);
  if (!plain(body)) return bad('INVALID_BODY', 'Requête invalide.');
  const b = /** @type {Record<string, unknown>} */ (body);
  const table = /** @type {Record<string, readonly string[]>} */ (side === 'pro' ? PRO_POST_FIELDS : CITIZEN_POST_FIELDS);
  const action = typeof b.action === 'string' ? b.action : '';
  const allowed = table[action];
  if (!allowed) return bad('INVALID_ACTION', 'Action inconnue.');
  const extra = Object.keys(b).filter((k) => !allowed.includes(k));
  if (extra.length) return notAllowed(extra);
  if (action === 'propose') {
    if (typeof b.toStructureId !== 'string' || !ID_RE.test(b.toStructureId)) return bad('INVALID_RECEIVER', 'Choisissez la structure qui reçoit l’orientation.');
    const codes = b.reasonCodes;
    if (!Array.isArray(codes) || codes.length < 1 || codes.length > MAX_REASONS || new Set(codes).size !== codes.length
      || codes.some((c) => typeof c !== 'string' || !SOCIAL_REASON_CODES.includes(c))) return bad('INVALID_REASON', `Choisissez de 1 à ${MAX_REASONS} motifs dans la liste.`);
    if (b.idempotencyKey !== undefined && (typeof b.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(b.idempotencyKey))) return bad('INVALID_KEY', 'Clé invalide.');
    return null;
  }
  if (action === 'claim') return typeof b.code === 'string' && CODE_RE.test(normaliseCode(b.code)) ? null : bad('INVALID_CODE', 'Le code fait 10 caractères.');
  if (typeof b.id !== 'string' || !ID_RE.test(b.id)) return bad('INVALID_ID', 'Identifiant invalide.');
  if (action === 'decline' && (typeof b.responseCode !== 'string' || !SOCIAL_DECLINE_CODES.includes(b.responseCode))) return bad('INVALID_RESPONSE', 'Choisissez le motif dans la liste.');
  if (action === 'decide' || action === 'assisted_consent') {
    if (!['accept', 'refuse'].includes(String(b.decision))) return bad('INVALID_DECISION', 'Répondez par accepter ou refuser.');
    if (!boolOrAbsent(b.shareEmail) || !boolOrAbsent(b.sharePhone)) return bad('INVALID_SHARE', 'Choix des coordonnées invalide.');
  }
  if (action === 'assisted_consent' && (typeof b.email !== 'string' || b.email.length > 254 || typeof b.password !== 'string' || !b.password || b.password.length > 256)) {
    return bad('INVALID_CREDENTIALS', 'Adresse e-mail ou mot de passe invalide.', 403);
  }
  return null;
}

/** load-time guard (defence in depth): no reason label may trip the sensitive-words guard — throws, so the module fails closed */
export function assertReasonsNotSensitive(reasons = SOCIAL_REASONS) {
  for (const [code, label] of Object.entries(reasons)) {
    if (sensitiveTextCategories(label).length || sensitiveTextCategories(code.replace(/_/g, ' ')).length) throw new Error(`social referral reason ${code} reveals a sensitive category`);
  }
  return true;
}
assertReasonsNotSensitive();
