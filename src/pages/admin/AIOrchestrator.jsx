import { Link } from 'react-router-dom';
import { useT } from '@/i18n';

/**
 * ADA Admin — « Orchestrateur ».
 * PKG-11 audit pass 2: this page used to be a SIMULATION — a « national scan » that contacted nothing and displayed invented results (« 1560 aides indexées,
 * 580 versions FALC générées », sources « online » with made-up counts, « Protocole Pro Max 100% Actif ») as if they were real operations. The real pipeline
 * (POST /api/admin/orchestrator) stays off unless ENABLE_AI_AGENT is set, and it would contact external sites: it is not started from a button here. The page
 * now says what is true and points to the screens where the catalogue is actually governed.
 */
export default function AIOrchestrator() {
    const { t } = useT('admin');
    return (
        <div className="p-6 max-w-3xl space-y-4">
            <h1 className="text-2xl font-bold text-slate-900">{t('admin:orchestrator.title', 'Orchestrateur de collecte')}</h1>
            <p role="status" data-testid="orchestrator-off" className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
                {t('admin:orchestrator.off', 'La collecte automatique n\'est pas active : aucun scan n\'est lancé depuis cette page, et aucun site externe n\'est contacté sans autorisation explicite.')}
            </p>
            <p className="text-sm text-slate-700">
                {t('admin:orchestrator.how_records_enter', 'Les fiches entrent dans le catalogue par la saisie gouvernée de l\'administration et par les synchronisations autorisées. Une fiche n\'est présentée comme vérifiée qu\'après sa vérification — automatique par la veille (décision D-5 v2, relecteur « ada-veille-automatique ») ou par une personne —, avec sa source officielle.')}
            </p>
            <ul className="list-disc pl-5 text-sm space-y-1">
                <li><Link className="text-blue-700 underline underline-offset-2" to="/admin/review-queue">{t('admin:orchestrator.link.review_queue', 'File de revue')}</Link></li>
                <li><Link className="text-blue-700 underline underline-offset-2" to="/admin/signalements">{t('admin:orchestrator.link.reports', 'Signalements')}</Link></li>
                <li><Link className="text-blue-700 underline underline-offset-2" to="/admin/versions">{t('admin:orchestrator.link.versions', 'Versions et vérifications des fiches')}</Link></li>
                <li><Link className="text-blue-700 underline underline-offset-2" to="/admin/sync">{t('admin:orchestrator.link.sync', 'Historique des synchronisations')}</Link></li>
            </ul>
        </div>
    );
}
