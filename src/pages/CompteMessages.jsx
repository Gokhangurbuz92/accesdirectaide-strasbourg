import { SkeletonList } from '@/components/ui/skeleton';
// @ts-nocheck
import { useMemo } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MessageCircle } from 'lucide-react';

import SEO from '@/components/SEO';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { rdvMessagingClient, messagingErrorText } from '@/api/rdv-messaging-client';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';

function formatDate(/** @type {string | number | null | undefined} */ value) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });
}

export default function CompteMessages() {
  const location = useLocation();
  const safeNext = useMemo(
    () => normalizeNextPath(location.pathname + location.search, '/compte/messages'),
    [location.pathname, location.search],
  );

  const authQuery = useQuery({
    queryKey: ['compte-messages-auth'],
    queryFn: () => rdvMessagingClient.authMe(),
    staleTime: 30_000,
  });

  const isUser = authQuery.data?.session?.kind === 'user';

  const conversationsQuery = useQuery({
    queryKey: ['compte-messages-conversations'],
    queryFn: () => rdvMessagingClient.user.listConversations(),
    enabled: isUser,
  });

  if (authQuery.isLoading) {
    return (
      <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
    );
  }

  if (!isUser) {
    return <Navigate to={appendNext('/auth/login', safeNext)} replace />;
  }

  const items = Array.isArray(conversationsQuery.data?.items) ? conversationsQuery.data.items : [];

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <SEO
        title="Mes messages"
        description="Conversation rendez-vous avec votre structure"
        path="/compte/messages"
        noindex={true}
      />

      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle as="h1" className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" />
              Mes messages
            </CardTitle>
            <CardDescription>
              Retrouvez vos conversations liées à vos rendez-vous.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {conversationsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement des conversations...
              </div>
            ) : null}

            {conversationsQuery.error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                {messagingErrorText(conversationsQuery.error, 'Impossible de charger vos messages.')}
              </p>
            ) : null}

            {!conversationsQuery.isLoading && !conversationsQuery.error && items.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
                Aucune conversation pour le moment.
                <div className="mt-3">
                  <Link to="/annuaire" className="font-medium text-primary underline">
                    Revenir a l'annuaire
                  </Link>
                </div>
              </div>
            ) : null}

            {items.length > 0 ? (
              <ul className="space-y-3" aria-label="Conversations rendez-vous">
                {items.map((/** @type {{
                    id: string;
                    structure?: { name?: string };
                    appointment?: { serviceName?: string; startsAt?: string | number };
                    lastMessagePreview?: string;
                    lastMessageAt?: string | number;
                  }} */ item) => (
                  <li key={item.id} className="rounded-md border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">{item.structure?.name || 'Structure'}</p>
                        <p className="text-xs text-slate-600">
                          RDV: {item.appointment?.serviceName || 'Service'} - {formatDate(item.appointment?.startsAt)}
                        </p>
                        <p className="text-sm text-slate-700">{item.lastMessagePreview || 'Aucun message'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">Dernier message: {formatDate(item.lastMessageAt)}</p>
                        <Link
                          to={`/compte/messages/${encodeURIComponent(item.id)}`}
                          className="mt-2 inline-flex rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
                        >
                          Ouvrir
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
