// @ts-check
import { HEALTH_CONSENT_VERSION_PROPOSED } from '@/config/legal-drafts';

/**
 * G14-R4b — is the health category of Mon Coffre usable here: announced by the HDS service (HDS_HEALTH_CATEGORY_ENABLED) with EXACTLY the consent text
 * version this build shows (HEALTH_CONSENT_VERSION_PROPOSED). Any other version, or none, = not offered (a consent is never asked for a text the page cannot show).
 * @param {{ enabled?: boolean, version?: string | null } | null | undefined} healthCategory
 */
export const healthCategoryOffered = (healthCategory) => Boolean(healthCategory?.enabled && healthCategory.version === HEALTH_CONSENT_VERSION_PROPOSED);
