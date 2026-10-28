/**
 * brand-config.js
 *
 * Identité visuelle et juridique de AccesDirectAide.
 * Owner decision of 23 October 2026 (STRASBOURG_FULL_PRODUCT_PLAN/OWNER_LEGAL_FORM_DECISION_2026-10-23.md): an association inscrite de droit local
 * d'Alsace-Moselle à but non lucratif, registered office intended in Strasbourg — NOT yet registered. The older « entreprise commerciale (en formation) »
 * assumption is superseded. Nothing here is a legal publisher identification (mentions légales keep their placeholders until registration).
 *
 * Modifier ce fichier pour rebrander toute l'application.
 */

const brand = {
    // — Identity —
    name: 'AccesDirectAide',
    shortName: 'ADA',
    tagline: "L'information sociale claire et souveraine",
    institution: 'AccesDirectAide',
    institutionShort: 'ADA',
    region: 'Strasbourg, Alsace',

    // — Colors —
    colors: {
        primary: '#0f766e',       // Bleu Canard — confiance & social
        primaryLight: '#ccfbf1',  // Fond clair teal
        primaryDark: '#115e59',   // Hover
        accent: '#f59e0b',        // Ambre chaleureux
        accentLight: '#fef3c7',
        success: '#059669',
        successLight: '#d1fae5',
        warning: '#d97706',
        warningLight: '#fef3c7',
        danger: '#dc2626',
        dangerLight: '#fee2e2',
        neutral: '#1e293b',
        neutralLight: '#f8fafc',
    },

    // — Government banner (disabled for private entity) —
    banner: {
        text: '',
        bgColor: '#0f766e',
        textColor: '#ffffff',
    },

    // — Logos —
    logo: '/logo.svg',
    favicon: '/favicon.ico',

    // — Contact —
    contact: {
        phone: '07.78.55.75.25',
        email: 'contact@accesdirectaide.fr',
        address: '58 rue Himmerich, 67000 Strasbourg',
    },

    // — Legal —
    legal: {
        // Owner decision 2026-10-23: the temporary PROJECT wording, approved as such. No registration number, SIREN/SIRET, legal representative or authorization
        // exists or may be invented; the publisher identification of the legal pages stays a placeholder until the association is registered (P21)
        projectStatement: 'AccesDirectAide — projet associatif à but non lucratif, en cours de constitution sous le régime du droit local d’Alsace-Moselle.',
        entity: 'AccesDirectAide — projet associatif à but non lucratif (association de droit local d’Alsace-Moselle en cours de constitution)',
        // R15 (dossier 27/10, B-009): an association of local law is « inscrite » at the tribunal judiciaire's register (no RNA, no « immatriculation »); this one is not yet
        legalStatus: 'Projet d’association de droit local d’Alsace-Moselle à but non lucratif — en cours de constitution, pas encore inscrite au registre des associations',
        intendedRegisteredOffice: 'Strasbourg (prévu)',
        siret: '',
        rgpdContact: 'contact@accesdirectaide.fr',
    },

    // — Feature flags —
    features: {
        showGouvBanner: false,
        showInstitutionBadge: true,
        isAssociative: true,   // the decided model (owner, 2026-10-23); the association is not yet registered
    },
};

export default brand;
