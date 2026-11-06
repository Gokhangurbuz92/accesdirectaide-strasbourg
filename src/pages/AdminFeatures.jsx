// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { adminClient as client } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Shield,
  Info,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';

/**
 * AdminFeatures
 *
 * Page de visualisation des feature flags du système ADA.
 * Données live depuis GET /api/admin/features.
 *
 * Les flags sont en lecture seule (pilotés par variables d'environnement).
 */
// R47: the flags' names and descriptions in the interface language, by flag id (api/_handlers/admin/features.js sends them in French; an unknown id keeps it)
const flagLabels = (/** @type {(k: string, d: string) => string} */ t) => /** @type {Record<string, string>} */ ({
  AI_AGENT: t('admin:features.flag.ai_agent.label', 'Agent conversationnel (IA)'),
  RAG: t('admin:features.flag.rag.label', 'Recherche Sémantique (RAG)'),
  OPENFISCA: t('admin:features.flag.openfisca.label', 'Calculateur OpenFisca'),
  CACHE: t('admin:features.flag.cache.label', 'Cache Distribué'),
  MAINTENANCE: t('admin:features.flag.maintenance.label', 'Mode Maintenance'),
  AUDIT_LOG: t('admin:features.flag.audit_log.label', 'Audit RGPD'),
});
const flagDescriptions = (/** @type {(k: string, d: string) => string} */ t) => /** @type {Record<string, string>} */ ({
  AI_AGENT: t('admin:features.flag.ai_agent.description', 'Active l’assistant conversationnel ; aucun fournisseur d’IA en ligne n’est approuvé pour la production (modèle local du LAB seulement).'),
  RAG: t('admin:features.flag.rag.description', 'Utilise pgvector pour sourcer les réponses de l\'IA.'),
  OPENFISCA: t('admin:features.flag.openfisca.description', 'Interroge un moteur OpenFisca pour les simulations ; sans moteur déployé, le résultat reste une estimation non officielle.'),
  CACHE: t('admin:features.flag.cache.description', 'Réduit les coûts API en mémorisant les calculs.'),
  MAINTENANCE: t('admin:features.flag.maintenance.description', 'Chaque page affiche la page de maintenance (MAINTENANCE_MODE=1).'),
  AUDIT_LOG: t('admin:features.flag.audit_log.description', 'Journalise les accès aux données sensibles.'),
});

export default function AdminFeatures() {
    const { t } = useT('admin');
    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-features'],
        // R7: the handler answers { success, data: { flags, note } } — read the inner data (the page used to show 0/0 whatever the flags)
        queryFn: () => client.get('/api/admin/features').then(r => r.data?.data ?? r.data),
        refetchInterval: 10_000,
    });

    if (isLoading) {
        return (
            <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <Card>
                    <CardContent className="p-8 text-center">
                        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                        <p className="text-slate-600" role="alert" data-testid="admin-features-problem">{t('admin:features.load_error', 'Erreur de chargement des fonctionnalités')}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const flags = data?.flags || [];
    const enabledCount = flags.filter(f => f.enabled).length;

    return (
        <div className="min-h-screen bg-slate-50" data-testid="admin-features">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 py-6">
                <div className="max-w-4xl mx-auto px-4 sm:px-6">
                    <div className="flex items-center gap-3">
                        <Shield className="text-indigo-600" size={28} />
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">
                                {t('admin:features.title', 'Pilotage des Fonctionnalités')}
                            </h1>
                            <p className="text-slate-600 text-sm" data-testid="admin-features-count">
                                {t('admin:features.count', '{{enabled}}/{{total}} fonctionnalités actives', { enabled: enabledCount, total: flags.length })}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                {/* Flags List */}
                <Card>
                    <CardContent className="p-0 divide-y divide-slate-100">
                        {flags.map((/** @type {{ description: string | number, enabled: string | number, id: string | number, label: string | number }} */ flag) => (
                            <div
                                key={flag.id}
                                data-testid="admin-feature-flag" data-flag={flag.id} data-enabled={flag.enabled ? 'true' : 'false'}
                                className="p-5 flex items-center justify-between hover:bg-slate-50 transition"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-slate-800">{flagLabels(t)[flag.id] || flag.label}</span>
                                        <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                                            {flag.id}
                                        </code>
                                    </div>
                                    <p className="text-sm text-slate-600 max-w-md">{flagDescriptions(t)[flag.id] || flag.description}</p>
                                </div>

                                <div className="flex items-center gap-3">
                                    {flag.enabled ? (
                                        <Badge className="bg-emerald-100 text-emerald-800 border-0 gap-1">
                                            <CheckCircle className="h-3 w-3" />
                                            {t('admin:features.active', 'Actif')}
                                        </Badge>
                                    ) : (
                                        <Badge className="bg-slate-100 text-slate-700 border-0 gap-1">
                                            <XCircle className="h-3 w-3" />
                                            {t('admin:features.inactive', 'Inactif')}
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                {/* Info Note */}
                <div className="flex gap-3 p-4 bg-amber-50 rounded-xl border border-amber-100">
                    <Info className="text-amber-600 shrink-0 mt-0.5" size={18} />
                    <p className="text-xs text-amber-800 leading-relaxed">
                        <Trans i18n={i18n} i18nKey="admin:features.note" defaults="<0>Note :</0> Les feature flags sont pilotés par les variables d'environnement de production. Pour modifier un flag de manière persistante, mettez à jour le fichier <1>.env.production</1> et redémarrez l'API."
                            components={[<strong key="n" />, <code key="c" className="bg-amber-100 px-1 rounded" />]} />
                    </p>
                </div>

                {/* Env var reference */}
                <Card>
                    <CardContent className="p-4">
                        <h3 className="font-bold text-slate-800 mb-3">{t('admin:features.env_vars', 'Variables d\'environnement')}</h3>
                        <div className="bg-slate-900 rounded-lg p-4 text-sm font-mono text-slate-300 space-y-1">
                            {flags.map((/** @type {{ enabled: string | number, id: string | number, label: string | number }} */ flag) => (
                                <div key={flag.id}>
                                    <span className="text-slate-400"># {flagLabels(t)[flag.id] || flag.label}</span>
                                    <br />
                                    <span className="text-emerald-400">ENABLE_{flag.id}</span>
                                    <span className="text-slate-400">=</span>
                                    <span className={flag.enabled ? 'text-emerald-300' : 'text-red-300'}>
                                        {flag.enabled ? 'true' : 'false'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
