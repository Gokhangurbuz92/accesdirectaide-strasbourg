// @ts-nocheck

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Printer } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import LazyImage from '@/components/ui/LazyImage';
import LoadError from '@/components/LoadError';

const stepsOf = (raw) => { try { const v = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(v) ? v : []; } catch { return []; } };

export default function GuideDetail() {
    const { slug } = useParams();
    const [guide, setGuide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        // an unknown or unpublished guide is 404 (« introuvable »); any other failure is said as a failure, with a retry
        setLoading(true); setFailed(false);
        fetch(`/api/guides?slug=${encodeURIComponent(slug)}`)
            .then(res => { if (res.status === 404) return null; if (!res.ok) throw new Error(`guide ${res.status}`); return res.json(); })
            .then(data => setGuide(data))
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    }, [slug, attempt]);

    if (loading) return <div className="p-8 text-center text-muted-foreground" role="status">Chargement…</div>;
    if (failed) return <div className="max-w-4xl mx-auto px-4 py-8"><LoadError what="ce guide" onRetry={() => setAttempt((n) => n + 1)} testId="guide-error" headingLevel={1} /></div>;
    if (!guide) return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <EmptyState
                headingLevel={1}
                title="Guide introuvable"
                description="Cette page n'existe pas ou a été déplacée."
                actions={
                    <Link to="/bonnes-pratiques" className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
                        Retour aux bonnes pratiques
                    </Link>
                }
            />
        </div>
    );

    const steps = stepsOf(guide.contenu_json);

    return (
        <div className="max-w-4xl mx-auto px-4 py-8 print:p-0 print:max-w-none">
            <SEO
                title={`${guide.titre} - Bonnes Pratiques`}
                description={guide.resume_falc || "Guide de bonnes pratiques"}
                path={`/bonnes-pratiques/${slug}`}
            />

            <div className="flex justify-between items-start mb-6 print:hidden">
                <Link to="/bonnes-pratiques" className="text-blue-600 hover:underline">
                    &larr; Retour aux bonnes pratiques
                </Link>
                <button
                    onClick={() => window.print()}
                    className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded text-gray-700 font-medium"
                >
                    <Printer size={18} />
                    Imprimer la fiche
                </button>
            </div>

            <article className="bg-white p-8 rounded-lg shadow-lg print:shadow-none print:p-0" data-testid="guide-detail">
                <header className="mb-8 border-b pb-6">
                    <div className="flex flex-wrap gap-2 mb-4">
                        {guide.categorie && (
                            <span className="bg-blue-100 text-blue-800 text-sm px-3 py-1 rounded-full uppercase font-bold print:border print:border-blue-800">
                                {guide.categorie}
                            </span>
                        )}
                        {guide.publics?.map(p => (
                            <span key={p} className="bg-green-100 text-green-800 text-sm px-3 py-1 rounded-full">
                                {p}
                            </span>
                        ))}
                    </div>

                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">{guide.titre}</h1>

                    {guide.resume_falc && (
                        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 text-lg text-gray-800 font-medium">
                            <span className="block text-sm uppercase text-yellow-700 mb-1 font-bold">Resumé Facile à Lire :</span>
                            {guide.resume_falc}
                        </div>
                    )}
                </header>

                <div className="space-y-8">
                    {Array.isArray(steps) && steps.map((step, idx) => (
                        <section key={idx} className="print:break-inside-avoid" data-testid="guide-step">
                            {step.titre && <h3 className="text-2xl font-bold text-blue-900 mb-3">{idx + 1}. {step.titre}</h3>}
                            {step.texte && <div className="prose max-w-none text-gray-700 whitespace-pre-line">{step.texte}</div>}
                            {step.image && (
                                <LazyImage src={step.image} alt="" className="mt-4 rounded shadow max-w-full md:max-w-md" />
                            )}
                        </section>
                    ))}

                    {steps.length === 0 && !guide.resume_falc && (
                        <p className="text-gray-500 italic">Contenu en cours de rédaction.</p>
                    )}
                </div>

                {(guide.sources_urls?.length > 0) && (
                    <footer className="mt-12 pt-6 border-t text-sm text-gray-500">
                        <h4 className="font-bold mb-2">Sources :</h4>
                        <ul className="list-disc pl-5">
                            {guide.sources_urls.map((/** @type {number} */ url, i) => (
                                <li key={i}>{url}</li>
                            ))}
                        </ul>
                    </footer>
                )}
            </article>
        </div>
    );
}
