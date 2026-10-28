// @ts-nocheck
import { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

import { getCsrfHeaders } from '@/lib/csrf';
const REPORT_REASONS = [
  { value: 'LIEN_MORT', label: 'Lien mort ou ne fonctionne plus' },
  { value: 'HORAIRES_FAUX', label: 'Horaires incorrects' },
  { value: 'INFO_FAUSSE', label: 'Information fausse ou inexacte' },
  { value: 'INFO_OBSOLETE', label: 'Information obsolète ou dépassée' },
  { value: 'AUTRE', label: 'Autre problème' },
];

const CONTENT_TYPE_MAP = {
  aide: 'AIDE',
  demarche: 'DEMARCHE',
  structure: 'STRUCTURE',
  actualite: 'ACTUALITE',
};

/**
 * ReportContentButton component
 *
 * @param {Object} props
 * @param {string} props.contentType - Type of content (aide, demarche, structure, actualite)
 * @param {string} props.contentId - ID of the content being reported
 * @param {string} props.pageUrl - Current page URL
 * @param {string} [props.variant] - Button variant (default, outline, ghost, etc.)
 * @param {string} [props.size] - Button size (default, sm, lg, icon)
 */
export default function ReportContentButton({
  contentType,
  contentId,
  pageUrl,
  variant = 'outline',
  size = 'sm'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    reason: '',
    message: '',
    reporterEmail: '',
  });

  const handleSubmit = async (/** @type {{ preventDefault: () => void; }} */ e) => {
    e.preventDefault();

    if (!formData.reason) {
      toast.error('Veuillez sélectionner une raison');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({
          contentType: CONTENT_TYPE_MAP[contentType] || contentType,
          contentId,
          reason: formData.reason,
          message: formData.message || null,
          pageUrl: pageUrl || window.location.href,
          reporterEmail: formData.reporterEmail || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'envoi du signalement');
      }

      toast.success('Merci pour votre signalement', {
        description: 'Votre signalement est enregistré : l’information sera réexaminée.',
      });

      // Reset form and close modal
      setFormData({ reason: '', message: '', reporterEmail: '' });
      setIsOpen(false);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Report submission error:', error);
      toast.error('Erreur lors de l\'envoi', {
        description: error.message || 'Veuillez réessayer plus tard.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setIsOpen(true)}
        className="gap-2"
      >
        <Flag className="h-4 w-4" />
        Signaler une erreur
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Signaler un problème</DialogTitle>
            <DialogDescription>
              Vous avez repéré une information incorrecte ? Aidez-nous à améliorer cette fiche.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <div className="space-y-6 py-4">
              {/* Reason Selection */}
              <div className="space-y-3">
                <Label htmlFor="reason">Quel est le problème ?</Label>
                <RadioGroup
                  value={formData.reason}
                  onValueChange={(value) =>
                    setFormData({ ...formData, reason: value })
                  }
                  className="space-y-2"
                >
                  {REPORT_REASONS.map((reason) => (
                    <div key={reason.value} className="flex items-center space-x-2">
                      <RadioGroupItem value={reason.value} id={reason.value} />
                      <Label
                        htmlFor={reason.value}
                        className="font-normal cursor-pointer"
                      >
                        {reason.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {/* Optional Message */}
              <div className="space-y-2">
                <Label htmlFor="message">
                  Détails supplémentaires <span className="text-muted-foreground">(optionnel)</span>
                </Label>
                <Textarea
                  id="message"
                  placeholder="Décrivez le problème plus en détail..."
                  value={formData.message}
                  onChange={(e) =>
                    setFormData({ ...formData, message: e.target.value })
                  }
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Optional Email */}
              <div className="space-y-2">
                <Label htmlFor="email">
                  Votre email <span className="text-muted-foreground">(optionnel)</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="votre@email.fr"
                  value={formData.reporterEmail}
                  onChange={(e) =>
                    setFormData({ ...formData, reporterEmail: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Nous pourrons vous tenir informé de la correction.
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsOpen(false)}
                disabled={isSubmitting}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={isSubmitting || !formData.reason}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Envoi...
                  </>
                ) : (
                  'Envoyer le signalement'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
