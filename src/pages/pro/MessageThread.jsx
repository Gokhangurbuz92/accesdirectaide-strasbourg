// @ts-nocheck
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageThreadSkeleton } from '@/components/pro/ProPageSkeletons';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { rdvMessagingClient, messagingErrorText } from '@/api/rdv-messaging-client';
import { AttachmentList, AttachmentPicker, readAttachment, saveDownload } from '@/components/Messaging/MessageAttachments';

function formatDate(value) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });
}

export default function ProMessageThread() {
  const { conversationId } = useParams();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [statusText, setStatusText] = useState('');
  const [file, setFile] = useState(null);   // PKG-4 / R14
  const [fileKey, setFileKey] = useState(0);
  const download = async (a) => {
    try { const r = await rdvMessagingClient.pro.downloadAttachment(String(conversationId || ''), a.id); if (!r.ok) throw new Error(String(r.status)); await saveDownload(r, a.name); }
    catch { setStatusText('Téléchargement impossible.'); }
  };

  const conversationQuery = useQuery({
    queryKey: ['pro-message-thread', conversationId],
    queryFn: () => rdvMessagingClient.pro.getConversation(String(conversationId || '')),
    enabled: Boolean(conversationId),
  });

  const sendMutation = useMutation({
    mutationFn: async (value) => rdvMessagingClient.pro.sendMessage(String(conversationId || ''), value.text, await readAttachment(value.file)),
    onSuccess: async () => {
      setBody(''); setFile(null); setFileKey((k) => k + 1);
      setStatusText('Message envoye.');
      await queryClient.invalidateQueries({ queryKey: ['pro-message-thread', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['pro-messages-conversations'] });
    },
    onError: (error) => {
      setStatusText(messagingErrorText(error, "Impossible d'envoyer le message."));
    },
  });

  const item = conversationQuery.data?.item || null;
  const messages = Array.isArray(item?.messages) ? item.messages : [];

  return (
    <div className="space-y-4" data-testid="pro-message-thread-page">
      <Link to="/pro/messages" className="inline-flex text-sm font-medium text-primary underline">
        Retour aux conversations
      </Link>

      <Card>
        <CardHeader>
          <CardTitle as="h1">Conversation usager</CardTitle>
          <CardDescription>
            {item?.structure?.name || 'Structure'} - {formatDate(item?.appointment?.startsAt)}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {conversationQuery.isLoading ? (
            <MessageThreadSkeleton />
          ) : null}

          {conversationQuery.error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {messagingErrorText(conversationQuery.error, 'Conversation introuvable.')}
            </p>
          ) : null}

          {!conversationQuery.isLoading && !conversationQuery.error ? (
            <div className="space-y-3" role="list" aria-label="Messages de la conversation pro">
              {messages.length === 0 ? (
                <p className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  Aucun message pour le moment.
                </p>
              ) : (
                messages.map((message) => {
                  const mine = message.senderType === 'PRO';
                  return (
                    <div
                      key={message.id}
                      role="listitem"
                      className={`rounded-md border p-3 text-sm ${mine ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}
                    >
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-700">
                        {mine ? 'Structure' : 'Usager'} - {formatDate(message.createdAt)}
                      </p>
                      <p className="whitespace-pre-wrap text-slate-800">{message.body}</p>
                      <AttachmentList attachments={message.attachments} onDownload={download} testid="pro-attachment" />
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
            <label htmlFor="pro-message-body" className="block text-sm font-medium text-slate-700">
              Nouveau message
            </label>
            <textarea
              id="pro-message-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              maxLength={2000}
              className="w-full rounded-md border border-slate-300 bg-white p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Ecrivez votre message..."
            />
            <AttachmentPicker key={fileKey} id="pro-attach" file={file} onChange={setFile} disabled={sendMutation.isPending} />
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
  );
}
