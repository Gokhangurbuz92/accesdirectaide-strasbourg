import { Helmet } from 'react-helmet-async';
import PropTypes from 'prop-types';
import { frontendEnv } from '@/config/env';
import { useLanguage, useT } from '@/i18n';
import {
    buildAbsoluteImageUrl,
    buildCanonicalUrl,
    getCurrentPathname,
} from '@/lib/seo';

const DEFAULT_IMAGE = '/og-default.webp';
const SITE_NAME = 'Accès Direct Aide';

/** R32: og:locale follows the interface language (Open Graph locale names) */
const OG_LOCALES = { fr: 'fr_FR', en: 'en_GB', tr: 'tr_TR', ar: 'ar_AR', de: 'de_DE', uk: 'uk_UA' };

/**
 * SEO Component with OpenGraph and Twitter Card support.
 * Use this in individual pages for consistent SEO.
 */
/**
 * @typedef {object | object[] | null | undefined} SchemaValue
 * @typedef {Object} SEOProps
 * @property {string} title
 * @property {string} description
 * @property {string=} path
 * @property {string=} image
 * @property {string=} imageAlt
 * @property {boolean=} noindex
 * @property {string=} ogType
 * @property {SchemaValue=} schema
 */

/** @param {SEOProps} props */
export default function SEO({
    title,
    description = undefined,
    path = '',
    image = DEFAULT_IMAGE,
    imageAlt = undefined,
    noindex = false,
    ogType = 'website',
    schema = null
}) {
    const { t } = useT('shared');
    const { code } = useLanguage();
    const pageDescription = description ?? t('shared:seo.description', 'Vos droits et démarches sociales, simplement.');
    const pageImageAlt = imageAlt ?? t('shared:seo.imageAlt', 'Accès Direct Aide - Informations sociales officielles');
    const pageTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
    const activePath = path || getCurrentPathname();
    const canonicalUrl = buildCanonicalUrl(activePath);
    const imageUrl = buildAbsoluteImageUrl(image);
    const hasImage = Boolean(imageUrl);
    const isProduction = frontendEnv.runtime.vercelEnv === 'production';

    return (
        <Helmet>
            {/* Basic */}
            <title>{pageTitle}</title>
            <meta name="description" content={pageDescription} />

            {/* Canonical */}
            <link rel="canonical" href={canonicalUrl} />

            {/* Robots */}
            {(noindex || !isProduction) && <meta name="robots" content="noindex, nofollow" />}

            {/* Search Console / Webmaster verification (optional, no hardcoded values) */}
            {frontendEnv.verification.googleSiteVerification && (
                <meta name="google-site-verification" content={frontendEnv.verification.googleSiteVerification} />
            )}
            {frontendEnv.verification.bingSiteVerification && (
                <meta name="msvalidate.01" content={frontendEnv.verification.bingSiteVerification} />
            )}

            {/* OpenGraph */}
            <meta property="og:type" content={ogType} />
            <meta property="og:site_name" content={SITE_NAME} />
            <meta property="og:title" content={pageTitle} />
            <meta property="og:description" content={pageDescription} />
            <meta property="og:url" content={canonicalUrl} />
            <meta property="og:image" content={imageUrl} />
            <meta property="og:image:alt" content={pageImageAlt} />
            <meta property="og:locale" content={OG_LOCALES[/** @type {keyof typeof OG_LOCALES} */ (code)] || OG_LOCALES.fr} />

            {/* Twitter Card */}
            <meta name="twitter:card" content={hasImage ? 'summary_large_image' : 'summary'} />
            <meta name="twitter:title" content={pageTitle} />
            <meta name="twitter:description" content={pageDescription} />
            <meta name="twitter:image" content={imageUrl} />
            <meta name="twitter:image:alt" content={pageImageAlt} />

            {/* Schema.org */}
            {schema && (
                <script type="application/ld+json">
                    {JSON.stringify(schema)}
                </script>
            )}
        </Helmet>
    );
}

SEO.propTypes = {
    title: PropTypes.string.isRequired,
    description: PropTypes.string,
    path: PropTypes.string,
    image: PropTypes.string,
    imageAlt: PropTypes.string,
    noindex: PropTypes.bool,
    ogType: PropTypes.string,
    schema: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.array
    ])
};
