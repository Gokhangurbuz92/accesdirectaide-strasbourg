// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

// R40: the labels are in the interface language (namespace `diagnostic`); the keys are the values the wizard stores
const URGENCIES = ['today', '7days', '1month'];
const OPTIONS = ['handicap', 'langue', 'numerique'];

// @ts-ignore
export default function StepUrgency({ onNext, onBack }) {
    const { t } = useT('diagnostic');
    const LABELS = {
        today: t('diagnostic:wizard.urgency.today', "Aujourd'hui"),
        '7days': t('diagnostic:wizard.urgency.week', 'Dans les 7 jours'),
        '1month': t('diagnostic:wizard.urgency.month', "J'ai le temps (1 mois+)"),
        handicap: t('diagnostic:wizard.urgency.disability', 'Situation de handicap'),
        langue: t('diagnostic:wizard.urgency.language', 'Besoin de traduction / interprétariat'),
        numerique: t('diagnostic:wizard.urgency.digital', 'Difficulté avec le numérique'),
    };
    const [urgency, setUrgency] = useState('');
    const [options, setOptions] = useState([]);

    const toggleOption = (key) => {
        setOptions((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
        );
    };

    return (
        <div>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">{t('diagnostic:wizard.urgency.title', "Niveau d'urgence")}</h2>
            <p className="mb-4 text-sm text-slate-600">{t('diagnostic:wizard.urgency.intro', 'Pour prioriser les recommandations.')}</p>

            <fieldset className="mb-5">
                <legend className="sr-only">{t('diagnostic:wizard.urgency.legend', 'Urgence')}</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('diagnostic:wizard.urgency.title', "Niveau d'urgence")}>
                    {URGENCIES.map((key) => (
                        <button
                            key={key}
                            type="button"
                            role="radio"
                            aria-checked={urgency === key}
                            onClick={() => setUrgency(key)}
                            className={`rounded-lg border px-3 py-2 min-h-[2.75rem] text-base sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${urgency === key
                                ? 'border-blue-600 bg-blue-50 text-blue-700'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            {LABELS[key]}
                        </button>
                    ))}
                </div>
            </fieldset>

            <fieldset className="mb-5">
                <legend className="mb-2 text-sm font-medium text-slate-700">{t('diagnostic:wizard.urgency.options', 'Options complémentaires (optionnel)')}</legend>
                <div className="space-y-2">
                    {OPTIONS.map((key) => (
                        <label
                            key={key}
                            className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            <input
                                type="checkbox"
                                checked={options.includes(key)}
                                onChange={() => toggleOption(key)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                            />
                            {LABELS[key]}
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="flex items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={onBack}>{t('diagnostic:wizard.back', 'Retour')}</Button>
                <Button type="button" size="sm" disabled={!urgency} onClick={() => onNext({ urgency, options })}>
                    {t('diagnostic:wizard.continue', 'Continuer')}
                </Button>
            </div>
        </div>
    );
}
