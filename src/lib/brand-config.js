/**
 * brand-config.js
 *
 * Identité visuelle et juridique de AccesDirectAide.
 * Owner decision of 23 October 2026 (STRASBOURG_FULL_PRODUCT_PLAN/OWNER_LEGAL_FORM_DECISION_2026-10-23.md): the INTENDED legal form is an association
 * inscrite de droit local d'Alsace-Moselle à but non lucratif, registered office intended in Strasbourg. Owner addendum R42-A01 (04/11/2026,
 * CONTROL/directives/R42_DIRECTIVE.md) supersedes the wording of 23/10: the association has NOT been created or registered; the project is carried by
 * one natural person, the project carrier, whose identity is published through VITE_LEGAL_PUBLISHER_IDENTITY (src/config/legal-documents.js).
 * Nothing here is a legal publisher identification; the future association is never presented as existing.
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
        // R42-LEGAL: the telephone number and postal address formerly written here were unused, of unverified origin, and in a public repository —
        // removed. The publisher's domicile and telephone (LCEN art. 1-1 I 1°) are a decision of the project carrier (CONTROL/r42), never a constant here.
        phone: null,
        email: 'contact@accesdirectaide.fr',
        address: null,
    },

    // — Legal —
    legal: {
        // R42-A01 (04/11/2026) replaces the project wording of 23/10/2026 (« projet associatif … en cours de constitution »), which could be read as an
        // association being constituted: none is. No registration number, SIREN/SIRET, legal representative or authorization exists or may be invented.
        projectStatement: 'AccesDirectAide — projet à but non lucratif porté par une personne physique. L’association de droit local d’Alsace-Moselle envisagée n’est pas encore créée.',
        entity: 'AccesDirectAide — projet porté par une personne physique (association de droit local d’Alsace-Moselle envisagée, non créée)',
        // R15 (dossier 27/10, B-009): an association of local law is « inscrite » at the tribunal judiciaire's register (no RNA, no « immatriculation »); none exists
        legalStatus: 'Projet porté par une personne physique (porteur du projet) — association à but non lucratif de droit local d’Alsace-Moselle envisagée, pas encore créée ni inscrite au registre des associations',
        intendedRegisteredOffice: 'Strasbourg (envisagé pour la future association)',
        siret: '',
        rgpdContact: 'contact@accesdirectaide.fr',
    },

    // — Feature flags —
    features: {
        showGouvBanner: false,
        showInstitutionBadge: true,
        isAssociative: true,   // the INTENDED model (owner, 2026-10-23); no association exists (R42-A01): the operator is a natural person
    },
};

export default brand;
