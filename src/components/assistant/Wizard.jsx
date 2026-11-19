// @ts-nocheck
import { useState, useCallback, useEffect, useRef } from 'react';
import { storage } from '@/lib/storage';
import StepNeed from './StepNeed';
import StepTerritory from './StepTerritory';
import StepProfile from './StepProfile';
import StepUrgency from './StepUrgency';
import StepDiagnostic from './StepDiagnostic';
import NeedRecommendations from './NeedRecommendations';
import WizardPrivacyNotice from './WizardPrivacyNotice';
import DiagnosticOutcome from '@/components/diagnostic/DiagnosticOutcome';
import { Button } from '@/components/ui/button';
import { csrfFetch } from '@/lib/csrf';
import { useAssessmentLabels } from '@/lib/assessmentLabelsI18n';
import { buildWizardDiagnostic, defaultHousehold } from '@/lib/wizardDiagnostic';
import { client } from '@/api/client';
import { useT } from '@/i18n';
import FalcPageDraft from '@/components/FalcPageDraft';
import BrowserOrientationTopics from './BrowserOrientationTopics';
import { orientationBrowserOnly, runBrowserOrientation } from '@/lib/orientationBrowserOnly';

// same public directory lookup as the /diagnostic page (the plan's structure shortlist; the person chooses on the structure's own page)
const loadStructures = async (query) => {
    const res = await client.entities.Structure.filter({ q: query, limit: 20, sort: 'relevance' });
    return Array.isArray(res) ? res : (res && res.items) || [];
};
const NEED_LABELS = {
    logement: 'logement',
    sante: 'santé',
    travail: 'travail emploi',
    papiers: 'papiers droits administratifs',
    urgence: 'aide urgente hébergement alimentaire',
};

// NEED_LABELS are search words for the French catalogue (never translated); what the person chose is shown back in the interface language (needTitles)

const TOTAL_STEPS = 5;

