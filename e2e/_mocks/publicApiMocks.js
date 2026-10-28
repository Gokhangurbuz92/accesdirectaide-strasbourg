// Mock Data Definitions
const MOCK_AIDES = {
    items: [
        {
            id: 'aide-1',
            slug: 'aide-test',
            titre: 'Aide Test',
            providerName: 'Test Provider',
            cest_quoi: 'Résumé facile.',
            categorie: 'logement',
            statut: 'publie',
            description_courte: 'Description courte aide test',
            territoires: ['national'],
            date_verification: '2026-01-10T10:00:00.000Z',
            provenance: {
                verifiedAt: '2026-01-10T10:00:00.000Z',
                fetchedAt: '2026-02-10T10:00:00.000Z',
                sourceUrl: 'https://www.service-public.fr/aide-test',
                sourceHost: 'www.service-public.fr'
            }
        }
    ],
    pagination: { total: 15, page: 1, pageSize: 10, totalPages: 2 }
};

const MOCK_AIDE_DETAIL = {
    id: 'aide-1',
    slug: 'aide-test',
    titre: 'Aide Test',
    providerName: 'Test Provider',
    cest_quoi: 'Description longue',
    categorie: 'logement',
    statut: 'publie',
    description_courte: 'Description courte aide test',
    territoires: ['national'],
    category: { name: 'Logement' },
    date_verification: '2026-01-10T10:00:00.000Z',
    provenance: {
        verifiedAt: '2026-01-10T10:00:00.000Z',
        fetchedAt: '2026-02-10T10:00:00.000Z',
        sourceUrl: 'https://www.service-public.fr/aide-test',
        sourceHost: 'www.service-public.fr'
    }
};

const MOCK_DEMARCHES = {
    items: [
        {
            id: 'demarche-1',
            slug: 'demarche-test',
            titre: 'Demander le RSA',
            summary_falc: 'Resume demarche RSA.',
            statut: 'publie',
            categorie: 'famille',
            description_courte: 'Description courte démarche',
            date_verification: '2025-10-10T10:00:00.000Z',
            provenance: {
                verifiedAt: '2025-10-10T10:00:00.000Z',
                fetchedAt: '2026-02-10T10:00:00.000Z',
                sourceUrl: 'https://www.service-public.fr/demander-rsa',
                sourceHost: 'www.service-public.fr'
            }
        }
    ],
    pagination: { total: 1, page: 1, pageSize: 10, totalPages: 1 }
};

const MOCK_DEMARCHE_DETAIL = {
    id: 'demarche-1',
    slug: 'demarche-test',
    titre: 'Demander le RSA',
    summary_falc: 'Resume demarche RSA.',
    statut: 'publie',
    categorie: 'famille',
    description_statut: 'Détail démarche',
    etapes: [],
    documents_necessaires: [],
    date_verification: '2025-10-10T10:00:00.000Z',
    provenance: {
        verifiedAt: '2025-10-10T10:00:00.000Z',
        fetchedAt: '2026-02-10T10:00:00.000Z',
        sourceUrl: 'https://www.service-public.fr/demander-rsa',
        sourceHost: 'www.service-public.fr'
    }
};

const MOCK_STRUCTURES = {
    items: [
        {
            id: 'struct-1',
            slug: 'structure-test',
            nom: 'Structure Test',
            adresse: '1 rue Test',
            ville: 'Testville',
            statut: 'actif',
            type_structure: 'association',
            is_pro_enabled: true,
            rdv: {
                isPublished: true,
                bookingMode: 'IN_PERSON'
            },
            date_verification: '2025-07-10T10:00:00.000Z',
            provenance: {
                verifiedAt: '2025-07-10T10:00:00.000Z',
                fetchedAt: '2026-02-10T10:00:00.000Z',
                sourceUrl: 'https://www.bas-rhin.fr/structure-test',
                sourceHost: 'www.bas-rhin.fr'
            }
        }
    ],
    pagination: { total: 1, page: 1, pageSize: 10, totalPages: 1 }
};

