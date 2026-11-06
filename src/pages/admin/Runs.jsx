// @ts-nocheck
import { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import SEO from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import i18n, { useT } from '@/i18n';
import { formatDateTime } from '@/i18n';

/**
 * PKG-11 / A06 — run history: the synchronization queue (runs requested by an administrator, executed by the cron consumer: waiting, running, done, partly done,
 * failed with the next attempt) and the import logs. Before: English labels, import logs only (a queued run that never ran was invisible), and an empty table
 * when the request failed.
 */
const QUEUE_STATE = () => ({ PENDING: i18n.t('admin:runs.queue.pending', 'En attente'), RUNNING: i18n.t('admin:runs.queue.running', 'En cours'), COMPLETE: i18n.t('admin:runs.queue.complete', 'Terminée'), PARTIAL: i18n.t('admin:runs.queue.partial', 'Terminée en partie'), FAILED: i18n.t('admin:runs.queue.failed', 'Échec définitif') });
const IMPORT_STATE = () => ({ SUCCESS: i18n.t('admin:runs.import.success', 'Réussi'), PARTIAL: i18n.t('admin:runs.import.partial', 'Partiel'), FAILED: i18n.t('admin:runs.import.failed', 'Échec'), ERROR: i18n.t('admin:runs.import.failed', 'Échec') });
const when = (d) => { try { return d ? formatDateTime(d) : '—'; } catch { return '—'; } };
const variant = (s) => (['COMPLETE', 'SUCCESS'].includes(s) ? 'default' : ['FAILED', 'ERROR'].includes(s) ? 'destructive' : 'secondary');

export default function AdminRuns() {
    const { t } = useT('admin');
    const [data, setData] = useState(null);
    const [error, setError] = useState(false);

    const load = () => { setError(false); setData(null); apiClient.admin.getRuns().then((res) => setData(res)).catch(() => setError(true)); };
    useEffect(() => { load(); }, []);

    const queue = data?.queue;
    const logs = data?.data || [];
    return (
        <div className="container mx-auto space-y-6 py-8">
            <SEO title={t('admin:runs.seo_title', 'Exécutions — administration')} noindex={true} />
            <h1 className="text-3xl font-bold">{t('admin:runs.title', 'Exécutions des synchronisations et imports')}</h1>
            {error ? <div role="alert" data-testid="admin-runs-error" className="text-slate-900"><p>{t('admin:runs.load_error', 'L’historique n’a pas pu être chargé.')}</p><button type="button" className="mt-2 rounded border px-3 py-1 text-sm underline" data-testid="admin-runs-retry" onClick={load}>{t('admin:runs.retry', 'Réessayer')}</button></div> : null}
            {!data && !error ? <p role="status">{t('admin:runs.loading', 'Chargement…')}</p> : null}
            {data ? (
                <>
                    <Card>
                        <CardHeader><CardTitle>{t('admin:runs.queue_title', 'File de synchronisation')}</CardTitle></CardHeader>
                        <CardContent>
                            {queue === null ? <p data-testid="admin-runs-queue-unavailable">{t('admin:runs.queue_unavailable', 'La file n’a pas pu être lue.')}</p> : queue.length === 0 ? <p data-testid="admin-runs-queue-empty">{t('admin:runs.queue_empty', 'Aucune synchronisation demandée.')}</p> : (
                                <Table scrollLabel={t('admin:runs.queue_title', 'File de synchronisation')}>
                                    <TableHeader><TableRow>
                                        <TableHead>{t('admin:runs.col.source', 'Source')}</TableHead><TableHead>{t('admin:runs.col.state', 'État')}</TableHead><TableHead>{t('admin:runs.col.requested', 'Demandée')}</TableHead><TableHead>{t('admin:runs.col.ended', 'Terminée')}</TableHead>
                                        <TableHead>{t('admin:runs.col.attempts', 'Essais')}</TableHead><TableHead>{t('admin:runs.col.added_processed', 'Ajoutés / traités')}</TableHead><TableHead>{t('admin:runs.col.error', 'Erreur')}</TableHead>
                                    </TableRow></TableHeader>
                                    <TableBody>
                                        {queue.map((r) => (
                                            <TableRow key={r.id} data-testid="admin-run-queue" data-status={r.status}>
                                                <TableCell className="font-mono text-xs">{r.sourceId || '—'}</TableCell>
                                                <TableCell><Badge variant={variant(r.status)}>{QUEUE_STATE()[r.status] || r.status}</Badge>{r.status === 'PENDING' && r.nextRunAt ? <span className="block text-xs text-slate-700">{t('admin:runs.next_attempt', 'prochain essai : {{when}}', { when: when(r.nextRunAt) })}</span> : null}</TableCell>
                                                <TableCell>{when(r.requestedAt)}</TableCell>
                                                <TableCell>{when(r.endedAt)}</TableCell>
                                                <TableCell>{r.attempts ?? 0}</TableCell>
                                                <TableCell>{r.stats ? `${r.stats.addedItems ?? 0} / ${r.stats.totalItems ?? 0}` : '—'}</TableCell>
                                                <TableCell className="max-w-xs truncate text-xs text-slate-700">{r.error || '—'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>{t('admin:runs.imports_title', 'Imports (tâches planifiées)')}</CardTitle></CardHeader>
                        <CardContent>
                            {logs.length === 0 ? <p data-testid="admin-runs-imports-empty">{t('admin:runs.imports_empty', 'Aucun import enregistré.')}</p> : (
                                <Table scrollLabel={t('admin:runs.imports', 'Imports')}>
                                    <TableHeader><TableRow>
                                        <TableHead>{t('admin:runs.col.date', 'Date')}</TableHead><TableHead>{t('admin:runs.col.source', 'Source')}</TableHead><TableHead>{t('admin:runs.col.state', 'État')}</TableHead><TableHead>{t('admin:runs.col.new_total', 'Nouveaux / total')}</TableHead><TableHead>{t('admin:runs.col.duration', 'Durée')}</TableHead><TableHead>{t('admin:runs.col.errors', 'Erreurs')}</TableHead>
                                    </TableRow></TableHeader>
                                    <TableBody>
                                        {logs.map((run) => (
                                            <TableRow key={run.id} data-testid="admin-run-import">
                                                <TableCell>{when(run.createdAt)}</TableCell>
                                                <TableCell>{run.source_name || '—'}</TableCell>
                                                <TableCell><Badge variant={variant(run.status)}>{IMPORT_STATE()[run.status] || run.status}</Badge></TableCell>
                                                <TableCell>{run.items_new ?? 0} / {run.items_total ?? 0}</TableCell>
                                                <TableCell>{run.duration_ms != null ? `${Math.round(run.duration_ms / 1000)} s` : '—'}</TableCell>
                                                <TableCell>{run.error_count ?? 0}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </>
            ) : null}
        </div>
    );
}
