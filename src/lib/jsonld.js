// @ts-nocheck
/**
 * JSON-LD Schema Utilities
 * 
 * Provides functions to generate structured data for SEO.
 * Follows schema.org specifications.
 */

const BASE_URL = 'https://www.accesdirectaide.fr';
const SITE_NAME = 'Accès Direct Aide';

/** @typedef {{ title: string, description: string, path: string, datePublished?: string, dateModified?: string }} WebPageSchemaOptions */
/** @typedef {{ titre: string, summary_falc?: string, contenu?: string, date_publication?: string, date_modification?: string, source_nom?: string, slug?: string }} ActualiteLike */
/** @typedef {{ type?: string, nom?: string, description?: string, resume_falc?: string, slug?: string, adresse?: string, ville?: string, code_postal?: string, telephone?: string, email?: string, site_web?: string }} StructureLike */
/** @typedef {{ titre?: string, summary_falc?: string, description?: string, theme?: string, organisme?: string, slug?: string, territoire?: string, public_cible?: string }} AideLike */
/** @typedef {{ titre?: string, description?: string, contenu?: string }} DemarcheStepLike */
/** @typedef {{ titre?: string, summary_falc?: string, description?: string, slug?: string, etapes?: DemarcheStepLike[] }} DemarcheLike */
/** @typedef {{ question: string, answer: string }} FaqItem */
/** @typedef {{ titre?: string, nom?: string, slug?: string }} ItemListEntry */
/** @typedef {{ name: string, description: string, items: ItemListEntry[], path: string }} ItemListSchemaOptions */

/**
 * Generate WebPage schema
 * @param {WebPageSchemaOptions} options - Page options
 * @returns {Object} JSON-LD schema
 */
export function generateWebPageSchema({ title, description, path, datePublished, dateModified }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": title,
    "description": description,
    "url": `${BASE_URL}${path}`,
    "inLanguage": "fr-FR",
    "isPartOf": {
      "@type": "WebSite",
      "name": SITE_NAME,
      "url": BASE_URL
    },
    ...(datePublished && { "datePublished": datePublished }),
    ...(dateModified && { "dateModified": dateModified }),
  };
}

/**
 * Generate Article schema (for Actualites)
 * @param {ActualiteLike} actualite - Actualite data
 * @returns {Object} JSON-LD schema
 */
export function generateArticleSchema(actualite) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": actualite.titre,
    "description": actualite.summary_falc || actualite.contenu?.substring(0, 200),
    "datePublished": actualite.date_publication,
    "dateModified": actualite.date_modification || actualite.date_publication,
    "author": {
      "@type": "Organization",
      "name": actualite.source_nom || SITE_NAME
    },
    "publisher": {
      "@type": "Organization",
      "name": SITE_NAME,
      "url": BASE_URL
    },
    "inLanguage": "fr-FR",
    ...(actualite.slug && { "url": `${BASE_URL}/actualites/${actualite.slug}` }),
  };
}

/**
 * Generate Organization schema (for Structure detail pages)
 * @param {StructureLike} structure - Structure data
 * @returns {Object} JSON-LD schema
 */
export function generateOrganizationSchema(structure) {
  const schema = {
    "@context": "https://schema.org",
    "@type": structure.type === 'association' ? 'Organization' : 'GovernmentOrganization',
    "name": structure.nom,
    "description": structure.description || structure.resume_falc,
    ...(structure.slug && { "url": `${BASE_URL}/structures/${structure.slug}` }),
  };

  // Add address if available
  if (structure.adresse || structure.ville || structure.code_postal) {
    schema.address = {
      "@type": "PostalAddress",
      ...(structure.adresse && { "streetAddress": structure.adresse }),
      ...(structure.ville && { "addressLocality": structure.ville }),
      ...(structure.code_postal && { "postalCode": structure.code_postal }),
      "addressCountry": "FR"
    };
  }

  // Add contact info if available
  if (structure.telephone) {
    // @ts-ignore
    schema.telephone = structure.telephone;
  }
  if (structure.email) {
    // @ts-ignore
    schema.email = structure.email;
  }
  if (structure.site_web) {
    // @ts-ignore
    schema.sameAs = [structure.site_web];
  }

  return schema;
}

/**
 * Generate GovernmentService schema (for Aide detail pages)
 * @param {AideLike} aide - Aide data
 * @returns {Object} JSON-LD schema
 */
export function generateGovernmentServiceSchema(aide) {
  return {
    "@context": "https://schema.org",
    "@type": "GovernmentService",
    "name": aide.titre,
    "description": aide.summary_falc || aide.description,
    "serviceType": aide.theme || "Aide sociale",
    "provider": {
      "@type": "GovernmentOrganization",
      "name": aide.organisme || "Service public français"
    },
    ...(aide.slug && { "url": `${BASE_URL}/aides/${aide.slug}` }),
    "areaServed": {
      "@type": "AdministrativeArea",
      "name": aide.territoire || "France"
    },
    "audience": {
      "@type": "Audience",
      "audienceType": aide.public_cible || "Tout public"
    }
  };
}

/**
 * Generate HowTo schema (for Demarche detail pages)
 * @param {DemarcheLike} demarche - Demarche data
 * @returns {Object} JSON-LD schema
 */
export function generateHowToSchema(demarche) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "name": demarche.titre,
    "description": demarche.summary_falc || demarche.description,
    ...(demarche.slug && { "url": `${BASE_URL}/demarches/${demarche.slug}` }),
  };

  // Add steps if available
  if (demarche.etapes && Array.isArray(demarche.etapes) && demarche.etapes.length > 0) {
    // @ts-ignore
    schema.step = demarche.etapes.map((etape, index) => ({
      "@type": "HowToStep",
      "position": index + 1,
      "name": etape.titre || `Étape ${index + 1}`,
      "text": etape.description || etape.contenu
    }));
  }

  return schema;
}

/**
 * Generate FAQPage schema
 * @param {FaqItem[]} faqs - Array of {question, answer}
 * @returns {Object} JSON-LD schema
 */
export function generateFAQSchema(faqs) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }))
  };
}

/**
 * Generate ItemList schema (for list pages)
 * @param {ItemListSchemaOptions} options - List options
 * @returns {Object} JSON-LD schema
 */
export function generateItemListSchema({ name, description, items, path }) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": name,
    "description": description,
    "url": `${BASE_URL}${path}`,
    "numberOfItems": items.length,
    "itemListElement": items.slice(0, 10).map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.titre || item.nom,
      "url": item.slug ? `${BASE_URL}${path}/${item.slug}` : undefined
    }))
  };
}
