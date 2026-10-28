// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';

/**
 * R7 — the old addresses of an aide (/aidedetail?slug=… or ?id=…, /aide/view?id=…). They rendered the detail page without a slug, which could only answer
 * « Page introuvable » whatever the record. Now: ?slug= goes to the aide's page, ?id= is resolved by the public API (which shows only what the public may see)
 * and then goes to the aide's page; an address without either, or a record the public cannot see, says so with a way to the list.
 */
export default function AideLegacyLink() {
  const [params] = useSearchParams();
  const slug = params.get('slug'); const id = params.get('id');
  const [target, setTarget] = useState(slug ? `/aides/${encodeURIComponent(slug)}` : null);
  const [state, setState] = useState(slug ? 'redirect' : id ? 'resolving' : 'missing');
  useEffect(() => {
    if (slug || !id) return undefined;
    let live = true;
    fetch(`/api/aides?id=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 404 || r.status === 410) { setState('unknown'); return; }
        if (!r.ok) { setState('unavailable'); return; }
        const a = await r.json().catch(() => null);
        const s = a?.slug || a?.data?.slug;
        if (s) { setTarget(`/aides/${encodeURIComponent(s)}`); setState('redirect'); } else setState('unknown');
      })
      .catch(() => { if (live) setState('unavailable'); });
    return () => { live = false; };
  }, [slug, id]);
  if (state === 'redirect' && target) return <Navigate to={target} replace />;
  const copy = {
    resolving: { title: 'Ouverture de la fiche…', body: 'Recherche de la fiche demandée.' },
    missing: { title: 'Aide introuvable : lien incomplet', body: 'Cette adresse ne précise pas quelle aide afficher.' },
    unknown: { title: 'Aide introuvable', body: 'Aucune aide publiée ne correspond à ce lien : elle a pu être retirée, ou le lien est incomplet.' },
    unavailable: { title: 'Fiche momentanément indisponible', body: 'La fiche n’a pas pu être chargée. Ce n’est pas une absence d’aide : réessayez dans un instant.' },
  }[state];
  return (
    <div className="max-w-xl mx-auto px-4 py-12" data-testid="aide-legacy-link" data-state={state}>
      <SEO title={copy.title} description={copy.body} noindex />
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{copy.title}</h1>
      <p className="text-slate-700 mb-6" role={state === 'resolving' ? 'status' : undefined}>{copy.body}</p>
      {state !== 'resolving' ? <Link to="/aides" className="underline font-medium text-indigo-700">Voir toutes les aides</Link> : null}
    </div>
  );
}
