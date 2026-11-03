// @ts-nocheck
import { useState, useCallback, useEffect, useRef } from 'react';
import { storage } from '@/lib/storage';
import StepNeed from './StepNeed';
import StepTerritory from './StepTerritory';
import StepProfile from './StepProfile';
import StepUrgency from './StepUrgency';
import StepDiagnostic from './StepDiagnostic';
import NeedRecommendations from './NeedRecommendations';
import DiagnosticOutcome from '@/components/diagnostic/DiagnosticOutcome';
import { Button } from '@/components/ui/button';
import { csrfFetch } from '@/lib/csrf';
import { useAssessmentLabels } from '@/lib/assessmentLabelsI18n';
import { buildWizardDiagnostic, defaultHousehold } from '@/lib/wizardDiagnostic';
import { client } from '@/api/client';
import { useT } from '@/i18n';

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
    const NEED_TITLES = {
        logement: t('diagnostic:wizard.need_title.logement', 'logement'), sante: t('diagnostic:wizard.need_title.sante', 'santé'),
        travail: t('diagnostic:wizard.need_title.travail', 'travail'), papiers: t('diagnostic:wizard.need_title.papiers', 'papiers et démarches'),
        urgence: t('diagnostic:wizard.need_title.urgence', 'urgence'),
    };
    // Restore persisted wizard state (step + data) from localStorage
    const savedWizard = useRef(storage.loadWizard());
    const [step, setStep] = useState(savedWizard.current?.step ?? 0);
    const [data, setData] = useState(savedWizard.current?.data ?? {});
    const [phase, setPhase] = useState('wizard'); // wizard | diagnostic-loading | diagnostic-results | diagnostic-error
    const [error, setError] = useState(null);
    const [diagnosticData, setDiagnosticData] = useState(null);
    const abortRef = useRef(/** @type {AbortController | null} */ (null));
    const stepText = t('diagnostic:wizard.step', 'Étape {{step}} sur {{total}}', { step: step + 1, total: TOTAL_STEPS });

    // Persist wizard progress on every step/data change
    useEffect(() => {
        if (phase === 'wizard') {
            storage.saveWizard({ step, data });
        }
    }, [step, data, phase]);

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
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setPhase('diagnostic-error');
            setError(errorMessageFor(err.status || 0, err.code || null));
        }
    }, [errorMessageFor]);

    const handleNext = useCallback(
        (/** @type {Record<string, string | number | boolean | null | undefined>} */ stepData) => {
            const merged = { ...data, ...stepData };
            setData(merged);

            if (step < TOTAL_STEPS - 1) {
                setStep(step + 1);
            } else {
                // Last step (StepDiagnostic) → call OpenFisca
                fetchDiagnostic(merged);
            }
        },
        [step, data, fetchDiagnostic],
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

    const handleRetry = useCallback(() => { fetchDiagnostic(data); }, [data, fetchDiagnostic]);

    const progress = phase === 'wizard' ? ((step + 1) / TOTAL_STEPS) * 100 : 100;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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

            {/* Content */}
            <div className="p-6">
                {phase === 'wizard' && step === 0 && <StepNeed onNext={handleNext} />}
                {phase === 'wizard' && step === 1 && <StepTerritory onNext={handleNext} onBack={handleBack} />}
                {phase === 'wizard' && step === 2 && <StepProfile onNext={handleNext} onBack={handleBack} />}
                {phase === 'wizard' && step === 3 && <StepUrgency onNext={handleNext} onBack={handleBack} />}
                {phase === 'wizard' && step === 4 && <StepDiagnostic onNext={handleNext} onBack={handleBack} initialHousehold={defaultHousehold(data.situation)} />}
                {phase === 'diagnostic-loading' && (
                    <p className="text-sm text-slate-800" data-testid="wizard-diagnostic-loading">{t('diagnostic:wizard.loading', 'Analyse de votre situation en cours…')}</p>
                )}
                {phase === 'diagnostic-error' && (
                    <div role="alert" data-testid="wizard-diagnostic-error" className="space-y-3">
                        <p className="text-sm text-slate-900">{error}</p>
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" onClick={handleRetry}>{t('diagnostic:wizard.retry', 'Réessayer')}</Button>
                            <Button type="button" variant="outline" onClick={handleRestart}>{t('diagnostic:wizard.restart', 'Recommencer')}</Button>
                        </div>
                    </div>
                )}
                {phase === 'diagnostic-results' && diagnosticData?.result && (
                    <div className="space-y-4" data-testid="wizard-diagnostic-results">
                        <div data-testid="diagnostic-results">
                            <DiagnosticOutcome results={diagnosticData.result} situation={diagnosticData.situation} structureLoader={loadStructures} />
                        </div>
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
