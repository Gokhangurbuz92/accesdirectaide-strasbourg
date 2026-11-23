// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';

/**
 * G14-AID — the banner of an assisted session (« mode accompagnant »), on every page while it runs: who helps, until when, and « Arrêter » (signs out at
 * once, no password needed). It reads the SAME cached session check as the header (query « header-auth-check », GET /api/auth/me → session.assist): no
 * extra request. The server enforces the limits whatever this banner shows.
 */
export default function AssistedModeBanner() {
  const { t } = useT('compte');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['header-auth-check'], queryFn: () => rdvMessagingClient.authMe(), staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
  const assist = q.data?.session?.kind === 'user' ? q.data?.session?.assist : null;
  if (!assist) return null;
  const stop = async () => {
    setBusy(true);
    try { await citizenApi.endAssist(); } catch { /* the session ends at its time anyway; the sign-out below clears this page */ }
    window.location.assign('/');
  };
  return (
    <section aria-label={t('compte:assist.banner_label', 'Mode accompagnant en cours')} className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-950" data-testid="assist-banner">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-2 text-sm">
        <p><strong>{t('compte:assist.banner_title', 'Mode accompagnant')}</strong> — {t('compte:assist.banner_text', '{{name}} vous aide jusqu’à {{time}}. Tout est noté dans votre historique.', { name: assist.helper?.name || '', time: formatDate(assist.until, { timeStyle: 'short' }) })}</p>
        <span className="flex flex-wrap gap-2">
          <Link to="/compte/accompagnement" className="rounded-md border border-amber-400 px-3 py-1 underline">{t('compte:assist.banner_details', 'Voir')}</Link>
          <button type="button" onClick={stop} disabled={busy} className="rounded-md bg-amber-900 px-3 py-1 font-medium text-white" data-testid="assist-banner-stop">{t('compte:assist.banner_stop', 'Arrêter')}</button>
        </span>
      </div>
    </section>
  );
}
