// @ts-nocheck
import { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import SEO from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

/**
 * PKG-11 / A06 — run history: the synchronization queue (runs requested by an administrator, executed by the cron consumer: waiting, running, done, partly done,
 * failed with the next attempt) and the import logs. Before: English labels, import logs only (a queued run that never ran was invisible), and an empty table
 * when the request failed.
 */
const QUEUE_STATE = { PENDING: 'En attente', RUNNING: 'En cours', COMPLETE: 'Terminée', PARTIAL: 'Terminée en partie', FAILED: 'Échec définitif' };
const IMPORT_STATE = { SUCCESS: 'Réussi', PARTIAL: 'Partiel', FAILED: 'Échec', ERROR: 'Échec' };
const when = (d) => { try { return d ? format(new Date(d), 'dd/MM/yyyy HH:mm', { locale: fr }) : '—'; } catch { return '—'; } };
const variant = (s) => (['COMPLETE', 'SUCCESS'].includes(s) ? 'default' : ['FAILED', 'ERROR'].includes(s) ? 'destructive' : 'secondary');

export default function AdminRuns() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(false);

    const load = () => { setError(false); setData(null); apiClient.admin.getRuns().then((res) => setData(res)).catch(() => setError(true)); };
    useEffect(() => { load(); }, []);

    const queue = data?.queue;
    const logs = data?.data || [];
    return (
        <div className="container mx-auto space-y-6 py-8">
            <SEO title="Exécutions — administration" noindex={true} />
            <h1 className="text-3xl font-bold">Exécutions des synchronisations et imports</h1>
            {error ? <div role="alert" data-testid="admin-runs-error" className="text-slate-900"><p>L’historique n’a pas pu être chargé.</p><button type="button" className="mt-2 rounded border px-3 py-1 text-sm underline" data-testid="admin-runs-retry" onClick={load}>Réessayer</button></div> : null}
            {!data && !error ? <p role="status">Chargement…</p> : null}
            {data ? (
                <>
                    <Card>
                        <CardHeader><CardTitle>File de synchronisation</CardTitle></CardHeader>
                        <CardContent>
                            {queue === null ? <p data-testid="admin-runs-queue-unavailable">La file n’a pas pu être lue.</p> : queue.length === 0 ? <p data-testid="admin-runs-queue-empty">Aucune synchronisation demandée.</p> : (
                                <Table scrollLabel="File de synchronisation">
                                    <TableHeader><TableRow>
                                        <TableHead>Source</TableHead><TableHead>État</TableHead><TableHead>Demandée</TableHead><TableHead>Terminée</TableHead>
                                        <TableHead>Essais</TableHead><TableHead>Ajoutés / traités</TableHead><TableHead>Erreur</TableHead>
                                    </TableRow></TableHeader>
                                    <TableBody>
                                        {queue.map((r) => (
                                            <TableRow key={r.id} data-testid="admin-run-queue" data-status={r.status}>
                                                <TableCell className="font-mono text-xs">{r.sourceId || '—'}</TableCell>
                                                <TableCell><Badge variant={variant(r.status)}>{QUEUE_STATE[r.status] || r.status}</Badge>{r.status === 'PENDING' && r.nextRunAt ? <span className="block text-xs text-slate-700">prochain essai : {when(r.nextRunAt)}</span> : null}</TableCell>
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
                        <CardHeader><CardTitle>Imports (tâches planifiées)</CardTitle></CardHeader>
                        <CardContent>
                            {logs.length === 0 ? <p data-testid="admin-runs-imports-empty">Aucun import enregistré.</p> : (
                                <Table scrollLabel="Imports">
                                    <TableHeader><TableRow>
                                        <TableHead>Date</TableHead><TableHead>Source</TableHead><TableHead>État</TableHead><TableHead>Nouveaux / total</TableHead><TableHead>Durée</TableHead><TableHead>Erreurs</TableHead>
                                    </TableRow></TableHeader>
                                    <TableBody>
                                        {logs.map((run) => (
                                            <TableRow key={run.id} data-testid="admin-run-import">
                                                <TableCell>{when(run.createdAt)}</TableCell>
                                                <TableCell>{run.source_name || '—'}</TableCell>
                                                <TableCell><Badge variant={variant(run.status)}>{IMPORT_STATE[run.status] || run.status}</Badge></TableCell>
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
