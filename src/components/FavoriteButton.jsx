// @ts-nocheck
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';
import { useT } from '@/i18n';

/**
 * PKG-2 / C10 — "Ajouter à mes favoris" on a published record (aide, démarche, structure) for a signed-in person; also records the opt-in history entry (the server ignores
 * it unless the person switched history on). Renders nothing for an anonymous visitor and sends NO account request for them: it reuses the header's session query (same key).
 * @param {{ entityType: 'aide' | 'demarche' | 'structure', entityId: string, label: string }} props
 */
export default function FavoriteButton({ entityType, entityId, label }) {
  const { t } = useT('shared');
  const auth = useQuery({ queryKey: ['header-auth-check'], queryFn: () => rdvMessagingClient.authMe(), staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
  const isUser = auth.data?.session?.kind === 'user';
  const [state, setState] = useState({ ready: false, signedIn: false, saved: false, busy: false, error: '' });
  useEffect(() => {
    if (!isUser) return undefined;
    let alive = true;
    (async () => {
      try {
        const out = await citizenApi.listFavorites();
        if (!alive) return;
        setState({ ready: true, signedIn: true, saved: (out.favorites || []).some((f) => f.entityType === entityType && f.entityId === entityId), busy: false, error: '' });
        citizenApi.addHistory({ kind: entityType, label: String(label || '').slice(0, 120), ref: entityId }).catch(() => {});
      } catch { if (alive) setState((s) => ({ ...s, ready: true, signedIn: false })); }
    })();
    return () => { alive = false; };
  }, [isUser, entityType, entityId, label]);
  if (!state.ready || !state.signedIn || !entityId) return null;
  const toggle = async () => {
    setState((s) => ({ ...s, busy: true, error: '' }));
    try {
      if (state.saved) await citizenApi.removeFavorite(entityType, entityId); else await citizenApi.addFavorite(entityType, entityId);
      setState((s) => ({ ...s, busy: false, saved: !s.saved }));
    } catch (err) { setState((s) => ({ ...s, busy: false, error: err.message })); }
  };
  return (
    <div>
      <Button type="button" variant="outline" size="sm" data-testid="favorite-toggle" aria-pressed={state.saved} disabled={state.busy} onClick={toggle}>
        {state.saved ? t('shared:favorite.remove', 'Retirer de mes favoris') : t('shared:favorite.add', 'Ajouter à mes favoris')}
      </Button>
      {state.error ? <p role="alert" className="mt-1 text-xs text-red-800">{state.error}</p> : null}
    </div>
  );
}
