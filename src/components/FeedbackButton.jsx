// @ts-nocheck
import { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { getCsrfHeaders } from '@/lib/csrf';
import { frontendEnv } from '@/config/env';
import { publicContactEmail, mailtoWithSubject } from '@/lib/contactEmail';
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';
/**
 * @param {{
 *   type: 'aide' | 'demarche',
 *   entityId?: string | null,
 *   entitySlug?: string | null,
 *   pageUrl?: string | null,
 *   variant?: string,
 *   size?: string,
 * }} props
 */
export default function FeedbackButton({
  type,
  entityId = null,
  entitySlug = null,
  pageUrl = null,
  variant = 'ghost',
  size = 'default',
}) {
  const { t } = useT('shared');
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');

  const resetForm = () => {
    setMessage('');
    setEmail('');
  };

  const submitFeedback = async (/** @type {{ preventDefault: () => void; }} */ event) => {
    event.preventDefault();
    if (!message.trim()) {
      toast.error(t('shared:feedback.empty', 'Merci de préciser votre message.'));
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({
          type,
          id: entityId || undefined,
          slug: entitySlug || undefined,
          message: message.trim(),
          email: email.trim() || undefined,
          pageUrl: pageUrl || (typeof window !== 'undefined' ? window.location.href : undefined),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'request_failed');
      }

      toast.success(t('shared:feedback.sent', 'Merci pour votre signalement.'));
      resetForm();
      setOpen(false);
    } catch {
      toast.error(t('shared:feedback.failed', 'Impossible d’envoyer le signalement.'));
    } finally {
      setSubmitting(false);
    }
  };

  // R29: the report form is closed in the public beta (its submission was always refused, after the person had typed a message and an e-mail):
  // the button opens an e-mail to the published contact address, with the page in the subject and nothing personal pre-filled
  // (R32: the subject stays in French — the editorial team reads it)
  if (frontendEnv.flags.publicBeta) {
    const to = publicContactEmail();
    if (!to) return null;
    const where = entitySlug || entityId || pageUrl || (typeof window !== 'undefined' ? window.location.pathname : '');
    return (
      <Button asChild variant={variant} size={size} className="w-full gap-2" data-testid="feedback-button">
        <a href={mailtoWithSubject(to, `Signaler une erreur : ${type} ${where}`.trim())}>
          <Flag className="h-4 w-4" aria-hidden="true" />
          {t('shared:feedback.byEmail', 'Signaler une erreur par e-mail')}
        </a>
      </Button>
    );
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className="w-full gap-2"
        onClick={() => setOpen(true)}
        data-testid="feedback-button"
      >
        <Flag className="h-4 w-4" />
        {t('shared:feedback.button', 'Signaler une info')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('shared:feedback.button', 'Signaler une info')}</DialogTitle>
            <DialogDescription>
              {t('shared:feedback.description', 'Décrivez l’information à corriger. Votre message sera traité par l’équipe éditoriale.')}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitFeedback} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="feedback-message">{t('shared:feedback.message', 'Votre message')}</Label>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t('shared:feedback.messagePlaceholder', "Exemple: la condition d'âge n'est plus à jour.")}
                rows={4}
                maxLength={3000}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback-email">
                <Trans i18n={i18n} i18nKey="shared:feedback.email" defaults="Votre email <0>(optionnel)</0>" components={[<span key="optional" className="text-muted-foreground" />]} />
              </Label>
              <Input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t('shared:feedback.emailPlaceholder', 'votre@email.fr')}
                maxLength={254}
              />
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                {t('shared:feedback.cancel', 'Annuler')}
              </Button>
              <Button type="submit" disabled={submitting || !message.trim()}>
                {submitting ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t('shared:feedback.sending', 'Envoi...')}
                  </>
                ) : (
                  t('shared:feedback.send', 'Envoyer')
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
