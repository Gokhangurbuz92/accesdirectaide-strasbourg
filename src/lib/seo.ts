export const seo = {
    "/": { title: "AccesDirectAide — Accéder à vos droits simplement", description: "Trouvez rapidement aides, démarches et structures fiables près de chez vous." },
    "/aides": { title: "Aides — AccesDirectAide", description: "Liste d’aides et dispositifs, avec preuve de fraîcheur des sources." },
} as const;

// Type-only facade for runtime helpers implemented in ./seo.js.
export declare function getCurrentPathname(): string;
export declare function buildCanonicalUrl(path?: string): string;
export declare function buildAbsoluteImageUrl(imagePath?: string): string;
export declare function buildSiteSchema(): Array<Record<string, unknown>>;

