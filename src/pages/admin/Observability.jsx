import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Database, Mail, Bot, Globe } from 'lucide-react';
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useT } from '@/i18n';

/** @param {unknown} value @param {any} t */
function formatOk(value, t) {
  if (value === true) return 'OK';
  if (value === false) return t('admin:observability.failed', 'En échec');
  if (value === 'skipped') return t('admin:observability.not_configured', 'Non configuré');
  return '-';
}

/** @param {unknown} value */
function badgeClassForOk(value) {
  if (value === true) return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (value === false) return 'border-rose-200 bg-rose-50 text-rose-900';
  if (value === 'skipped') return 'border-slate-200 bg-slate-50 text-slate-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

/** @param {unknown} value */
function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '-';
  return format(date, 'dd/MM/yyyy HH:mm:ss', { locale: fr });
}

/** @param {unknown} state */
function freshnessBadgeClass(state) {
  if (state === 'fresh') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (state === 'stale') return 'border-amber-200 bg-amber-50 text-amber-900';
  if (state === 'error') return 'border-rose-200 bg-rose-50 text-rose-900';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export default function AdminObservability() {
  const { t } = useT('admin');
  const [cronRuns, setCronRuns] = useState(/** @type {any[]} */ ([]));
  const [healthPublic, setHealthPublic] = useState(/** @type {any} */ (null));
  const [healthDeep, setHealthDeep] = useState(/** @type {any} */ (null));
  const [adminStats, setAdminStats] = useState(/** @type {any} */ (null));
  const [selectedCron, setSelectedCron] = useState('actualites');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveMessage, setLiveMessage] = useState('');

  const CRON_JOBS = ['actualites', 'ingest-demarches', 'ingest-annuaire', 'ingest-aids', 'hive-scan'];

  const load = useCallback(async () => {
    setLoading(true);
    let nextError = '';

    const [publicRes, deepRes, runsRes, statsRes] = await Promise.allSettled([
      apiClient.health.check(),
      apiClient.health.deep(),
      apiClient.admin.getCronRuns(selectedCron, 20),
      // owner LAB audit: this request carried no session token (401: the inventory never showed); the API client sends the administrator session
      apiClient.get('/api/admin/stats').then((r) => r?.data ?? null),
    ]);

    if (publicRes.status === 'fulfilled') {
      setHealthPublic(publicRes.value);
    } else {
      nextError = nextError || t('admin:observability.error.public', 'Le contrôle de l’API publique n’a pas pu être lu.');
    }

    if (deepRes.status === 'fulfilled') {
      setHealthDeep(deepRes.value);
    } else {
      nextError = nextError || t('admin:observability.error.deep', 'Le contrôle détaillé (base, cache, stockage) n’a pas pu être lu.');
    }

    if (runsRes.status === 'fulfilled') {
      setCronRuns(runsRes.value?.items || []);
    } else {
      nextError = nextError || t('admin:observability.error.runs', 'L’historique des tâches planifiées n’a pas pu être lu.');
    }

    if (statsRes.status === 'fulfilled' && statsRes.value?.data) {
      setAdminStats(statsRes.value.data);
    }

    setError(nextError);
    setLiveMessage(t('admin:observability.updated_at', 'Données mises à jour à {{time}}', { time: format(new Date(), 'HH:mm:ss', { locale: fr }) }));
    setLoading(false);
  }, [selectedCron, t]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const db = healthDeep?.deps?.db;
  const kv = healthDeep?.deps?.kv;
  const storage = healthDeep?.deps?.storage;
  const sentry = healthDeep?.deps?.sentry;
  const cronFreshness = healthDeep?.deps?.cron?.actualites;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <SEO title={t('admin:observability.title', 'Observabilité')} description={t('admin:observability.seo_description', 'État technique : API, base, cache, stockage, tâches planifiées.')} noindex={true} />

      <p className="sr-only" aria-live="polite">
        {liveMessage}
      </p>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('admin:observability.title', 'Observabilité')}</h1>
        <Button onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('admin:observability.refresh', 'Actualiser')}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin:observability.public_api', 'API publique')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>{t('admin:observability.responds', 'Répond')}</span>
              <Badge className={badgeClassForOk(Boolean(healthPublic?.ok))}>{healthPublic?.ok ? t('admin:observability.yes', 'Oui') : t('admin:observability.no', 'Non')}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>{t('admin:observability.environment', 'Environnement')}</span>
              <span className="font-mono">{healthPublic?.vercelEnv || '-'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t('admin:observability.version', 'Version')}</span>
              <span className="font-mono">{healthPublic?.release ? String(healthPublic.release).slice(0, 8) : '-'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>RequestId</span>
              <span className="font-mono">{healthPublic?.requestId || '-'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin:observability.deep_title', 'Base, cache et stockage')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>{t('admin:observability.overall', 'Ensemble')}</span>
              <Badge className={badgeClassForOk(healthDeep ? Boolean(healthDeep.ok) : undefined)}>{healthDeep ? (healthDeep.ok ? 'OK' : t('admin:observability.failed', 'En échec')) : t('admin:observability.not_read', 'Non lu')}</Badge>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span>{t('admin:observability.database', 'Base de données')}</span>
                <div className="flex items-center gap-2">
                  <Badge className={badgeClassForOk(db?.ok)}>{formatOk(db?.ok, t)}</Badge>
                  <span className="font-mono text-xs text-slate-700">{typeof db?.durationMs === 'number' ? `${db.durationMs}ms` : ''}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span>{t('admin:observability.kv', 'Cache partagé (KV)')}</span>
                <div className="flex items-center gap-2">
                  <Badge className={badgeClassForOk(kv?.ok)}>{formatOk(kv?.ok, t)}</Badge>
                  <span className="font-mono text-xs text-slate-700">{typeof kv?.durationMs === 'number' ? `${kv.durationMs}ms` : ''}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span>{t('admin:observability.storage', 'Stockage des documents')}</span>
                <div className="flex items-center gap-2">
                  <Badge className={badgeClassForOk(storage?.ok)}>{formatOk(storage?.ok, t)}</Badge>
                  <span className="font-mono text-xs text-slate-700">{typeof storage?.durationMs === 'number' ? `${storage.durationMs}ms` : ''}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span>RequestId</span>
              <span className="font-mono">{healthDeep?.requestId || '-'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin:observability.sentry', 'Suivi des erreurs (Sentry)')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>{t('admin:observability.configured', 'Configuré')}</span>
              <Badge className={badgeClassForOk(sentry?.dsnPresent ? true : 'skipped')}>{sentry?.dsnPresent ? t('admin:observability.yes', 'Oui') : t('admin:observability.sentry_off', 'Non : aucune erreur n’est envoyée à un service externe')}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>{t('admin:observability.environment', 'Environnement')}</span>
              <span className="font-mono">{sentry?.environment || '-'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t('admin:observability.version', 'Version')}</span>
              <span className="font-mono">{sentry?.release ? String(sentry.release).slice(0, 8) : '-'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t('admin:observability.gemini_key', 'Clé d’IA cloud (Gemini)')}</span>
              {/* launch-readiness item 57: a cloud AI key is not approved (DPIA / DPA) — present is a problem, not a green light */}
              <Badge className={badgeClassForOk(healthDeep?.deps?.geminiKeyPresent ? false : true)}>
                {healthDeep?.deps?.geminiKeyPresent ? t('admin:observability.gemini_present', 'Présente : à supprimer (fournisseur non approuvé)') : t('admin:observability.gemini_absent', 'Absente : aucun appel au fournisseur cloud')}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin:observability.freshness', 'Fraîcheur des actualités (tâche planifiée)')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>{t('admin:observability.state', 'État')}</span>
            <Badge className={freshnessBadgeClass(cronFreshness?.state)}>
              {(/** @type {Record<string, string>} */ ({ fresh: t('admin:observability.fresh', 'À jour'), stale: t('admin:observability.stale', 'En retard'), error: t('admin:observability.failed', 'En échec') }))[String(cronFreshness?.state)] || t('admin:observability.no_run_local', 'Aucune exécution (aucune tâche planifiée dans le LAB local)')}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('admin:observability.last_success', 'Dernier succès')}</span>
            <span className="font-mono text-xs">{formatDateTime(cronFreshness?.lastSuccessAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('admin:observability.last_run', 'Dernière exécution')}</span>
            <span className="font-mono text-xs">{formatDateTime(cronFreshness?.lastRunAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('admin:observability.age', 'Ancienneté (minutes)')}</span>
            <span className="font-mono text-xs">
              {typeof cronFreshness?.ageMinutes === 'number' ? cronFreshness.ageMinutes : '-'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('admin:observability.thresholds', 'Seuils retard / échec (minutes)')}</span>
            <span className="font-mono text-xs">
              {typeof cronFreshness?.thresholds?.staleMinutes === 'number'
                ? `${cronFreshness.thresholds.staleMinutes}/${cronFreshness.thresholds.failMinutes}`
                : '-'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Data Inventory (answers "are pages populated?") ── */}
      {adminStats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              {t('admin:observability.inventory', 'Inventaire des données')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: t('admin:observability.inv.aides', 'Aides'), count: adminStats.counts?.aides, warn: 10 },
                { label: t('admin:observability.inv.demarches', 'Démarches'), count: adminStats.counts?.demarches, warn: 5 },
                { label: t('admin:observability.inv.structures', 'Structures'), count: adminStats.counts?.structures || 0, warn: 10 },
                { label: t('admin:observability.inv.citizens', 'Citoyens'), count: adminStats.counts?.citizens, warn: 0 },
              ].map(({ label, count: val, warn }) => (
                <div key={label} className="rounded-xl border p-4 text-center">
                  <p className="text-xs font-bold uppercase text-slate-600 mb-1">{label}</p>
                  <p className={`text-2xl font-black ${
                    val === 0 ? 'text-red-500' : val < warn ? 'text-amber-500' : 'text-slate-900'
                  }`}>{val?.toLocaleString() ?? '—'}</p>
                  {val === 0 && <Badge className="mt-1 border-red-200 bg-red-50 text-red-700">{t('admin:observability.empty', 'VIDE')}</Badge>}
                </div>
              ))}
            </div>
            {adminStats.rag && (
              <div className="mt-4 flex items-center gap-4 text-xs">
                <span className="text-slate-700">{t('admin:observability.search_index', 'Index de recherche :')}</span>
                <Badge className={adminStats.rag.missing > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}>
                  {t('admin:observability.rag', '{{indexed}}/{{total}} aides avec un vecteur ({{missing}} sans)', { indexed: adminStats.rag.indexed, total: adminStats.rag.total, missing: adminStats.rag.missing })}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Email Provider Health ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {t('admin:observability.emails', 'E-mails')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>{t('admin:observability.provider', 'Fournisseur')}</span>
            <Badge className={healthDeep?.deps?.mailer?.provider && healthDeep.deps.mailer.provider !== 'noop'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
            }>
              {healthDeep?.deps?.mailer?.provider && healthDeep.deps.mailer.provider !== 'noop' ? healthDeep.deps.mailer.provider : t('admin:observability.no_mailer', 'Aucun : aucun e-mail n’est envoyé')}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('admin:observability.from_address', 'Adresse d’expédition configurée')}</span>
            <Badge className={badgeClassForOk(Boolean(healthDeep?.deps?.mailer?.fromPresent))}>
              {healthDeep?.deps?.mailer?.fromPresent ? t('admin:observability.yes_caps', 'OUI') : t('admin:observability.no_caps', 'NON')}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('admin:observability.history', 'Historique des tâches planifiées')}</CardTitle>
          <div className="flex gap-1">
            {CRON_JOBS.map(job => (
              <Button
                key={job}
                variant={selectedCron === job ? 'default' : 'outline'}
                size="sm"
                className="text-xs"
                onClick={() => setSelectedCron(job)}
              >
                {job}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin:observability.col.date', 'Date')}</TableHead>
                <TableHead>{t('admin:observability.col.status', 'Statut')}</TableHead>
                <TableHead>{t('admin:observability.col.trigger', 'Déclencheur')}</TableHead>
                <TableHead>{t('admin:observability.col.reason', 'Raison')}</TableHead>
                <TableHead>{t('admin:observability.col.duration', 'Durée')}</TableHead>
                <TableHead>{t('admin:observability.col.metrics', 'Mesures')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cronRuns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-slate-600">
                    {t('admin:observability.no_runs', 'Aucune exécution (normal dans le LAB local : aucune tâche n’y est planifiée).')}
                  </TableCell>
                </TableRow>
              ) : (
                cronRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs">
                      {run.startedAt ? format(new Date(run.startedAt), 'dd/MM HH:mm:ss', { locale: fr }) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          run.status === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                            : run.status === 'skipped'
                              ? 'border-amber-200 bg-amber-50 text-amber-900'
                            : run.status === 'running'
                              ? 'border-slate-200 bg-slate-50 text-slate-700'
                              : 'border-rose-200 bg-rose-50 text-rose-900'
                        }
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{run.trigger || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{run.skipReason || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{typeof run.durationMs === 'number' ? `${run.durationMs}ms` : '-'}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {run.metrics ? JSON.stringify(run.metrics) : '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
