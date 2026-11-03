// @ts-nocheck
import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

// @ts-ignore
export default function StepTerritory({ onNext, onBack }) {
    const { t } = useT('diagnostic');
    const [value, setValue] = useState('');

    const handleSubmit = (/** @type {{ preventDefault: () => void; }} */ event) => {
        event.preventDefault();
        onNext({ territory: value.trim() || undefined });
    };

    return (
        <div>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">{t('diagnostic:wizard.territory.title', 'Où habitez-vous ?')}</h2>
            <p className="mb-5 text-sm text-slate-600">{t('diagnostic:wizard.territory.intro', "Ville ou code postal (optionnel — permet d'affiner les résultats).")}</p>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                    <MapPin className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={t('diagnostic:wizard.territory.placeholder', 'Ex : 75012 ou Marseille')}
                        maxLength={60}
                        className="h-10 w-full rounded-md border border-slate-300 bg-white ps-10 pe-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                        aria-label={t('diagnostic:wizard.territory.label', 'Ville ou code postal')}
                    />
                </div>
                <div className="flex items-center gap-3">
                    <Button type="button" variant="outline" size="sm" onClick={onBack}>{t('diagnostic:wizard.back', 'Retour')}</Button>
                    <Button type="submit" size="sm">
                        {value.trim() ? t('diagnostic:wizard.continue', 'Continuer') : t('diagnostic:wizard.skip', 'Passer cette étape')}
                    </Button>
                </div>
            </form>
        </div>
    );
}
