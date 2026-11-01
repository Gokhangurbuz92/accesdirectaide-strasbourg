// @ts-nocheck

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Download, ExternalLink } from 'lucide-react';
import { sanitizeHtml } from '@/lib/sanitize';
import LoadError from '@/components/LoadError';
import { useLanguage, useT } from '@/i18n';

export default function ToolDetail() {
    const { t } = useT('tools');
    const { isSource } = useLanguage();
    // R32: the tool's own texts come from the API in French: marked as such when the interface is in another language
    const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
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

    if (loading) return <div className="p-8 text-center" role="status">{t('tools:loading', 'Chargement…')}</div>;
    if (state === 'failed') return <div className="max-w-4xl mx-auto px-4 py-8"><h1 className="sr-only">{t('tools:detail.heading', 'Outil')}</h1><LoadError what={t('tools:detail.error-what', 'cet outil')} onRetry={() => setAttempt((n) => n + 1)} testId="tool-error" /></div>;
    if (!tool) return (
        <div className="max-w-4xl mx-auto px-4 py-8 text-center" data-testid="tool-missing">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('tools:detail.missing.title', 'Outil introuvable')}</h1>
            <p className="text-slate-700 mb-4">{t('tools:detail.missing.text', 'Cet outil n\'existe pas ou n\'est pas publié.')}</p>
            <Link to="/outils" className="text-blue-700 underline underline-offset-2">{t('tools:detail.missing.link', 'Voir les outils publiés')}</Link>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <SEO
                title={t('tools:detail.seo-title', '{{title}} - Outil', { title: tool.titre })}
                description={tool.resume_falc || t('tools:detail.seo-description', 'Détail de l\'outil')}
                path={`/outils/${slug}`}
            />

            <Link to="/outils" className="text-purple-600 hover:underline mb-6 block">
                {t('tools:detail.back', '← Retour à la boite à outils')}
            </Link>

            <article className="bg-white p-8 rounded-lg shadow-lg border-t-4 border-purple-500">
                <header className="mb-8">
                    <div className="flex flex-wrap gap-2 mb-4">
                        <span className="bg-purple-100 text-purple-800 text-sm px-3 py-1 rounded-full uppercase font-bold" {...fr}>
                            {tool.type}
                        </span>
                        {tool.categorie && <span className="text-gray-500 text-sm px-2 py-1 bg-gray-100 rounded" {...fr}>{tool.categorie}</span>}
                    </div>

                    <h1 className="text-3xl font-bold text-gray-900 mb-4" {...fr}>{tool.titre}</h1>

                    {tool.resume_falc && (
                        <div className="text-lg text-gray-700 leading-relaxed max-w-2xl" {...fr}>
                            {tool.resume_falc}
                        </div>
                    )}
                </header>

                <div className="grid md:grid-cols-3 gap-8">
                    <div className="md:col-span-2 prose max-w-none text-gray-800">
                        {tool.contenu_html ? (
                            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(tool.contenu_html) }} {...fr} />
                        ) : (
                            <p className="italic text-gray-500">{t('tools:detail.no-description', 'Pas de description détaillée disponible.')}</p>
                        )}
                    </div>

                    <div className="md:col-span-1">
                        <div className="bg-gray-50 p-6 rounded-lg sticky top-4">
                            <h3 className="font-bold text-gray-900 mb-4">{t('tools:detail.access', 'Accéder à l\'outil')}</h3>

                            {tool.url_download ? (
                                <a
                                    href={tool.url_download}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block w-full text-center bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded transition flex items-center justify-center gap-2"
                                >
                                    {tool.type === 'numerique' ? <ExternalLink size={20} /> : <Download size={20} />}
                                    {tool.type === 'numerique' ? t('tools:detail.open-site', 'Ouvrir le site') : t('tools:detail.download', 'Télécharger')}
                                </a>
                            ) : (
                                <div className="text-gray-500 text-sm text-center">
                                    {t('tools:detail.inline', 'Cet outil est consultable ci-contre.')}
                                </div>
                            )}

                            <div className="mt-6 border-t pt-4">
                                <h4 className="text-sm font-semibold text-gray-700 mb-2">{t('tools:detail.publics', 'Publics cibles :')}</h4>
                                <div className="flex flex-wrap gap-2">
                                    {tool.publics?.map(p => (
                                        <span key={p} className="text-xs bg-white border px-2 py-1 rounded text-gray-600" {...fr}>
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
