import { Lock } from 'lucide-react';
import { useT } from '@/i18n';

/**
 * G3 (19/11/2026) — a console module this deployment does not serve yet (src/lib/proModules.js). Said as « pas encore ouvert », never as an outage: the
 * module waits for its data-protection framework (and, where needed, certified health-data hosting), nothing is broken and nothing was read.
 */
export function NotYetOpenNotice({ testId = 'pro-module-not-open' }) {
    const { t } = useT('pro');
    return (
        <section className="max-w-2xl rounded-2xl border border-ada-line bg-ada-surface p-6 shadow-sm sm:p-8" data-testid={testId} aria-labelledby="pro-not-open-title">
            <h1 id="pro-not-open-title" className="flex items-center gap-2 text-xl font-bold text-slate-900">
                <Lock className="h-5 w-5 text-slate-600" aria-hidden="true" />
                {t('pro:not_open.title', 'Pas encore ouvert')}
            </h1>
            <p className="mt-2 text-sm text-slate-800">
                {t('pro:not_open.body', 'Cette partie de l’espace professionnel n’est pas encore ouverte. Elle le sera lorsque son cadre de protection des données (et, si nécessaire, un hébergement certifié des données de santé) sera en place. Ce n’est pas une panne : aucune donnée n’a été lue.')}
            </p>
        </section>
    );
}

/** the short mark next to a closed entry */
export function NotYetOpenBadge() {
    const { t } = useT('pro');
    return <span className="mt-0.5 inline-block whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700" data-testid="pro-not-open-badge">{t('pro:not_open.badge', 'pas encore ouvert')}</span>;
}
