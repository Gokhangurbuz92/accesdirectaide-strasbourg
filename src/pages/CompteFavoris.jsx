// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate } from '@/lib/monEspace';

const PATH = { aide: '/aides/', demarche: '/demarches/', structure: '/structures/' };
const TYPE = { aide: 'Aide', demarche: 'Démarche', structure: 'Structure' };

/** PKG-2 / C10 — Mes favoris (/compte/favoris). A favourite whose record is no longer published stays listed, without its content, so the person understands why. */
export default function CompteFavoris() {
  const [state, setState] = useState({ loading: true, error: '', favorites: [] });
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', favorites: (await citizenApi.listFavorites()).favorites || [] }); }
    catch (err) { setState({ loading: false, error: err.status === 401 ? 'Connectez-vous pour voir vos favoris.' : err.message, favorites: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">Chargement de vos favoris…</div>;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-favoris">
      <SEO title="Mes favoris" noindex />
      <h1 className="text-2xl font-bold text-slate-900">Mes favoris</h1>
      {state.error ? <div role="alert" data-testid="favoris-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900"><p>{state.error}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={load}>Réessayer</Button></div> : null}
      <div aria-live="polite" role="status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      <Card>
        <CardHeader><CardTitle className="text-lg">Fiches gardées</CardTitle></CardHeader>
        <CardContent>
          {state.favorites.length ? (
            <ul className="space-y-2" data-testid="favoris-list">
              {state.favorites.map((f) => (
                <li key={`${f.entityType}:${f.entityId}`} data-testid="favori-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <span>{TYPE[f.entityType]} — {f.available ? <Link className="font-medium text-blue-800 underline" to={`${PATH[f.entityType]}${encodeURIComponent(f.slug)}`}>{f.title}</Link> : <span data-testid="favori-unavailable">Cette fiche n’est plus publiée.</span>} <span className="text-slate-600">(ajoutée le {formatDate(f.createdAt)})</span></span>
                  <Button type="button" size="sm" variant="outline" onClick={async () => {
                    // R12 (C10): a failed removal says so (it was an unhandled error and the list looked unchanged without explanation)
                    try { await citizenApi.removeFavorite(f.entityType, f.entityId); setMessage('Favori retiré.'); load(); }
                    catch (err) { setMessage(''); setState((s) => ({ ...s, error: err.message || 'Le favori n’a pas pu être retiré.' })); }
                  }}>Retirer</Button>
                </li>
              ))}
            </ul>
          ) : state.error || state.loading ? null : <p className="text-sm text-slate-700" data-testid="favoris-empty">Aucun favori. Sur une fiche publiée, utilisez « Ajouter à mes favoris ».</p>}
        </CardContent>
      </Card>
    </div>
  );
}
