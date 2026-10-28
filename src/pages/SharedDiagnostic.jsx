// @ts-nocheck
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
import { Button } from '@/components/ui/button';
import { CsrfBootstrapError, csrfFetch } from '@/lib/csrf';
import AssessmentView from '@/components/diagnostic/AssessmentView';
import { birthDisplay, shareableResults } from '@/lib/assessmentLabels';

const SHARE_ERRORS = Object.freeze({
    notFound: 'Dossier introuvable ou expiré.',
    rate: 'Trop de demandes en peu de temps. Patientez un instant avant de réessayer.',
    bootstrap: 'Impossible de sécuriser la connexion. Réessayez dans un instant.',
    generic: 'Le dossier n’a pas pu être chargé. Réessayez plus tard.',
});
const shareErrorFor = (status) => (status === 404 || status === 410 ? SHARE_ERRORS.notFound : status === 429 ? SHARE_ERRORS.rate : SHARE_ERRORS.generic);

const HOUSING_LABELS = {
    tenant: 'Locataire',
    tenant_hlm: 'Locataire HLM',
    owner: 'Propriétaire',
    free: 'Hébergé(e) gratuitement',
    homeless: 'Sans domicile fixe',
};

const EMPLOYMENT_LABELS = {
    'salarié': 'Salarié',
    'sans_emploi': 'Sans emploi / Recherche',
    'indépendant': 'Indépendant',
    'retraité': 'Retraité',
    'étudiant': 'Étudiant',
};

/**
 * SharedDiagnostic
 *
 * Public read-only page displaying a capability-protected shared diagnostic.
 * The raw capability is read from the URL fragment, scrubbed from browser
 * history before data retrieval, then sent only in the POST body.
 * Includes a "Download PDF" button for the viewer.
 */
