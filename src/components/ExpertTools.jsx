// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { getCsrfHeaders } from '@/lib/csrf';
import {
    Sparkles,
    FileText,
    Loader2,
} from 'lucide-react';

/**
 * ExpertTools — AI Synthesis + link to the printable (unsigned) recap
 *
 * Embedded in SharedDossier sidebar for pro agents.
 *
 * Props:
 * - shareId: string
 */
const STATUS = { PENDING: 'Brouillon IA — non relu', APPROVED: 'Relu et approuvé', REJECTED: 'Rejeté' };

/**
 * PKG-6 / R17 — dossier synthesis by the LOCAL model (no external service), kept as a DRAFT until a member of the organization reviews it (approve / reject with a
 * note). A draft made before the dossier changed cannot be approved. Nothing is added to the dossier or sent anywhere.
 */
export default function ExpertTools(/** @type {Record<string, string | number | boolean | null | undefined>} */ { shareId, aiAllowed = false }) {
    const [drafts, setDrafts] = useState(/** @type {any[]} */ ([]));
    const [notes, setNotes] = useState(/** @type {Record<string, string>} */ ({}));
    const [synthLoading, setSynthLoading] = useState(false);
    const [synthError, setSynthError] = useState('');
    const [synthMsg, setSynthMsg] = useState('');

    const call = async (/** @type {string} */ method, /** @type {any} */ body) => {
        const res = await fetch(method === 'GET' ? `/api/pro/dossier-synthesis?shareId=${encodeURIComponent(String(shareId))}` : '/api/pro/dossier-synthesis', {
            // the pro session is the Bearer token of the pro pages (SharedDossier.jsx does the same); before R17 this call sent none and was refused
            method, credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('pro_token') || '' : ''}`, ...getCsrfHeaders() }, ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.message || d.error || 'Erreur');
        return d;
    };
    const load = useCallback(async () => { if (!aiAllowed) return; try { setDrafts((await call('GET')).drafts || []); } catch { /* shown on action */ } }, [shareId, aiAllowed]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    const generateSynthesis = async () => {
        setSynthLoading(true); setSynthError(''); setSynthMsg('');
        try { await call('POST', { shareId }); setSynthMsg('Brouillon créé : relisez-le avant toute utilisation.'); await load(); }
        catch (err) { setSynthError(err.message || 'Échec de la synthèse.'); }
        finally { setSynthLoading(false); }
    };
    const decide = async (/** @type {string} */ id, /** @type {'approve'|'reject'} */ decision) => {
        setSynthError(''); setSynthMsg('');
        try { await call('POST', { action: 'review', shareId, id, decision, note: notes[id] || '' }); setSynthMsg(decision === 'approve' ? 'Brouillon approuvé.' : 'Brouillon rejeté.'); await load(); }
        catch (err) { setSynthError(err.message || 'Action impossible.'); }
    };

    return (
        <div className="space-y-4">
            {/* AI Synthesis */}
            <Card data-testid="pro-synthesis">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <Sparkles size={14} className="text-indigo-500" aria-hidden="true" />
                        Synthèse IA (brouillon à relire)
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-xs text-slate-700">
                        Un modèle d&apos;IA exécuté par AccesDirectAide (aucun service externe) résume les pistes d&apos;orientation du dossier en 1 à 3 points. C&apos;est un brouillon : il n&apos;est ni une décision ni un avis professionnel, et il ne modifie pas le dossier.
                    </p>
                    {!aiAllowed && (
                        <p role="status" className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                            Désactivée : la personne n&apos;a pas autorisé l&apos;analyse automatisée par IA pour votre structure. Elle peut l&apos;autoriser depuis « Mon partage ».
                        </p>
                    )}
                    <Button size="sm" className="w-full" onClick={generateSynthesis} disabled={synthLoading || !aiAllowed} data-testid="pro-synthesis-create">
                        {synthLoading ? (<><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />Analyse locale…</>) : (<><Sparkles className="mr-2 h-3.5 w-3.5" aria-hidden="true" />Demander un brouillon</>)}
                    </Button>
                    <div role="status" aria-live="polite" className="text-xs text-slate-800" data-testid="pro-synthesis-status">{synthMsg}</div>
                    {synthError && <p role="alert" className="text-xs text-red-800 font-medium" data-testid="pro-synthesis-problem">{synthError}</p>}
                    <ul className="space-y-3">
                        {drafts.map((d) => (
                            <li key={d.id} className="space-y-2 rounded-lg border border-slate-200 p-2.5" data-testid="pro-synthesis-draft">
                                <p className="text-xs font-semibold text-slate-900">{STATUS[d.status] || d.status} · IA ({d.model})</p>
                                <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-900">{(d.points || []).map((p, i) => <li key={i}>{p}</li>)}</ol>
                                {d.sourceChanged && <p className="text-xs font-medium text-amber-800">Le dossier a changé depuis ce brouillon : il ne peut plus être approuvé.</p>}
                                {d.status === 'PENDING' ? (
                                    <div className="space-y-1">
                                        <label htmlFor={`syn-note-${d.id}`} className="block text-xs text-slate-800">Ce que vous avez vérifié</label>
                                        <input id={`syn-note-${d.id}`} className="w-full rounded border p-1.5 text-xs" value={notes[d.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))} />
                                        <div className="flex gap-2">
                                            <Button size="sm" disabled={d.sourceChanged} onClick={() => decide(d.id, 'approve')} data-testid="pro-synthesis-approve">Approuver</Button>
                                            <Button size="sm" variant="outline" onClick={() => decide(d.id, 'reject')} data-testid="pro-synthesis-reject">Rejeter</Button>
                                        </div>
                                    </div>
                                ) : <p className="text-xs text-slate-700">Relu par {d.reviewedBy}{d.reviewNote ? ` — ${d.reviewNote}` : ''}</p>}
                            </li>
                        ))}
                    </ul>
                </CardContent>
            </Card>

            {/* PKG-6 / G: before, this card simulated a 2.5 s "signature" and showed « PDF signé » although nothing was signed. No electronic signature
                exists in the product (it needs a qualified trust service and an identity check), so the card only opens the printable, explicitly UNSIGNED recap. */}
            <Card className="bg-slate-50 border-slate-200" data-testid="recap-card">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                        <FileText size={14} className="text-slate-600" aria-hidden="true" />
                        Récapitulatif imprimable
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-slate-600 mb-3">
                        Récapitulatif du dossier partagé, à imprimer ou enregistrer en PDF. Il n&apos;est pas signé et n&apos;a pas valeur d&apos;attestation officielle.
                    </p>
                    <Button asChild size="sm" variant="outline" className="w-full">
                        <Link to={`/pro/attestation/${encodeURIComponent(String(shareId))}`}>Ouvrir le récapitulatif</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
