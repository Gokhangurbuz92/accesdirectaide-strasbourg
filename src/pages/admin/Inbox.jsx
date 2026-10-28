// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/api/client';
import SEO from '@/components/SEO';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function AdminInbox() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('brouillon');
    const [page] = useState(1);
    const [selectedIds, setSelectedIds] = useState([]);
    const [notice, setNotice] = useState('');

    const fetchInbox = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiClient.admin.getInbox(statusFilter, page);
            setItems(Array.isArray(res?.data) ? res.data : []);
        } catch {
            setItems([]);
            toast.error("Impossible de charger la liste des actualités.");
        } finally {
            setLoading(false);
        }
    }, [statusFilter, page]);

    useEffect(() => {
        fetchInbox();
    }, [fetchInbox]);

    // launch-readiness item 65: the reason of a publication / rejection (journalised)
    const [reason, setReason] = useState('');

    // @ts-ignore
    const handleAction = async (action, id) => {
        const ids = id ? [id] : selectedIds;
        if (ids.length === 0) return;
        if (action !== 'RETRY_FALC' && reason.trim().length < 10) {
            setNotice('Indiquez le motif de la décision (10 caractères au moins) avant de publier ou de rejeter.');
            return;
        }

        // PKG-11 / P10: say what really changed (the server publishes only items linking to their source over https)
        const verb = { PUBLISH: 'publiée(s)', REJECT: 'rejetée(s)', RETRY_FALC: 'renvoyée(s) en FALC' }[action] || 'traitée(s)';
        try {
            const r = await apiClient.admin.performAction(action, ids, action === 'RETRY_FALC' ? undefined : reason.trim());
            const done = Number(r?.count ?? 0);
            const msg = done === ids.length ? `${done} actualité(s) ${verb}.`
                : `${done} sur ${ids.length} actualité(s) ${verb}.${action === 'PUBLISH' ? ' Une actualité sans lien https vers sa source ne peut pas être publiée.' : ''}`;
            setNotice(msg);
            (done === ids.length ? toast.success : toast.error)(msg);
            fetchInbox();
            setSelectedIds([]);
        } catch {
            setNotice("L'action n'a pas été appliquée (erreur). Réessayez.");
            toast.error("L'action n'a pas été appliquée (erreur).");
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const getScoreColor = (/** @type {number} */ score) => {
        if (score >= 80) return "bg-green-100 text-green-800";
        if (score >= 50) return "bg-yellow-100 text-yellow-800";
        return "bg-red-100 text-red-800";
    };

    return (
        <div className="container mx-auto py-8 space-y-6">
            <SEO title="Modération des actualités" noindex={true} />

            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold">Boîte de réception — actualités</h1>
                <div className="space-x-2">
                    <Button variant={statusFilter === 'brouillon' ? 'default' : 'outline'} onClick={() => setStatusFilter('brouillon')}>Brouillons</Button>
                    <Button variant={statusFilter === 'publie' ? 'default' : 'outline'} onClick={() => setStatusFilter('publie')}>Publiés</Button>
                    <Button variant={statusFilter === 'rejected' ? 'default' : 'outline'} onClick={() => setStatusFilter('rejected')}>Rejetés</Button>
                </div>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Actualités ({items.length})</CardTitle>
                    <div className="space-x-2">
                        <Button size="sm" variant="secondary" onClick={fetchInbox}><RefreshCw className="h-4 w-4 mr-2" />Actualiser</Button>
                        {selectedIds.length > 0 && (
                            <>
                                <Button size="sm" onClick={() => handleAction('PUBLISH')}>Tout Publier</Button>
                                <Button size="sm" variant="destructive" onClick={() => handleAction('REJECT')}>Tout Rejeter</Button>
                            </>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="mb-3">
                        <label htmlFor="inbox-reason" className="block text-sm font-medium text-slate-800">Motif de la décision (obligatoire pour publier ou rejeter)</label>
                        <input id="inbox-reason" data-testid="admin-inbox-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
                            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Ex. : source officielle vérifiée, information utile aux Strasbourgeois" />
                    </div>
                    <p role="status" data-testid="admin-inbox-status" className="text-sm text-slate-700 mb-2 min-h-[1.25rem]">{notice}</p>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">Choisir</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead>Titre / FALC</TableHead>
                                <TableHead>Score</TableHead>
                                <TableHead>Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8">Chargement...</TableCell>
                                </TableRow>
                            ) : items.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8" data-testid="admin-inbox-empty">Aucune actualité dans cette liste.</TableCell>
                                </TableRow>
                            ) : items.map((item) => (
                                <TableRow key={item.id} className="hover:bg-gray-50" data-testid="admin-inbox-row">
                                    <TableCell>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(item.id)}
                                            onChange={() => toggleSelect(item.id)}
                                            aria-label={`Choisir « ${item.titre} »`}
                                            className="h-6 w-6 rounded border-gray-300"
                                        />
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap">
                                        {item.fetched_at && !Number.isNaN(new Date(item.fetched_at).getTime()) ? format(new Date(item.fetched_at), 'dd/MM HH:mm', { locale: fr }) : '—'}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{item.source_name}</Badge>
                                    </TableCell>
                                    <TableCell className="max-w-md">
                                        <div className="font-medium truncate" title={item.titre}>{item.titre}</div>
                                        <div className="text-sm text-gray-500 flex items-center mt-1">
                                            {item.falc_status === 'generated' ? (
                                                <Badge variant="secondary" className="text-xs mr-2">FALC OK</Badge>
                                            ) : (
                                                <Badge variant="destructive" className="text-xs mr-2">FALC {item.falc_status}</Badge>
                                            )}
                                            <a href={item.canonical_url} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center">
                                                Original <ExternalLink className="h-3 w-3 ml-1" />
                                            </a>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge className={getScoreColor(item.quality_score)}>
                                            {item.quality_score}/100
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex space-x-1">
                                            <Button size="icon" variant="ghost" className="h-11 w-11 text-green-600" onClick={() => handleAction('PUBLISH', item.id)} title="Publier" aria-label={`Publier « ${item.titre} »`}>
                                                <Check className="h-4 w-4" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-11 w-11 text-red-600" onClick={() => handleAction('REJECT', item.id)} title="Rejeter" aria-label={`Rejeter « ${item.titre} »`}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                            {item.falc_status === 'failed' && (
                                                <Button size="icon" variant="ghost" className="h-11 w-11 text-blue-600" onClick={() => handleAction('RETRY_FALC', item.id)} title="Relancer FALC" aria-label={`Relancer le FALC de « ${item.titre} »`}>
                                                    <RefreshCw className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
