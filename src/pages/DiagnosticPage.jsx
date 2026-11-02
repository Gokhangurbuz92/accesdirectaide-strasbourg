import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
    Calculator,
    RefreshCcw,
    Euro,
    Users,
    MapPin,
    Briefcase,
    AlertCircle,
    Loader2,
    ExternalLink,
    Calendar,
    Home,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSituation } from '@/hooks/useSituation';

import { csrfFetch } from '@/lib/csrf';
import DiagnosticOutcome from '@/components/diagnostic/DiagnosticOutcome';
import PrivacyNotice from '@/components/diagnostic/PrivacyNotice';
import { useAssessmentLabels } from '@/lib/assessmentLabelsI18n';
import { EMPLOYMENT_KEYS, HOUSING_KEYS, useDiagnosticLabels } from '@/lib/diagnosticLabelsI18n';
import { useLanguage, useT } from '@/i18n';
import { client } from '@/api/client';
import useCitizenHistory from '@/hooks/useCitizenHistory';

// DTA S3A: directory lookup for the plan's structure shortlist (a public, read-only listing; the person chooses a structure on its own page). Stable reference on purpose.
const loadStructures = async (/** @type {string} */ query) => {
    const res = await client.entities.Structure.filter({ q: query, limit: 20, sort: 'relevance' });
    return Array.isArray(res) ? res : (res && res.items) || [];
};
class FixedMessage extends Error {}
// blank / whitespace / non-numeric => not answered (key absent); otherwise the number (0 is a real answer)
const answered = (/** @type {string} */ key, /** @type {unknown} */ raw) => (String(raw ?? '').trim() !== '' && Number.isFinite(Number(raw)) ? { [key]: Number(raw) } : {});
const isTenant = (/** @type {string} */ status) => status === 'tenant' || status === 'tenant_hlm';

const DEFAULT_SITUATION = {
    birthDate: '',
    ageBand: '',
    salary: '',
    unemployment: '',
    rent: '',
    charges: '',
    housingStatus: '',
    householdSize: 1,
    zipCode: '',
    employmentStatus: 'salarié',
};

/** R39: after a submit, the keyboard and screen-reader focus goes to the heading of what appeared (the result, or the error) @param {HTMLElement | null | undefined} heading */
function focusHeading(heading) {
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus();
}

/**
 * DiagnosticPage
 * Page standalone de simulation des droits sociaux via OpenFisca.
 * Fonctionne sans aucune dépendance IA — moteur de calcul uniquement.
 * R39: every interface string is in the `diagnostic` namespace (six languages; the answer labels come from src/lib/diagnosticLabelsI18n.js, the
 * age bands and fixed error texts from src/lib/assessmentLabelsI18n.js). The legal disclaimer stays French (see below).
 */
