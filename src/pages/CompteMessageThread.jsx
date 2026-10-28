import { SkeletonList } from '@/components/ui/skeleton';
// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import SEO from '@/components/SEO';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { rdvMessagingClient, messagingErrorText } from '@/api/rdv-messaging-client';
import { AttachmentList, AttachmentPicker, readAttachment, saveDownload } from '@/components/Messaging/MessageAttachments';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';

function formatDate(/** @type {number} */ value) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });
}

export default function CompteMessageThread() {
  const { conversationId } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [statusText, setStatusText] = useState('');
  const [file, setFile] = useState(/** @type {File | null} */ (null));   // PKG-4 / R14
  const [fileKey, setFileKey] = useState(0);
  const download = async (/** @type {{ id: string, name: string }} */ a) => {
    try { const r = await rdvMessagingClient.user.downloadAttachment(String(conversationId || ''), a.id); if (!r.ok) throw new Error(String(r.status)); await saveDownload(r, a.name); }
    catch { setStatusText('Téléchargement impossible.'); }
  };

  const safeNext = useMemo(
    () => normalizeNextPath(location.pathname + location.search, '/compte/messages'),
    [location.pathname, location.search],
  );

  const authQuery = useQuery({
    queryKey: ['compte-message-auth'],
    queryFn: () => rdvMessagingClient.authMe(),
    staleTime: 30_000,
  });

  const isUser = authQuery.data?.session?.kind === 'user';

  const conversationQuery = useQuery({
    queryKey: ['compte-message-thread', conversationId],
    queryFn: () => rdvMessagingClient.user.getConversation(String(conversationId || '')),
    enabled: Boolean(conversationId && isUser),
  });

  /** @type {import('@tanstack/react-query').UseMutationResult<unknown, Error, { text: string, file: File | null }, unknown>} */
const sendMutation = useMutation({
    mutationFn: async (value) => rdvMessagingClient.user.sendMessage(String(conversationId || ''), value.text, await readAttachment(value.file)),
    onSuccess: async () => {
      setBody(''); setFile(null); setFileKey((k) => k + 1);
      setStatusText('Message envoye.');
      await queryClient.invalidateQueries({ queryKey: ['compte-message-thread', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['compte-messages-conversations'] });
    },
    onError: (error) => {
      setStatusText(messagingErrorText(error, "Impossible d'envoyer votre message."));
    },
  });

  if (authQuery.isLoading) {
    return (
      <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
    );
  }

  if (!isUser) {
    return <Navigate to={appendNext('/auth/login', safeNext)} replace />;
  }

  const item = conversationQuery.data?.item || null;
  const messages = Array.isArray(item?.messages) ? item.messages : [];

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <SEO
        title="Conversation RDV"
        description="Echangez avec la structure au sujet de votre rendez-vous"
        path={`/compte/messages/${encodeURIComponent(String(conversationId || ''))}`}
        noindex={true}
      />

      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 space-y-4">
        <Link to="/compte/messages" className="inline-flex text-sm font-medium text-primary underline">
          Retour aux conversations
        </Link>

        <Card>
          <CardHeader>
            <CardTitle as="h1">Conversation rendez-vous</CardTitle>
            <CardDescription>
              {item?.structure?.name || 'Structure'} - {formatDate(item?.appointment?.startsAt)}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {conversationQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement...
              </div>
            ) : null}

            {conversationQuery.error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                {messagingErrorText(conversationQuery.error, 'Conversation introuvable.')}
              </p>
            ) : null}

            {!conversationQuery.isLoading && !conversationQuery.error ? (
              <div className="space-y-3" role="list" aria-label="Messages de la conversation">
                {messages.length === 0 ? (
                  <p className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                    Aucun message pour le moment.
                  </p>
                ) : (
                  messages.map((/** @type {{ senderType: string; id: any; createdAt: number; body: any; attachments?: any[] }} */ message) => {
                    const mine = message.senderType === 'USER';
                    return (
                      <div
                        key={message.id}
                        role="listitem"
                        className={`rounded-md border p-3 text-sm ${mine ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}
                      >
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-700">
                          {mine ? 'Vous' : 'Structure'} - {formatDate(message.createdAt)}
                        </p>
                        <p className="whitespace-pre-wrap text-slate-800">{message.body}</p>
                      <AttachmentList attachments={message.attachments} onDownload={download} testid="citizen-attachment" />
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}

            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const value = String(body || '').trim();
                if ((!value && !file) || sendMutation.isPending) return;
                sendMutation.mutate({ text: value, file });
              }}
            >
              <label htmlFor="message-body" className="block text-sm font-medium text-slate-700">
                Nouveau message
              </label>
              <textarea
                id="message-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={4}
                maxLength={2000}
                className="w-full rounded-md border border-slate-300 bg-white p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Ecrivez votre message..."
              />
              <AttachmentPicker key={fileKey} id="citizen-attach" file={file} onChange={setFile} disabled={sendMutation.isPending} />
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={sendMutation.isPending || (!String(body || '').trim() && !file)}>
                  {sendMutation.isPending ? 'Envoi...' : 'Envoyer'}
                </Button>
                <span className="text-xs text-slate-700">{String(body || '').length}/2000</span>
              </div>
            </form>

            <p className="text-sm text-slate-600" aria-live="polite">
              {statusText}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
