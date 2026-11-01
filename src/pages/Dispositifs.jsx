import { useState, useEffect } from 'react';
import SEO from '@/components/SEO';
import DispositifCard from '@/components/cards/DispositifCard';
import LoadError from '@/components/LoadError';
import PageHeader from '@/components/layout/PageHeader';
import EmptyCatalogue from '@/components/layout/EmptyCatalogue';
import { useT } from '@/i18n';

export default function Dispositifs() {
    const { t } = useT('dispositifs');
    const [dispositifs, setDispositifs] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [filterDept, setFilterDept] = useState('');
    const [filterPublic, setFilterPublic] = useState('');
    const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const fetchDispositifs = async () => {
            setLoading(true); setFailed(false);
            try {
                let url = '/api/dispositifs';
                const params = new URLSearchParams();
                if (filterDept) params.append('departement', filterDept);
                if (filterPublic) params.append('public', filterPublic);

                if (params.toString()) url += `?${params.toString()}`;

                const res = await fetch(url);
                if (!res.ok) throw new Error(`dispositifs ${res.status}`);
                const data = await res.json();
                setDispositifs(Array.isArray(data) ? data : []);
            } catch (err) {
                setFailed(true);   // an outage is said as such, never shown as « aucun dispositif »
            } finally {
                setLoading(false);
            }
        };

        fetchDispositifs();
    }, [filterDept, filterPublic, attempt]);

    return (
        <div className="min-h-screen bg-slate-50">
            <SEO
                title={t('dispositifs:list.title', 'Dispositifs territoriaux')}
                description={t('dispositifs:seo.description', 'Découvrez les dispositifs locaux et territoriaux pour vous aider.')}
                path="/dispositifs"
            />

            <PageHeader title={t('dispositifs:list.title', 'Dispositifs territoriaux')} description={t('dispositifs:list.intro', 'Les programmes locaux d’aide de Strasbourg, de l’Eurométropole et du Bas-Rhin, vérifiés sur leur source officielle.')} />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* R18: no published programme at all (none verified on an official source yet) = said as such, with the next steps; the filters only when there is something to filter */}
            {!loading && !failed && dispositifs.length === 0 && !filterDept && !filterPublic ? (
                <EmptyCatalogue title={t('dispositifs:none.title', 'Aucun dispositif local n’est encore publié')} testId="dispositifs-none-published">
                    <p>{t('dispositifs:none.why', 'Un dispositif n’apparaît ici qu’après sa vérification sur la page officielle de l’organisme qui le gère. Les dispositifs locaux pour le logement, comme le Fonds de solidarité pour le logement, sont en cours de vérification.')}</p>
                    <p>{t('dispositifs:none.next', 'Les aides, les démarches et les lieux d’accueil ci-dessous sont déjà vérifiés.')}</p>
                </EmptyCatalogue>
            ) : (
            <>
            <div className="bg-white p-4 rounded-lg shadow mb-8 flex flex-wrap gap-4 items-center">
                <label htmlFor="dispositifs-departement" className="sr-only">{t('dispositifs:filters.departement', 'Département')}</label>
                <select id="dispositifs-departement"
                    className="border p-2 rounded min-h-11"
                    value={filterDept}
                    onChange={(e) => setFilterDept(e.target.value)}
                >
                    <option value="">{t('dispositifs:filters.departement_all', 'Tous les départements')}</option>
                    <option value="67">Bas-Rhin (67)</option>
                    <option value="68">Haut-Rhin (68)</option>
                </select>

                <label htmlFor="dispositifs-public" className="sr-only">{t('dispositifs:filters.public', 'Public')}</label>
                <select id="dispositifs-public"
                    className="border p-2 rounded min-h-11"
                    value={filterPublic}
                    onChange={(e) => setFilterPublic(e.target.value)}
                >
                    <option value="">{t('dispositifs:filters.public_all', 'Tous publics')}</option>
                    <option value="jeunes">{t('dispositifs:public.jeunes', 'Jeunes')}</option>
                    <option value="seniors">{t('dispositifs:public.seniors', 'Seniors')}</option>
                    <option value="familles">{t('dispositifs:public.familles', 'Familles')}</option>
                    <option value="handicap">{t('dispositifs:public.handicap', 'Personnes handicapées')}</option>
                </select>
            </div>

            {loading ? (
                <p role="status">{t('dispositifs:list.loading', 'Chargement...')}</p>
            ) : failed ? (
                <LoadError what={t('dispositifs:load.list', 'les dispositifs')} onRetry={() => setAttempt((n) => n + 1)} testId="dispositifs-error" />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="dispositifs-list">
                    {dispositifs.map((/** @type {{ id: string | number }} */ d) => (
                        <DispositifCard key={d.id} dispositif={d} />
                    ))}
                    {dispositifs.length === 0 && (
                        <p className="col-span-3 text-center text-gray-700" data-testid="dispositifs-empty">{t('dispositifs:list.empty', 'Aucun dispositif trouvé pour ces critères.')}</p>
                    )}
                </div>
            )}
            </>
            )}
            </div>
        </div>
    );
}