export default function DiagnosticPage() {
    const { t } = useT('diagnostic');
    const { isSource, dir } = useLanguage();
    const { situation, updateField, resetSituation } = useSituation(DEFAULT_SITUATION);
    const { errorMessageFor, ageBand } = useAssessmentLabels();
    const { housing, employment } = useDiagnosticLabels();
    const [results, setResults] = useState(/** @type {Record<string, unknown> | null} */ (null));   // the /api/diagnostic answer, read only through the assessment contract (readAssessment)
    const recordHistory = useCitizenHistory();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const resultsRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const errorTitleRef = useRef(/** @type {HTMLHeadingElement | null} */ (null));
    const focusAfterSubmit = useRef(false);

    const canCalculate = Boolean((situation.birthDate || situation.ageBand) && situation.housingStatus);

    useEffect(() => {
        if (loading || !focusAfterSubmit.current) return;
        focusAfterSubmit.current = false;
        if (error) focusHeading(errorTitleRef.current);
        else if (results) focusHeading(resultsRef.current?.querySelector('#assessment-title'));
    }, [loading, results, error]);

    /**
     * Appelle POST /api/diagnostic avec l'état courant,
     * en respectant le contrat attendu par le handler existant.
     */
    const handleCalculate = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await csrfFetch('/api/diagnostic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'SIMULATION_MODE',
                    answers: {
                        // DTA S2B (data minimisation): an exact date OR an age band — never both
                        ...(situation.birthDate ? { birthDate: situation.birthDate } : { ageBand: situation.ageBand }),
                        householdSize: Number(situation.householdSize) || 1,
                        territory: situation.zipCode || '',
                        statut: situation.employmentStatus || '',
                        // DTA S1D: a BLANK field is "not answered" (absent => the assessment reports the fact as missing), an explicit 0 is a known zero.
                        income: {
                            ...answered('salary', situation.salary),
                            ...answered('unemployment', situation.unemployment),
                        },
                        housing: {
                            // rent is only asked for tenants; for any other status it does not apply and is the known value 0
                            ...(isTenant(situation.housingStatus) ? answered('rent', situation.rent) : { rent: 0 }),
                            charges: Number(situation.charges) || 0,
                            status: situation.housingStatus,
                        },
                    },
                }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                // fixed texts only: nothing the server (or an intermediary) sends back is displayed verbatim
                throw new FixedMessage(errorMessageFor(response.status, errData && errData.error));
            }

            const data = await response.json();
            setResults(data);
            // R12 (C11): the opt-in history keeps that a simulation was made — never the situation or the results
            recordHistory({ kind: 'diagnostic', label: 'Simulation de mes droits', ref: '/diagnostic' });
        } catch (err) {
            // fixed texts only: a network error ("Failed to fetch"), a CSRF bootstrap failure or any other exception is never shown verbatim
            setError(err instanceof FixedMessage ? err.message : errorMessageFor(0, null));
        } finally {
            focusAfterSubmit.current = true;
            setLoading(false);
        }
    };

    const handleReset = () => {
        resetSituation();
        setResults(null);
        setError(null);
    };

    /**
     * R39: the housing-status choice is a radio group, so the arrow keys move the choice (left and right follow the reading direction) as screen-reader
     * users expect (from the focused option, wrapping around); Tab still reaches each option.
     * @param {import('react').KeyboardEvent<HTMLButtonElement>} e @param {string} key  the focused option
     */
    const onHousingKey = (e, key) => {
        const step = /** @type {Record<string, number>} */ ({ ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 })[e.key];
        if (!step) return;
        e.preventDefault();
        const delta = dir === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') ? -step : step;
        const next = HOUSING_KEYS[(HOUSING_KEYS.indexOf(key) + delta + HOUSING_KEYS.length) % HOUSING_KEYS.length];
        updateField('housingStatus', next);
        const target = e.currentTarget.parentElement?.querySelector(`button[data-value="${next}"]`);
        if (target instanceof HTMLElement) target.focus();
    };

    return (
        <>
            <Helmet>
                <title>{t('diagnostic:page.meta_title', 'Simulateur de Droits Sociaux | Accès Direct Aide')}</title>
                <meta
                    name="description"
                    content={t('diagnostic:page.meta_description', 'Pré-orientez-vous localement vers certaines aides. Cette simulation est indicative, non-opposable et ne remplace pas une instruction officielle.')}
                />
            </Helmet>

            <div className="mx-auto max-w-5xl px-4 py-8 md:py-12">
                {/* Header */}
                <header className="mb-10 text-center">
                    <div role="status" aria-live="polite" data-testid="simulation-mode-badge" className="mb-4 inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-700">
                        <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('diagnostic:page.badge', 'Simulation locale — indicative et non-opposable')}
                    </div>
                    <h1 className="mb-3 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
                        {t('diagnostic:page.title', 'Simulateur de Droits Sociaux')}
                    </h1>
                    <p className="mx-auto mb-4 max-w-xl text-sm text-slate-700 md:text-base">
                        {t('diagnostic:page.intro', "Obtenez des pistes d'orientation, non officielles, vers certaines aides sociales.")}
                    </p>
                    <PrivacyNotice />
                </header>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
                    {/* ─── Formulaire ─── */}
                    <div className="min-w-0 lg:col-span-5">
                        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 md:p-8">
                            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
                                <Calculator className="h-4 w-4" aria-hidden="true" /> {t('diagnostic:form.title', 'Ma situation')}
                            </h2>

                            {/* Date de naissance */}
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="diag-birthdate" className="flex items-center gap-2 text-xs font-bold text-slate-600">
                                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                                    {t('diagnostic:form.birth_date', 'Date de naissance')}
                                </label>
                                <input
                                    id="diag-birthdate"
                                    type="date"
                                    value={situation.birthDate}
                                    onChange={(e) => updateField('birthDate', e.target.value)}
                                    max={new Date().toISOString().split('T')[0]}
                                    aria-describedby="diag-ageband-hint"
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                                />
                            </div>

                            {/* Tranche d'âge (alternative à la date de naissance : minimisation des données) */}
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="diag-ageband" className="text-xs font-bold text-slate-600">{t('diagnostic:form.age_band', "Tranche d'âge (facultatif)")}</label>
                                <select
                                    id="diag-ageband"
                                    value={situation.ageBand}
                                    onChange={(e) => updateField('ageBand', e.target.value)}
                                    disabled={!!situation.birthDate}
                                    aria-describedby="diag-ageband-hint"
                                    className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60"
                                >
                                    <option value="">{t('diagnostic:form.age_band_none', 'Non précisée')}</option>
                                    {Object.entries(ageBand).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                                </select>
                                <p id="diag-ageband-hint" className="text-xs text-slate-700">{t('diagnostic:form.age_band_hint', "Choisissez une tranche d'âge si vous ne souhaitez pas donner votre date de naissance. Un seul des deux suffit.")}</p>
                            </div>

                            {/* Revenus */}
                            <fieldset className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                                <legend className="px-2 text-xs font-bold text-slate-600">
                                    <Euro className="me-1 inline h-3.5 w-3.5" aria-hidden="true" /> {t('diagnostic:form.income', 'Revenus mensuels nets')}
                                </legend>
                                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div>
                                        <label htmlFor="diag-salary" className="mb-1 block text-xs text-slate-600">{t('diagnostic:form.salary', 'Salaire net (€/mois)')}</label>
                                        <input
                                            id="diag-salary"
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={situation.salary}
                                            onChange={(e) => updateField('salary', e.target.value)}
                                            placeholder="0"
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="diag-unemployment" className="mb-1 block text-xs text-slate-600">{t('diagnostic:form.unemployment', 'Allocations chômage (€/mois)')}</label>
                                        <input
                                            id="diag-unemployment"
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={situation.unemployment}
                                            onChange={(e) => updateField('unemployment', e.target.value)}
                                            placeholder="0"
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                                        />
                                    </div>
                                </div>
                            </fieldset>

                            {/* Logement */}
                            <fieldset className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                                <legend className="px-2 text-xs font-bold text-slate-600">
                                    <Home className="me-1 inline h-3.5 w-3.5" aria-hidden="true" /> {t('diagnostic:form.housing', 'Logement')}
                                </legend>

                                <div className="mb-3 mt-2">
                                    <span className="mb-2 block text-xs text-slate-600" id="housing-status-label">
                                        {t('diagnostic:form.housing_status', "Statut d'occupation")} <span className="text-red-700" aria-hidden="true">*</span>
                                        <span className="sr-only"> {t('diagnostic:form.required', '(obligatoire)')}</span>
                                    </span>
                                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="housing-status-label" aria-required="true">
                                        {HOUSING_KEYS.map((key) => (
                                            <button
                                                key={key}
                                                type="button"
                                                role="radio"
                                                data-value={key}
                                                aria-checked={situation.housingStatus === key}
                                                onClick={() => updateField('housingStatus', key)}
                                                onKeyDown={(e) => onHousingKey(e, key)}
                                                className={`min-h-[2.75rem] rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${situation.housingStatus === key
                                                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                                    }`}
                                            >
                                                {housing[key]}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div>
                                        <label htmlFor="diag-rent" className="mb-1 block text-xs text-slate-600">{t('diagnostic:form.rent', 'Loyer mensuel (€)')}</label>
                                        <input
                                            id="diag-rent"
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={situation.rent}
                                            onChange={(e) => updateField('rent', e.target.value)}
                                            placeholder="0"
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="diag-charges" className="mb-1 block text-xs text-slate-600">{t('diagnostic:form.charges', 'Charges locatives (€)')}</label>
                                        <input
                                            id="diag-charges"
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={situation.charges}
                                            onChange={(e) => updateField('charges', e.target.value)}
                                            placeholder="0"
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                                        />
                                    </div>
                                </div>
                            </fieldset>

                            {/* Foyer & Statut pro */}
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="flex min-w-0 flex-col gap-1.5">
                                    <label htmlFor="diag-household" className="flex items-center gap-2 text-xs font-bold text-slate-600">
                                        <Users className="h-3.5 w-3.5" aria-hidden="true" /> {t('diagnostic:form.household', 'Foyer')}
                                    </label>
                                    <select
                                        id="diag-household"
                                        value={situation.householdSize}
                                        onChange={(e) => updateField('householdSize', Number(e.target.value))}
                                        className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                                    >
                                        <option value={1}>{t('diagnostic:form.household_1', 'Personne seule')}</option>
                                        <option value={2}>{t('diagnostic:form.household_2', 'Couple')}</option>
                                        <option value={3}>{t('diagnostic:form.household_3', '3 personnes')}</option>
                                        <option value={4}>{t('diagnostic:form.household_4', '4 personnes et plus')}</option>
                                    </select>
                                </div>
                                <div className="flex min-w-0 flex-col gap-1.5">
                                    <label htmlFor="diag-employment" className="flex items-center gap-2 text-xs font-bold text-slate-600">
                                        <Briefcase className="h-3.5 w-3.5" aria-hidden="true" /> {t('diagnostic:form.employment', 'Statut pro')}
                                    </label>
                                    <select
                                        id="diag-employment"
                                        value={situation.employmentStatus}
                                        onChange={(e) => updateField('employmentStatus', e.target.value)}
                                        className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                                    >
                                        {EMPLOYMENT_KEYS.map((key) => (
                                            <option key={key} value={key}>{employment[key]}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="diag-zip" className="flex items-center gap-2 text-xs font-bold text-slate-600">
                                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {t('diagnostic:form.zip', 'Code postal')}
                                </label>
                                <input
                                    id="diag-zip"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="postal-code"
                                    maxLength={5}
                                    value={situation.zipCode}
                                    onChange={(e) => updateField('zipCode', e.target.value)}
                                    placeholder="75001"
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col gap-3 border-t border-slate-100 pt-6">
                                {!canCalculate && (
                                    <p id="diag-calculate-hint" className="text-xs text-slate-700" data-testid="diag-calculate-hint">
                                        {t('diagnostic:form.calculate_hint', "Pour obtenir des pistes, indiquez votre date de naissance ou une tranche d'âge, et votre statut d'occupation.")}
                                    </p>
                                )}
                                <Button
                                    type="button"
                                    onClick={handleCalculate}
                                    disabled={loading || !canCalculate}
                                    aria-describedby={canCalculate ? undefined : 'diag-calculate-hint'}
                                    className="gap-2 py-6 text-base font-bold"
                                    id="diag-calculate-btn"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                                            {t('diagnostic:form.loading', 'Analyse en cours…')}
                                        </>
                                    ) : (
                                        <>
                                            <Calculator className="h-5 w-5" aria-hidden="true" />
                                            {t('diagnostic:form.submit', "Obtenir mes pistes d'orientation")}
                                        </>
                                    )}
                                </Button>
                                <button
                                    type="button"
                                    onClick={handleReset}
                                    className="flex min-h-11 items-center justify-center gap-2 py-2 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                                >
                                    <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t('diagnostic:form.reset', 'Réinitialiser tout')}
                                </button>
                            </div>
                        </div>

                        {/* Info box — R39: a legal notice (« non-opposable », « valeur légale »): kept in French in every language (a translation could
                            change its legal meaning), with a plain one-line summary in the interface language */}
                        <div className="mt-4 flex items-start gap-3 rounded-xl bg-slate-100 px-4 py-3 text-slate-600" data-testid="diag-legal-notice">
                            <ExternalLink className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                            <div>
                                <p className="text-xs font-medium leading-snug" lang="fr" dir="ltr">
                                    Cette simulation est indicative et non-opposable. Seule une instruction officielle par l&apos;organisme compétent (CAF, CPAM, Département) a valeur légale.
                                </p>
                                {isSource ? null : (
                                    <p className="mt-1 text-xs leading-snug text-slate-700" data-testid="diag-legal-summary">
                                        {t('diagnostic:page.legal_summary', 'En bref : ce n’est pas une décision. Seul l’organisme compétent (CAF, CPAM, Département) décide.')}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ─── Résultats ─── */}
                    <div className="min-w-0 lg:col-span-7">
                        {error && (
                            <div role="alert" aria-live="assertive" className="mb-6 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-5" data-testid="diag-error">
                                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-700" aria-hidden="true" />
                                <div>
                                    <h2 ref={errorTitleRef} id="diag-error-title" className="text-sm font-bold text-red-900">{t('diagnostic:error.title', 'Les pistes d’orientation n’ont pas pu être obtenues')}</h2>
                                    <p id="diag-error-text" className="mt-1 text-sm font-medium text-red-800">{error}</p>
                                    <Button type="button" size="sm" variant="outline" className="mt-3 gap-2" onClick={handleCalculate} aria-describedby="diag-error-text">
                                        <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t('diagnostic:error.retry', 'Réessayer')}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {results ? (
                            <div data-testid="diagnostic-results" ref={resultsRef}>
                                <p role="status" className="sr-only">{t('diagnostic:results.announce', "Nouvelles pistes d'orientation affichées.")}</p>
                                <DiagnosticOutcome results={results} situation={situation} structureLoader={loadStructures} />
                            </div>
                        ) : (
                            <div className="flex h-full min-h-[450px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center sm:p-12">
                                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-slate-100 bg-white text-slate-300 shadow-sm">
                                    <Calculator className="h-10 w-10" aria-hidden="true" />
                                </div>
                                <h2 className="mb-2 text-lg font-bold text-slate-700">{t('diagnostic:results.empty_title', 'Lancez le diagnostic')}</h2>
                                <p className="max-w-xs text-sm leading-relaxed text-slate-600">
                                    {t('diagnostic:results.empty_text', "Complétez les informations à gauche pour obtenir des pistes d'orientation (RSA, APL, FAJ'EMS…). Ce n'est pas une décision.")}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
