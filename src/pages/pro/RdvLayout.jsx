// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fetchProRdvReadiness } from '@/api/pro-rdv-client';
import ProRdvErrorBoundary from './ProRdvErrorBoundary';

const RDV_LINKS = [
  { to: '/pro/rdv/agenda', label: 'Agenda' },
  { to: '/pro/rdv/services', label: 'Services' },
  { to: '/pro/rdv/disponibilites', label: 'Disponibilités' },
  { to: '/pro/rdv/new', label: 'Créer un RDV' },
  { to: '/pro/rdv/absences', label: 'Absences' },
];

export default function ProRdvLayout() {
  const parentContext = useOutletContext() || {};
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [readiness, setReadiness] = useState({ status: null, payload: null });

  const loadReadiness = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchProRdvReadiness();
      setReadiness(result);
    } catch {
      setReadiness({ status: null, payload: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReadiness();
  }, [loadReadiness]);

  const isReady = readiness.status === 200 && readiness.payload?.ok === true;
  const missingTables = useMemo(() => {
    const candidate = readiness.payload?.missingTables;
    return Array.isArray(candidate) ? candidate : [];
  }, [readiness.payload]);

  return (
    <div className="space-y-6" data-testid="pro-rdv-layout">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rendez-vous</h1>
          <p className="text-sm text-slate-600">Gestion des motifs, disponibilités, absences et agenda.</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={loadReadiness} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Vérifier l’état
        </Button>
      </div>

      {/* owner usefulness pass (2026-10-25): the warning showed while the check was still loading (every page flashed it) and spoke to developers
          (« Voir doc go-live », table names); it now appears only when the check answered, in plain words */}
      {!loading && !isReady && (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="pro-rdv-readiness-banner"
          role="status"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              {missingTables.length > 0 ? (
                <>
                  <p className="font-medium">Les rendez-vous ne sont pas encore disponibles sur ce serveur : son installation n’est pas terminée. Prévenez l’équipe d’ADA.</p>
                  <p className="text-xs">Détail technique pour ADA : tables manquantes ({missingTables.join(', ')}).</p>
                </>
              ) : (
                <p className="font-medium">L’état des rendez-vous n’a pas pu être vérifié. Réessayez avec « Vérifier l’état ».</p>
              )}
            </div>
          </div>
        </div>
      )}

      <nav className="flex flex-wrap gap-2" aria-label="Navigation RDV Pro">
        {RDV_LINKS.map((link) => {
          const active = location.pathname.startsWith(link.to);
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <ProRdvErrorBoundary>
        <Outlet
          context={{
            ...parentContext,
            user: parentContext.user || null,
            rdvReadiness: readiness,
          }}
        />
      </ProRdvErrorBoundary>
    </div>
  );
}
