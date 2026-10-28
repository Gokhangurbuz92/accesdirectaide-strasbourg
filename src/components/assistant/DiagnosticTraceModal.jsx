// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { X, Copy, Check } from 'lucide-react';

import { getCsrfHeaders } from '@/lib/csrf';
/**
 * Modal for pro/admin users to view the OpenFisca trace detail.
 * Calls POST /api/diagnostic/trace and displays the result.
 */
// @ts-ignore
export default function DiagnosticTraceModal({ answers, onClose }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [traceData, setTraceData] = useState(null);
    const [copied, setCopied] = useState(false);
    const modalRef = useRef(null);

    useEffect(() => {
        const abortController = new AbortController();

        async function fetchTrace() {
            try {
                const res = await fetch('/api/diagnostic/trace', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
                    body: JSON.stringify({ answers }),
                    signal: abortController.signal,
                });

                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.message || `Erreur ${res.status}`);
                }

                const data = await res.json();
                setTraceData(data);
            } catch (err) {
                if (/** @type {Error} */ (err).name !== 'AbortError') {
                    setError(err.message);
                }
            } finally {
                setLoading(false);
            }
        }

        fetchTrace();
        return () => abortController.abort();
    }, [answers]);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (/** @type {{ key: string; }} */ e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleCopyJSON = async () => {
        if (!traceData) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(traceData, null, 2));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback — create a temporary textarea
            const textarea = document.createElement('textarea');
            textarea.value = JSON.stringify(traceData, null, 2);
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            role="presentation"
        >
            <div
                ref={modalRef}
                className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-label="Détail du calcul OpenFisca"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-900">
                        Détail du calcul (mode pro)
                    </h3>
                    <div className="flex items-center gap-2">
                        {traceData && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleCopyJSON}
                                className="gap-1"
                            >
                                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                                {copied ? 'Copié !' : 'Copier JSON'}
                            </Button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Fermer"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {loading && (
                    <div className="flex items-center gap-3 py-8 text-slate-500">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                        <span className="text-sm">Chargement de la trace…</span>
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-red-100 bg-red-50 p-4">
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                )}

                {traceData && (
                    <div className="space-y-4">
                        {traceData.traceSummary && (
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <h4 className="mb-2 text-sm font-medium text-slate-700">Résumé</h4>
                                <ul className="space-y-1 text-xs text-slate-600">
                                    <li>Nœuds de calcul : <strong>{traceData.traceSummary.nodesCount}</strong></li>
                                    <li>Période : <strong>{traceData.period}</strong></li>
                                </ul>
                            </div>
                        )}

                        <div>
                            <h4 className="mb-2 text-sm font-medium text-slate-700">Trace brute (JSON)</h4>
                            <pre className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-4 text-xs text-green-400">
                                {JSON.stringify(traceData.fullTrace || traceData, null, 2)}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
