import { Link } from 'react-router-dom';

/**
 * ADA Admin — « Orchestrateur ».
 * PKG-11 audit pass 2: this page used to be a SIMULATION — a « national scan » that contacted nothing and displayed invented results (« 1560 aides indexées,
 * 580 versions FALC générées », sources « online » with made-up counts, « Protocole Pro Max 100% Actif ») as if they were real operations. The real pipeline
 * (POST /api/admin/orchestrator) stays off unless ENABLE_AI_AGENT is set, and it would contact external sites: it is not started from a button here. The page
 * now says what is true and points to the screens where the catalogue is actually governed.
 */
export default function AIOrchestrator() {
    return (
        <div className="p-6 max-w-3xl space-y-4">
            <h1 className="text-2xl font-bold text-slate-900">Orchestrateur de collecte</h1>
            <p role="status" data-testid="orchestrator-off" className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
                La collecte automatique n&apos;est pas active : aucun scan n&apos;est lancé depuis cette page, et aucun site externe n&apos;est contacté sans
                autorisation explicite.
            </p>
            <p className="text-sm text-slate-700">
                Les fiches entrent dans le catalogue par la saisie gouvernée de l&apos;administration et par les synchronisations autorisées. Une fiche n&apos;est
                présentée comme vérifiée qu&apos;après sa vérification — automatique par la veille (décision D-5 v2, relecteur « ada-veille-automatique ») ou par une personne —, avec sa source officielle.
            </p>
            <ul className="list-disc pl-5 text-sm space-y-1">
                <li><Link className="text-blue-700 underline underline-offset-2" to="/admin/review-queue">File de revue</Link></li>
                <li><Link className="text-blue-700 underline underline-offset-2" to="/admin/signalements">Signalements</Link></li>
                <li><Link className="text-blue-700 underline underline-offset-2" to="/admin/versions">Versions et vérifications des fiches</Link></li>
                <li><Link className="text-blue-700 underline underline-offset-2" to="/admin/sync">Historique des synchronisations</Link></li>
            </ul>
        </div>
    );
}