export default function SharedDiagnostic() {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [capability, setCapability] = useState(null);
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
            setError('Aucun identifiant de partage fourni.');
            setLoading(false);
            return;
        }
        if (capability === null) return;
        if (!capability) {
            setError('Lien de partage invalide ou incomplet.');
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
                if (!res.ok) throw new Error(shareErrorFor(res.status));
                const json = await res.json();
                if (!cancelled) setData(json.data);
            } catch (err) {
                if (!cancelled) setError(err instanceof CsrfBootstrapError ? SHARE_ERRORS.bootstrap : (err && Object.values(SHARE_ERRORS).includes(err.message) ? err.message : SHARE_ERRORS.generic));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [id, capability]);

    const handleDownloadPDF = async () => {
        try {
            const { generateSocialPassport } = await import('@/lib/pdf-generator');
            generateSocialPassport(data.situation || {}, shareableResults(data.results || {}));
        } catch (err) {
            if (import.meta.env.DEV) console.error('[PDF] Generation failed:', err);
        }
    };

    // --- Loading ---
    if (loading) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
                <SkeletonList count={3} variant="card" />
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 animate-pulse">
                    Accès sécurisé au dossier…
                </p>
            </div>
        );
    }

    // --- Error ---
    if (error) {
        return (
            <>
                <Helmet>
                    <title>Dossier introuvable | Accès Direct Aide</title>
                </Helmet>
                <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
                    <div className="max-w-md rounded-3xl border border-red-100 bg-white p-8 text-center shadow-xl">
                        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500">
                            <AlertCircle className="h-8 w-8" />
                        </div>
                        <h1 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">Dossier partagé</h1>{/* Q10: the page heading; the state below keeps its h2 */}
                        <h2 className="mb-2 text-xl font-black text-slate-800">Dossier introuvable</h2>
                        <p className="mb-6 text-sm text-slate-500">{error}</p>
                        <Link to="/">
                            <Button className="gap-2">
                                <Home className="h-4 w-4" /> Retour à l&#39;accueil
                            </Button>
                        </Link>
                    </div>
                </div>
            </>
        );
    }

    // --- Data ---
    const situation = data?.situation || {};
    const results = data?.results || {};
    const createdDate = new Date(data.createdAt).toLocaleDateString('fr-FR');
    const expiresDate = new Date(data.expiresAt).toLocaleDateString('fr-FR');

    return (
        <>
            <Helmet>
                <title>Passeport Social Partagé | Accès Direct Aide</title>
                <meta name="robots" content="noindex, nofollow" />
            </Helmet>

            <div className="min-h-screen bg-slate-50 p-4 md:p-12">
                <div className="mx-auto max-w-4xl space-y-8">
                    <p className="text-center text-xs text-slate-600">
                        Vous êtes un professionnel ? L&apos;accès à ce dossier se fait uniquement sur invitation de l&apos;usager, adressée à votre structure.
                    </p>
                    {/* Header */}
                    <header className="flex flex-col items-center justify-between gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:p-8">
                        <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
                                <ShieldCheck className="h-8 w-8" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black italic leading-none tracking-tight">
                                    PASSEPORT{' '}
                                    <span className="text-indigo-600">PARTAGÉ</span>
                                </h1>
                                <p className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                    <Clock className="h-3 w-3 text-indigo-400" />
                                    Généré le {createdDate} • Expire le {expiresDate}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-5 py-2 text-xs font-bold text-slate-800">
                            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            Simulation locale non officielle
                        </div>
                    </header>

                    <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
                        {/* Situation Panel */}
                        <aside className="space-y-4 md:col-span-4">
                            <h2 className="flex items-center gap-2 px-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-600">
                                <FileText className="h-3.5 w-3.5" /> Profil Déclaré
                            </h2>
                            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                                <InfoItem
                                    icon={<Calendar className="h-4 w-4" />}
                                    label="Naissance"
                                    value={birthDisplay(situation)}
                                />
                                <InfoItem
                                    icon={<Euro className="h-4 w-4" />}
                                    label="Salaire net"
                                    value={`${Number(situation.salary) || 0} €`}
                                />
                                <InfoItem
                                    icon={<Home className="h-4 w-4" />}
                                    label="Logement"
                                    value={HOUSING_LABELS[situation.housingStatus] || 'Non précisé'}
                                />
                                <InfoItem
                                    icon={<Euro className="h-4 w-4" />}
                                    label="Loyer"
                                    value={`${Number(situation.rent) || 0} €`}
                                />
                                <InfoItem
                                    icon={<Users className="h-4 w-4" />}
                                    label="Foyer"
                                    value={`${situation.householdSize || 1} pers.`}
                                />
                                <InfoItem
                                    icon={<MapPin className="h-4 w-4" />}
                                    label="Code Postal"
                                    value={situation.zipCode || 'Non précisé'}
                                />
                                <InfoItem
                                    icon={<Briefcase className="h-4 w-4" />}
                                    label="Statut pro"
                                    value={EMPLOYMENT_LABELS[situation.employmentStatus] || 'Non précisé'}
                                />
                            </div>
                        </aside>

                        {/* Rights Panel */}
                        <div className="space-y-4 md:col-span-8">
                            {results.legacyRightsOmitted && (
                                <p data-testid="legacy-results-note" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
                                    Ce partage date d&apos;une ancienne version : le détail des résultats n&apos;est plus affiché. Demandez à la personne de refaire le diagnostic.
                                </p>
                            )}
                            <AssessmentView results={results} headingLevel={2} />
                            {/* Download PDF */}
                            <button
                                type="button"
                                onClick={handleDownloadPDF}
                                className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-indigo-200 bg-indigo-50 px-6 py-4 text-sm font-bold text-indigo-700 transition-all hover:border-indigo-400 hover:bg-indigo-100 hover:shadow-md active:scale-[0.98]"
                            >
                                <FileDown className="h-5 w-5" />
                                Télécharger ce Passeport Social (PDF)
                            </button>
                        </div>
                    </div>

                    {/* Disclaimer Footer */}
                    <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" aria-hidden="true" />
                        <p className="text-xs leading-relaxed text-amber-900">
                            Ce document est une pré-orientation issue d&#39;une simulation locale non officielle.
                            Il ne constitue ni une décision, ni une promesse, ni un refus. Une demande officielle doit être
                            effectuée auprès de l&#39;organisme compétent (CAF, MSA, CPAM, Département).
                        </p>
                    </div>

                    {/* Footer */}
                    <footer className="rounded-3xl bg-white/50 border-t border-slate-200/60 p-8 text-center">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-slate-600">
                            Réf : {id}
                        </p>
                        <p className="text-[10px] text-slate-600">
                            {data.viewCount} consultation{data.viewCount > 1 ? 's' : ''} de ce dossier
                        </p>
                    </footer>
                </div>
            </div>
        </>
    );
}

// @ts-ignore
function InfoItem({ icon, label, value }) {
    return (
        <div className="group flex items-center gap-4">
            <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-500 transition-all duration-300 group-hover:bg-indigo-600 group-hover:text-white">
                {icon}
            </div>
            <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase leading-none text-slate-600">{label}</p>
                <p className="text-sm font-bold text-slate-800">{value}</p>
            </div>
        </div>
    );
}