const MOCK_STRUCTURE_DETAIL = {
    id: 'struct-1',
    slug: 'structure-test',
    nom: 'Structure Test',
    adresse: '1 rue Test',
    ville: 'Testville',
    statut: 'actif',
    type_structure: 'association',
    is_pro_enabled: true,
    rdv: {
        isPublished: true,
        bookingMode: 'IN_PERSON'
    },
    proServices: [],
    date_verification: '2025-07-10T10:00:00.000Z',
    provenance: {
        verifiedAt: '2025-07-10T10:00:00.000Z',
        fetchedAt: '2026-02-10T10:00:00.000Z',
        sourceUrl: 'https://www.bas-rhin.fr/structure-test',
        sourceHost: 'www.bas-rhin.fr'
    }
};

const MOCK_ACTUALITES = {
    items: [
        {
            id: 'actu-1',
            slug: 'actu-test',
            titre: 'Actualité Test',
            resume: 'Résumé actu.',
            type_actu: 'info',
            date_publication: new Date().toISOString(),
            published_at: new Date().toISOString(),
            est_important: false,
            provenance: {
                verifiedAt: null,
                fetchedAt: '2026-02-10T10:00:00.000Z',
                sourceUrl: 'https://www.service-public.fr/actualite-test',
                sourceHost: 'www.service-public.fr'
            }
        }
    ],
    pagination: { total: 1, page: 1, pageSize: 10, totalPages: 1 }
};

const MOCK_ACTUALITE_DETAIL = {
    id: 'actu-1',
    slug: 'actu-test',
    titre: 'Actualité Test',
    contenu: 'Contenu actu',
    type_actu: 'info',
    date_publication: new Date().toISOString(),
    published_at: new Date().toISOString(),
    provenance: {
        verifiedAt: null,
        fetchedAt: '2026-02-10T10:00:00.000Z',
        sourceUrl: 'https://www.service-public.fr/actualite-test',
        sourceHost: 'www.service-public.fr'
    }
};

/**
 * Configure tous les mocks API publics nécessaires pour les tests E2E.
 *
 * Routes are registered from most-specific to least-specific.
 * Tests that call page.route() AFTER this setup will override
 * the matching global mock (Playwright uses the last handler).
 *
 * @param {import('@playwright/test').Page} page
 */
