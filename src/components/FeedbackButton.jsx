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
      toast.error('Merci de préciser votre message.');
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

      toast.success('Merci pour votre signalement.');
      resetForm();
      setOpen(false);
    } catch {
      toast.error('Impossible d’envoyer le signalement.');
    } finally {
      setSubmitting(false);
    }
  };

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
        Signaler une info
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Signaler une info</DialogTitle>
            <DialogDescription>
              Décrivez l’information à corriger. Votre message sera traité par l’équipe éditoriale.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitFeedback} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="feedback-message">Votre message</Label>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Exemple: la condition d'âge n'est plus à jour."
                rows={4}
                maxLength={3000}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback-email">
                Votre email <span className="text-muted-foreground">(optionnel)</span>
              </Label>
              <Input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="votre@email.fr"
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
                Annuler
              </Button>
              <Button type="submit" disabled={submitting || !message.trim()}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Envoi...
                  </>
                ) : (
                  'Envoyer'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
