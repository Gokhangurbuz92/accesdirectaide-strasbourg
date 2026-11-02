import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
    ShieldCheck,
    Users,
    Euro,
    MapPin,
    Briefcase,
    AlertCircle,
    FileText,
    Clock,
    Calendar,
    Home,
    FileDown,
} from 'lucide-react';
import { Trans } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CsrfBootstrapError, csrfFetch } from '@/lib/csrf';
import AssessmentView from '@/components/diagnostic/AssessmentView';
import { shareableResults } from '@/lib/assessmentLabels';
import { useAssessmentLabels } from '@/lib/assessmentLabelsI18n';
import { useDiagnosticLabels } from '@/lib/diagnosticLabelsI18n';
import i18n, { formatDate, useT } from '@/i18n';

/**
 * What can go wrong, as a fixed code: the page shows the fixed text of the code (in the interface language), never what a server sent back.
 * @typedef {'noId' | 'invalidLink' | 'notFound' | 'rate' | 'bootstrap' | 'generic'} ShareErrorCode
 */
/** @param {number} status @returns {ShareErrorCode} */
const shareErrorFor = (status) => (status === 404 || status === 410 ? 'notFound' : status === 429 ? 'rate' : 'generic');
class ShareError extends Error {
    /** @param {ShareErrorCode} code */
    constructor(code) { super(code); this.code = code; }
}

/** the answers the person shared (src/pages/DiagnosticPage.jsx DEFAULT_SITUATION) @typedef {{ birthDate?: string, ageBand?: string, salary?: number | string, rent?: number | string, housingStatus?: string, householdSize?: number | string, zipCode?: string, employmentStatus?: string }} SharedSituation */
/** the stored share, as /api/share/get answers it @typedef {{ createdAt: string, expiresAt: string, viewCount: number, situation?: SharedSituation, results?: Record<string, unknown> & { legacyRightsOmitted?: boolean } }} SharedData */