export default function Wizard() {
    const { errorMessageFor } = useAssessmentLabels();
    const { t } = useT('diagnostic');
    // G4: VITE_ORIENTATION_BROWSER_ONLY=1 — the whole orientation runs in this page: no request with the answers, no storage, no measure
    const local = orientationBrowserOnly();
    const NEED_TITLES = {
        logement: t('diagnostic:wizard.need_title.logement', 'logement'), sante: t('diagnostic:wizard.need_title.sante', 'santé'),
        travail: t('diagnostic:wizard.need_title.travail', 'travail'), papiers: t('diagnostic:wizard.need_title.papiers', 'papiers et démarches'),
        urgence: t('diagnostic:wizard.need_title.urgence', 'urgence'),
    };
    // A-9: progress is restored from this tab's session only (first steps' choices; src/lib/storage.js)
    const savedWizard = useRef(local ? null : storage.loadWizard());
    const [step, setStep] = useState(savedWizard.current?.step ?? 0);
    const [data, setData] = useState(savedWizard.current?.data ?? {});
    const [phase, setPhase] = useState('wizard'); // wizard | diagnostic-loading | diagnostic-results | diagnostic-error
    const [error, setError] = useState(null);
    const [diagnosticData, setDiagnosticData] = useState(null);
    const abortRef = useRef(/** @type {AbortController | null} */ (null));
    const [cleared, setCleared] = useState(false);
    const topRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const stepText = t('diagnostic:wizard.step', 'Étape {{step}} sur {{total}}', { step: step + 1, total: TOTAL_STEPS });

    // Persist wizard progress on every step/data change
    useEffect(() => {
        if (phase === 'wizard' && !local) {
            storage.saveWizard({ step, data });
        }
    }, [step, data, phase, local]);

    // G4: in the browser-only mode nothing is written; a copy left in this tab by the server mode is removed, never read
    useEffect(() => { if (local) storage.clearWizard(); }, [local]);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    // PKG-11 / P16: the wizard ends on the SAME honest assessment as /diagnostic (seven states, « why », plan, structures) — before, it read the legacy `rights`
    // list and showed « Aucun droit calculé »; error texts are fixed (never the server's words)
    const fetchDiagnostic = useCallback(async (/** @type {Record<string, any>} */ wizardData) => {
        setPhase('diagnostic-loading');
        setError(null);
        setDiagnosticData(null);

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const { body, situation } = buildWizardDiagnostic(wizardData);
        try {
            const res = await csrfFetch('/api/diagnostic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok) throw Object.assign(new Error('diagnostic'), { status: res.status, code: result && result.error });
            setDiagnosticData({ result, situation });
            setPhase('diagnostic-results');
            storage.clearWizard();   // A-9: once the result is shown nothing of the answers stays in the browser's storage
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setPhase('diagnostic-error');
            setError(errorMessageFor(err.status || 0, err.code || null));
        }
    }, [errorMessageFor]);

    // G4: the same SIMULATION_MODE chain as the server, computed here (src/lib/orientationBrowserOnly.js); an unreadable answer = the server's own message
    const computeLocally = useCallback((/** @type {Record<string, any>} */ wizardData) => {
        setError(null);
        try {
            setDiagnosticData(runBrowserOrientation(wizardData));
            setPhase('diagnostic-results');
        } catch (err) {
            setDiagnosticData(null);
            setPhase('diagnostic-error');
            setError(errorMessageFor(err?.status || 400, err?.code || 'validation_error'));
        }
    }, [errorMessageFor]);

    const handleNext = useCallback(
        (/** @type {Record<string, string | number | boolean | null | undefined>} */ stepData) => {
            const merged = { ...data, ...stepData };
            setData(merged);
            setCleared(false);

            if (step < TOTAL_STEPS - 1) {
                setStep(step + 1);
            } else {
                // Last step (StepDiagnostic) → call OpenFisca
                if (local) computeLocally(merged); else fetchDiagnostic(merged);
            }
        },
        [step, data, fetchDiagnostic, computeLocally, local],
    );

    const handleBack = useCallback(() => {
        if (step > 0) setStep(step - 1);
    }, [step]);

    const handleRestart = useCallback(() => {
        abortRef.current?.abort();
        storage.clearWizard();
        setStep(0);
        setData({});
        setPhase('wizard');
        setError(null);
        setDiagnosticData(null);
    }, []);

    const handleRetry = useCallback(() => { if (local) computeLocally(data); else fetchDiagnostic(data); }, [data, fetchDiagnostic, computeLocally, local]);

    // G4: « Effacer mes réponses » — every answer and the result leave the page's memory; said in words, focus back to the top of the questionnaire
    const handleErase = useCallback(() => {
        handleRestart();
        setCleared(true);
        topRef.current?.focus();
    }, [handleRestart]);
    const eraseLabel = t('diagnostic:wizard.local.erase', 'Effacer mes réponses');
    const eraseButton = local ? (
        <Button type="button" variant="outline" onClick={handleErase} data-testid="wizard-erase">{eraseLabel}</Button>
    ) : null;

    const progress = phase === 'wizard' ? ((step + 1) / TOTAL_STEPS) * 100 : 100;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm" data-mode={local ? 'browser-only' : 'server'} ref={topRef} tabIndex={-1} aria-label={local ? t('diagnostic:wizard.local.region', 'Questionnaire d’orientation (dans votre navigateur)') : undefined} role={local ? 'region' : undefined}>
            {/* RGAA: Live announcement of step changes for screen readers */}
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {phase === 'wizard'
                    ? stepText
                    : phase === 'loading' || phase === 'diagnostic-loading'
                        ? t('diagnostic:wizard.announce_loading', 'Calcul en cours, veuillez patienter.')
                        : phase === 'results' || phase === 'diagnostic-results'
                            ? t('diagnostic:wizard.announce_results', 'Résultats disponibles.')
                            : phase === 'error' || phase === 'diagnostic-error'
                                ? t('diagnostic:wizard.announce_error', 'Une erreur est survenue.')
                                : ''}
            </p>
            {/* Progress bar */}
            {phase === 'wizard' && (
                <div className="px-6 pt-5">
                    <div className="mb-1 flex justify-between text-slate-700 font-bold uppercase text-[10px] tracking-widest">
                        <span>{stepText}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-valuetext={stepText} aria-label={t('diagnostic:wizard.progress', 'Progression du diagnostic')}>
                        <div
                            className="h-full rounded-full bg-blue-600 transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* A-9: what happens to the answers, said before the first personal question and kept in view on every step */}
            {phase === 'wizard' && <div className="px-6 pt-4"><WizardPrivacyNotice local={local} /></div>}
            {local && cleared && (
                <p role="status" data-testid="wizard-erased" className="mx-6 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                    {t('diagnostic:wizard.local.erased', 'Vos réponses ont été effacées. Rien n’a été envoyé ni enregistré.')}
                </p>
            )}
            {local && phase === 'wizard' && step > 0 && <div className="px-6 pt-4">{eraseButton}</div>}

            {/* Content */}
            <div className="p-6">
                {phase === 'wizard' && step === 0 && <StepNeed onNext={handleNext} />}
                {phase === 'wizard' && step === 1 && <StepTerritory onNext={handleNext} onBack={handleBack} />}
                {phase === 'wizard' && step === 2 && <StepProfile onNext={handleNext} onBack={handleBack} local={local} />}
                {phase === 'wizard' && step === 3 && <StepUrgency onNext={handleNext} onBack={handleBack} />}
                {phase === 'wizard' && step === 4 && <StepDiagnostic onNext={handleNext} onBack={handleBack} initialHousehold={defaultHousehold(data.situation)} local={local} />}
                {phase === 'diagnostic-loading' && (
                    <p className="text-sm text-slate-800" data-testid="wizard-diagnostic-loading">{t('diagnostic:wizard.loading', 'Analyse de votre situation en cours…')}</p>
                )}
                {phase === 'diagnostic-error' && (
                    <div role="alert" data-testid="wizard-diagnostic-error" className="space-y-3">
                        <p className="text-sm text-slate-900">{error}</p>
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" onClick={handleRetry}>{t('diagnostic:wizard.retry', 'Réessayer')}</Button>
                            <Button type="button" variant="outline" onClick={handleRestart}>{t('diagnostic:wizard.restart', 'Recommencer')}</Button>
                            {eraseButton}
                        </div>
                    </div>
                )}
                {phase === 'diagnostic-results' && local && diagnosticData?.result && (
                    <div className="space-y-4" data-testid="wizard-diagnostic-results" data-mode="browser-only">
                        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950" data-testid="wizard-local-result-note">
                            {t('diagnostic:wizard.local.result_note', 'Ce résultat a été préparé dans votre navigateur. Rien n’a été envoyé ni enregistré. Aucune piste n’a été validée par un expert : l’organisme qui reçoit la demande décide.')}
                        </p>
                        <BrowserOrientationTopics topics={diagnosticData.topics} />
                        <div data-testid="diagnostic-results">
                            <DiagnosticOutcome results={diagnosticData.result} situation={diagnosticData.situation} local />
                        </div>
                        <FalcPageDraft id="orientationResult" />
                        <div className="flex flex-wrap gap-2">
                            {eraseButton}
                            <Button type="button" variant="outline" onClick={handleRestart}>{t('diagnostic:wizard.restart', 'Recommencer')}</Button>
                        </div>
                    </div>
                )}
                {phase === 'diagnostic-results' && !local && diagnosticData?.result && (
                    <div className="space-y-4" data-testid="wizard-diagnostic-results">
                        <div data-testid="diagnostic-results">
                            <DiagnosticOutcome results={diagnosticData.result} situation={diagnosticData.situation} structureLoader={loadStructures} />
                        </div>
                        {/* FA-D4: how to read this result, simplified (provisional draft), when « Facile à lire » is on */}
                        <FalcPageDraft id="orientationResult" />
                        {data.need && NEED_LABELS[data.need] ? (
                            <NeedRecommendations need={NEED_LABELS[data.need]} label={NEED_TITLES[data.need] || NEED_LABELS[data.need]} territory={/^\d{5}$/.test(String(data.territory || '').trim()) ? String(data.territory).trim() : undefined} />
                        ) : null}
                        <Button type="button" variant="outline" onClick={handleRestart}>{t('diagnostic:wizard.restart', 'Recommencer')}</Button>
                    </div>
                )}
            </div>
        </div>
    );
}
