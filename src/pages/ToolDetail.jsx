// @ts-nocheck

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Download, ExternalLink } from 'lucide-react';
import { sanitizeHtml } from '@/lib/sanitize';
import LoadError from '@/components/LoadError';

export default function ToolDetail() {
    const { slug } = useParams();
    const [tool, setTool] = useState(null);
    const [loading, setLoading] = useState(true);
    // PKG-11 audit pass 2 (P11 / Q10): « not found » (404) and « could not load » are different answers; an outage used to read « Outil introuvable »
    const [state, setState] = useState('ok'); const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        setLoading(true); setState('ok');
        fetch(`/api/tools?slug=${encodeURIComponent(slug || '')}`)
            .then(async (res) => {
                if (res.status === 404) { setTool(null); setState('missing'); return; }
                if (!res.ok) throw new Error(`tool ${res.status}`);
                setTool(await res.json());
            })
            .catch(e => { if (import.meta.env.DEV) console.error(e); setState('failed'); })
            .finally(() => setLoading(false));
    }, [slug, attempt]);

    if (loading) return <div className="p-8 text-center" role="status">Chargement…</div>;
    if (state === 'failed') return <div className="max-w-4xl mx-auto px-4 py-8"><h1 className="sr-only">Outil</h1><LoadError what="cet outil" onRetry={() => setAttempt((n) => n + 1)} testId="tool-error" /></div>;
    if (!tool) return (
        <div className="max-w-4xl mx-auto px-4 py-8 text-center" data-testid="tool-missing">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Outil introuvable</h1>
            <p className="text-slate-700 mb-4">Cet outil n&apos;existe pas ou n&apos;est pas publié.</p>
            <Link to="/outils" className="text-blue-700 underline underline-offset-2">Voir les outils publiés</Link>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <SEO
                title={`${tool.titre} - Outil`}
                description={tool.resume_falc || "Détail de l'outil"}
                path={`/outils/${slug}`}
            />

            <Link to="/outils" className="text-purple-600 hover:underline mb-6 block">
                &larr; Retour à la boite à outils
            </Link>

            <article className="bg-white p-8 rounded-lg shadow-lg border-t-4 border-purple-500">
                <header className="mb-8">
                    <div className="flex flex-wrap gap-2 mb-4">
                        <span className="bg-purple-100 text-purple-800 text-sm px-3 py-1 rounded-full uppercase font-bold">
                            {tool.type}
                        </span>
                        {tool.categorie && <span className="text-gray-500 text-sm px-2 py-1 bg-gray-100 rounded">{tool.categorie}</span>}
                    </div>

                    <h1 className="text-3xl font-bold text-gray-900 mb-4">{tool.titre}</h1>

                    {tool.resume_falc && (
                        <div className="text-lg text-gray-700 leading-relaxed max-w-2xl">
                            {tool.resume_falc}
                        </div>
                    )}
                </header>

                <div className="grid md:grid-cols-3 gap-8">
                    <div className="md:col-span-2 prose max-w-none text-gray-800">
                        {tool.contenu_html ? (
                            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(tool.contenu_html) }} />
                        ) : (
                            <p className="italic text-gray-500">Pas de description détaillée disponible.</p>
                        )}
                    </div>

                    <div className="md:col-span-1">
                        <div className="bg-gray-50 p-6 rounded-lg sticky top-4">
                            <h3 className="font-bold text-gray-900 mb-4">Accéder à l'outil</h3>

                            {tool.url_download ? (
                                <a
                                    href={tool.url_download}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block w-full text-center bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded transition flex items-center justify-center gap-2"
                                >
                                    {tool.type === 'numerique' ? <ExternalLink size={20} /> : <Download size={20} />}
                                    {tool.type === 'numerique' ? 'Ouvrir le site' : 'Télécharger'}
                                </a>
                            ) : (
                                <div className="text-gray-500 text-sm text-center">
                                    Cet outil est consultable ci-contre.
                                </div>
                            )}

                            <div className="mt-6 border-t pt-4">
                                <h4 className="text-sm font-semibold text-gray-700 mb-2">Publics cibles :</h4>
                                <div className="flex flex-wrap gap-2">
                                    {tool.publics?.map(p => (
                                        <span key={p} className="text-xs bg-white border px-2 py-1 rounded text-gray-600">
                                            {p}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </article>
        </div>
    );
}