/** French dates as before (« 01/10/2026 »), in the interface language elsewhere @param {string} value */
const shortDate = (value) => formatDate(value, { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * SharedDiagnostic
 *
 * Public read-only page displaying a capability-protected shared diagnostic.
 * The raw capability is read from the URL fragment, scrubbed from browser
 * history before data retrieval, then sent only in the POST body.
 * Includes a "Download PDF" button for the viewer.
 * R39: every interface string is in the `diagnostic` namespace (six languages); the declared answers are named with the labels of the form
 * (src/lib/diagnosticLabelsI18n.js), the age band and its absence with src/lib/assessmentLabelsI18n.js.
 */
export default function SharedDiagnostic() {
    const { t } = useT('diagnostic');
    const { id } = useParams();
    const { birthDisplay } = useAssessmentLabels();
    const { housing, employment } = useDiagnosticLabels();
    const [data, setData] = useState(/** @type {SharedData | null} */ (null));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(/** @type {ShareErrorCode | null} */ (null));
    const [capability, setCapability] = useState(/** @type {string | null} */ (null));
    const fragmentResolvedRef = useRef(false);

    useLayoutEffect(() => {
        if (fragmentResolvedRef.current || typeof window === 'undefined') return;
        fragmentResolvedRef.current = true;
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const value = params.get('capability') || '';
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        setCapability(value);
    }, []);

    useEffect(() => {
        if (!id) {
            setError('noId');
            setLoading(false);
            return;
        }
        if (capability === null) return;
        if (!capability) {
            setError('invalidLink');
            setLoading(false);
            return;
        }

        // DTA S1C: a fresh browser has no __csrf cookie yet. Bootstrap it (GET /api/health) BEFORE the first protected POST; if that fails, do not send the POST.
        // Server answers are never shown verbatim: fixed texts keyed on the HTTP status.
        let cancelled = false;
        (async () => {
            try {
                const res = await csrfFetch('/api/share/get', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, capability }),
                });
                if (!res.ok) throw new ShareError(shareErrorFor(res.status));
                const json = await res.json();
                if (!cancelled) setData(json.data);
            } catch (err) {
                if (!cancelled) setError(err instanceof CsrfBootstrapError ? 'bootstrap' : err instanceof ShareError ? err.code : 'generic');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [id, capability]);

    const handleDownloadPDF = async () => {
        try {
            const { generateSocialPassport } = await import('@/lib/pdf-generator');
            generateSocialPassport(data?.situation || {}, shareableResults(data?.results || {}));
        } catch (err) {
            if (import.meta.env.DEV) console.error('[PDF] Generation failed:', err);
        }
    };

    /** @type {Record<ShareErrorCode, string>} */
    const errorText = {
        noId: t('diagnostic:shared.error.no_id', 'Aucun identifiant de partage fourni.'),
        invalidLink: t('diagnostic:shared.error.invalid_link', 'Lien de partage invalide ou incomplet.'),
        notFound: t('diagnostic:shared.error.not_found', 'Dossier introuvable ou expiré.'),
        rate: t('diagnostic:shared.error.rate', 'Trop de demandes en peu de temps. Patientez un instant avant de réessayer.'),
        bootstrap: t('diagnostic:shared.error.bootstrap', 'Impossible de sécuriser la connexion. Réessayez dans un instant.'),
        generic: t('diagnostic:shared.error.generic', 'Le dossier n’a pas pu être chargé. Réessayez plus tard.'),
    };
    const notStated = t('diagnostic:shared.not_stated', 'Non précisé');

    // --- Loading ---
    if (loading) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
                <SkeletonList count={3} variant="card" />
                <p role="status" className="animate-pulse text-xs font-bold uppercase tracking-widest text-slate-600">
                    {t('diagnostic:shared.loading', 'Accès sécurisé au dossier…')}
                </p>
            </div>
        );
    }

    // --- Error ---
    if (error || !data) {
        return (
            <>
                <Helmet>
                    <title>{t('diagnostic:shared.error.meta_title', 'Dossier introuvable | Accès Direct Aide')}</title>
                </Helmet>
                <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 sm:p-6">
                    <div className="w-full max-w-md rounded-3xl border border-red-100 bg-white p-6 text-center shadow-xl sm:p-8">
                        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-700">
                            <AlertCircle className="h-8 w-8" aria-hidden="true" />
                        </div>
                        <h1 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">{t('diagnostic:shared.error.page_title', 'Dossier partagé')}</h1>{/* Q10: the page heading; the state below keeps its h2 */}
                        <h2 className="mb-2 text-xl font-black text-slate-800">{t('diagnostic:shared.error.title', 'Dossier introuvable')}</h2>
                        <p className="mb-6 text-sm text-slate-600">{errorText[error || 'generic']}</p>
                        {/* R39: one control (a link styled as a button), no longer a button inside a link */}
                        <Button asChild className="gap-2">
                            <Link to="/">
                                <Home className="h-4 w-4" aria-hidden="true" /> {t('diagnostic:shared.error.home', "Retour à l'accueil")}
                            </Link>
                        </Button>
                    </div>
                </div>
            </>
        );
    }

    // --- Data ---
    const situation = data.situation || {};
    const results = data.results || {};
    const createdDate = shortDate(data.createdAt);
    const expiresDate = shortDate(data.expiresAt);

    return (
        <>
            <Helmet>
                <title>{t('diagnostic:shared.meta_title', 'Passeport Social Partagé | Accès Direct Aide')}</title>
                <meta name="robots" content="noindex, nofollow" />
            </Helmet>

            <div className="min-h-screen bg-slate-50 p-4 md:p-12">
                <div className="mx-auto max-w-4xl space-y-8">
                    <p className="text-center text-xs text-slate-600">
                        {t('diagnostic:shared.pro_notice', "Vous êtes un professionnel ? L'accès à ce dossier se fait uniquement sur invitation de l'usager, adressée à votre structure.")}
                    </p>
                    {/* Header */}
                    <header className="flex flex-col items-center justify-between gap-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 md:flex-row md:p-8">
                        <div className="flex min-w-0 items-center gap-4">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
                                <ShieldCheck className="h-8 w-8" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-2xl font-black italic leading-none tracking-tight">
                                    <Trans i18n={i18n} i18nKey="diagnostic:shared.title" defaults="PASSEPORT <accent>PARTAGÉ</accent>" components={{ accent: <span className="text-indigo-600" /> }} />
                                </h1>
                                <p className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                    <Clock className="h-3 w-3 shrink-0 text-indigo-400" aria-hidden="true" />
                                    {t('diagnostic:shared.dates', 'Généré le {{created}} • Expire le {{expires}}', { created: createdDate, expires: expiresDate })}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-5 py-2 text-xs font-bold text-slate-800">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {t('diagnostic:shared.badge', 'Simulation locale non officielle')}
                        </div>
                    </header>

                    <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
                        {/* Situation Panel */}
                        <aside className="min-w-0 space-y-4 md:col-span-4" aria-labelledby="shared-profile-title">
                            <h2 id="shared-profile-title" className="flex items-center gap-2 px-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-600">
                                <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {t('diagnostic:shared.profile', 'Profil Déclaré')}
                            </h2>
                            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                                <InfoItem
                                    icon={<Calendar className="h-4 w-4" aria-hidden="true" />}
                                    label={t('diagnostic:shared.birth', 'Naissance')}
                                    value={birthDisplay(situation)}
                                />
                                <InfoItem
                                    icon={<Euro className="h-4 w-4" aria-hidden="true" />}
                                    label={t('diagnostic:shared.salary', 'Salaire net')}
                                    value={`${Number(situation.salary) || 0} €`}
                                />
                                <InfoItem
                                    icon={<Home className="h-4 w-4" aria-hidden="true" />}
                                    label={t('diagnostic:shared.housing', 'Logement')}
                                    value={(situation.housingStatus && housing[situation.housingStatus]) || notStated}
                                />
                                <InfoItem
                                    icon={<Euro className="h-4 w-4" aria-hidden="true" />}
                                    label={t('diagnostic:shared.rent', 'Loyer')}
                                    value={`${Number(situation.rent) || 0} €`}
                                />
                                <InfoItem
                                    icon={<Users className="h-4 w-4" aria-hidden="true" />}
                                    label={t('diagnostic:shared.household', 'Foyer')}
                                    value={t('diagnostic:shared.household_value', '{{n}} pers.', { n: situation.householdSize || 1 })}
                                />
                                <InfoItem
                                    icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
                                    label={t('diagnostic:shared.zip', 'Code Postal')}
                                    value={situation.zipCode || notStated}
                                />
                                <InfoItem
                                    icon={<Briefcase className="h-4 w-4" aria-hidden="true" />}
                                    label={t('diagnostic:shared.employment', 'Statut pro')}
                                    value={(situation.employmentStatus && employment[situation.employmentStatus]) || notStated}
                                />
                            </div>
                        </aside>

                        {/* Rights Panel */}
                        <div className="min-w-0 space-y-4 md:col-span-8">
                            {results.legacyRightsOmitted && (
                                <p data-testid="legacy-results-note" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
                                    {t('diagnostic:shared.legacy', "Ce partage date d'une ancienne version : le détail des résultats n'est plus affiché. Demandez à la personne de refaire le diagnostic.")}
                                </p>
                            )}
                            <AssessmentView results={results} headingLevel={2} />
                            {/* Download PDF */}
                            <button
                                type="button"
                                onClick={handleDownloadPDF}
                                className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-indigo-200 bg-indigo-50 px-6 py-4 text-sm font-bold text-indigo-700 transition-all hover:border-indigo-400 hover:bg-indigo-100 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 active:scale-[0.98] motion-reduce:transform-none"
                            >
                                <FileDown className="h-5 w-5 shrink-0" aria-hidden="true" />
                                {t('diagnostic:shared.pdf', 'Télécharger ce Passeport Social (PDF)')}
                            </button>
                        </div>
                    </div>

                    {/* Disclaimer Footer */}
                    <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" aria-hidden="true" />
                        <p className="text-xs leading-relaxed text-amber-900">
                            {t('diagnostic:shared.disclaimer', "Ce document est une pré-orientation issue d'une simulation locale non officielle. Il ne constitue ni une décision, ni une promesse, ni un refus. Une demande officielle doit être effectuée auprès de l'organisme compétent (CAF, MSA, CPAM, Département).")}
                        </p>
                    </div>

                    {/* Footer */}
                    <footer className="rounded-3xl border-t border-slate-200/60 bg-white/50 p-4 text-center sm:p-8">
                        <p className="mb-2 break-all text-[10px] font-bold uppercase tracking-[0.3em] text-slate-600">
                            {t('diagnostic:shared.ref', 'Réf : {{id}}', { id })}
                        </p>
                        <p className="text-[10px] text-slate-600">
                            {t('diagnostic:shared.views', { count: data.viewCount, defaultValue_one: '{{count}} consultation de ce dossier', defaultValue_other: '{{count}} consultations de ce dossier' })}
                        </p>
                    </footer>
                </div>
            </div>
        </>
    );
}

/** one declared answer of the profile @param {{ icon: import('react').ReactNode, label: string, value: string }} props */
function InfoItem({ icon, label, value }) {
    return (
        <div className="group flex items-center gap-4">
            <div className="shrink-0 rounded-xl bg-indigo-50 p-2.5 text-indigo-500 transition-all duration-300 group-hover:bg-indigo-600 group-hover:text-white" aria-hidden="true">
                {icon}
            </div>
            <div className="min-w-0">
                <p className="mb-0.5 text-[10px] font-bold uppercase leading-none text-slate-600">{label}</p>
                <p className="break-words text-sm font-bold text-slate-800">{value}</p>
            </div>
        </div>
    );
}