export async function setupPublicMocks(page) {
    // ── Core entity APIs ──────────────────────────────────────────

    // Aides
    await page.route('**/api/aides**', async route => {
        const url = route.request().url();
        // Detail: slug or id param, or /aides/<slug> path
        if (url.includes('aide-test') || /\/api\/aides\/[^?]/.test(url)) {
            return route.fulfill({ json: MOCK_AIDE_DETAIL });
        }
        return route.fulfill({ json: MOCK_AIDES });
    });

    // Démarches
    await page.route('**/api/demarches**', async route => {
        const url = route.request().url();
        if (url.includes('demarche-test') || /\/api\/demarches\/[^?]/.test(url)) {
            return route.fulfill({ json: MOCK_DEMARCHE_DETAIL });
        }
        return route.fulfill({ json: MOCK_DEMARCHES });
    });

    // Structures
    await page.route('**/api/structures**', async route => {
        const url = route.request().url();
        if (url.includes('structure-test') || /\/api\/structures\/[^?]/.test(url)) {
            return route.fulfill({ json: MOCK_STRUCTURE_DETAIL });
        }
        return route.fulfill({ json: MOCK_STRUCTURES });
    });

    // Actualités
    await page.route('**/api/actualites**', async route => {
        const url = route.request().url();
        if (url.includes('actu-test') || /\/api\/actualites\/[^?]/.test(url)) {
            return route.fulfill({ json: MOCK_ACTUALITE_DETAIL });
        }
        return route.fulfill({ json: MOCK_ACTUALITES });
    });

    // ── Taxonomy & search ─────────────────────────────────────────

    await page.route('**/api/taxonomy*', async route => route.fulfill({
        json: {
            categories: [
                { slug: 'logement', label: 'Logement', count: 1 },
                { slug: 'sante', label: 'Santé', count: 1 },
                { slug: 'famille', label: 'Famille', count: 1 },
            ],
            situations: []
        }
    }));

    await page.route('**/api/public/stats*', async route => route.fulfill({ json: { aides: 42, demarches: 15, structures: 30 } }));
    await page.route('**/api/public/suggest-structure*', async route => route.fulfill({ json: [] }));

    // ── Diagnostic / OpenFisca ─────────────────────────────────────

    await page.route('**/api/diagnostic*', async route => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ json: { period: '2026-02', rights: [], meta: { source: 'mock' } } });
        }
        return route.fulfill({ json: {} });
    });

    await page.route('**/api/recommendations*', async route => route.fulfill({ json: { items: [] } }));

    // ── Pro / Auth ─────────────────────────────────────────────────

    await page.route('**/api/pro/auth/**', async route => route.fulfill({ json: { token: 'mock-jwt', user: { email: 'pro@test.com' } } }));
    await page.route('**/api/pro/me*', async route => route.fulfill({ json: { email: 'pro@test.com', role: 'PRO' } }));
    await page.route('**/api/pro/**', async route => route.fulfill({ json: {} }));

    // ── RDV / Appointments ────────────────────────────────────────

    await page.route('**/api/public/availability*', async route => {
        const start = new Date();
        start.setHours(start.getHours() + 24);
        const end = new Date(start);
        end.setHours(end.getHours() + 1);
        return route.fulfill({ json: [{ id: 'slot-1', start: start.toISOString(), end: end.toISOString() }] });
    });
    await page.route('**/api/public/slots*', async route => {
        const start = new Date();
        start.setHours(start.getHours() + 24);
        const end = new Date(start);
        end.setHours(end.getHours() + 1);
        return route.fulfill({ json: [{ id: 'slot-1', start: start.toISOString(), end: end.toISOString() }] });
    });
    await page.route('**/api/appointments*', async route => route.fulfill({ json: { success: true } }));
    await page.route('**/api/public/appointments*', async route => route.fulfill({ json: { success: true } }));

    // ── Health & utility ──────────────────────────────────────────

    await page.route('**/api/health**', async route => route.fulfill({ json: { status: 'ok' } }));
    await page.route('**/api/contact*', async route => route.fulfill({ json: { success: true } }));
    await page.route('**/api/guides*', async route => route.fulfill({ json: [] }));
    await page.route('**/api/tools*', async route => route.fulfill({ json: [] }));
    await page.route('**/api/dispositifs*', async route => route.fulfill({ json: [] }));

    // ── Admin ─────────────────────────────────────────────────────

    await page.route('**/api/admin/**', async route => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
    await page.route('**/api/review-queue*', async route => route.fulfill({ json: { items: [], total: 0 } }));

    // ── DREES / data APIs ─────────────────────────────────────────

    await page.route('**/api/drees*', async route => route.fulfill({ json: { items: [] } }));
    await page.route('**/api/public/**', async route => route.fulfill({ json: {} }));

    // ── Search API ────────────────────────────────────────────────

    await page.route('**/api/search*', async route => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ json: { items: [], total: 0, message: null } });
        }
        return route.fulfill({ json: {} });
    });
}

export const PUBLIC_MOCKS_DATA = {
    aides: MOCK_AIDES,
    aideDetail: MOCK_AIDE_DETAIL,
    demarches: MOCK_DEMARCHES,
    demarcheDetail: MOCK_DEMARCHE_DETAIL,
    structures: MOCK_STRUCTURES,
    structureDetail: MOCK_STRUCTURE_DETAIL,
    actualites: MOCK_ACTUALITES,
    actualiteDetail: MOCK_ACTUALITE_DETAIL
};
