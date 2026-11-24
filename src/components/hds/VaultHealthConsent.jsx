// @ts-nocheck
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/i18n';
import { HEALTH_CONSENT_VERSION_PROPOSED } from '@/config/legal-drafts';

/**
 * G14-R4b — health documents in Mon Coffre: explicit consent (art. 9.2.a) by a SEPARATE box, never ticked in advance, withdrawable at any time.
 * Shown only when the HDS service announces the health category (HDS_HEALTH_CATEGORY_ENABLED) with EXACTLY the text version this build knows
 * (HDS_HEALTH_CONSENT_VERSION = HEALTH_CONSENT_VERSION_PROPOSED): a consent is never asked for a text the page cannot show. Withdrawal is recorded at the
 * HDS service; the documents already kept stay until the person deletes them (they are told so), nothing is erased behind their back.
 */

/** @param {{ consent: string | null, busy: boolean, hasHealthDocuments: boolean, onGive: (version: string) => Promise<void>, onWithdraw: () => Promise<void> }} props */
export default function VaultHealthConsent({ consent, busy, hasHealthDocuments, onGive, onWithdraw }) {
  const { t } = useT('compte');
  const id = useId();
  const [ticked, setTicked] = useState(false);   // never ticked in advance
  const [problem, setProblem] = useState('');
  const given = consent === HEALTH_CONSENT_VERSION_PROPOSED;
  const give = async (e) => {
    e.preventDefault(); setProblem('');
    if (!ticked) { setProblem(t('compte:coffre_sante.tick_required', 'Cochez la case pour donner votre accord.')); return; }
    await onGive(HEALTH_CONSENT_VERSION_PROPOSED); setTicked(false);
  };
  return (
    <Card data-testid="coffre-health-consent">
      <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:coffre_sante.title', 'Conserver des documents de santé dans Mon Coffre')}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-800">
        <p>{t('compte:coffre_sante.intro', 'Vous pouvez choisir de conserver dans Mon Coffre des documents qui contiennent des informations sur votre santé (par exemple un certificat médical ou un dossier MDPH).')}</p>
        <ul className="list-disc space-y-1 ps-5">
          <li>{t('compte:coffre_sante.point1', 'Ces documents sont chiffrés dans votre navigateur avec votre phrase secrète : ni AccèsDirectAide ni l’hébergeur ne peuvent les lire.')}</li>
          <li>{t('compte:coffre_sante.point2', 'Ils sont conservés en France chez Scalingo, hébergeur certifié pour les données de santé (HDS).')}</li>
          <li>{t('compte:coffre_sante.point3', 'Ils ne sont transmis à personne sans une action de votre part.')}</li>
          <li>{t('compte:coffre_sante.point4', 'Vous pouvez retirer ce consentement à tout moment dans Mon Coffre ; vous pouvez aussi supprimer chaque document.')}</li>
          <li>{t('compte:coffre_sante.point5', 'Ce choix est facultatif : sans lui, vous pouvez utiliser Mon Coffre pour vos autres documents.')}</li>
        </ul>
        {given ? (
          <div className="space-y-2" data-testid="coffre-health-given">
            <p className="font-medium">{t('compte:coffre_sante.given', 'Vous avez donné votre accord. Vous pouvez choisir la catégorie « Santé » pour un document.')}</p>
            <Button type="button" variant="outline" className="border-red-300 text-red-800" data-testid="coffre-health-withdraw" disabled={busy} onClick={() => onWithdraw()}>
              {t('compte:coffre_sante.withdraw', 'Retirer mon accord')}
            </Button>
          </div>
        ) : (
          <form className="space-y-2" onSubmit={give} data-testid="coffre-health-form">
            {consent === null && hasHealthDocuments ? <p data-testid="coffre-health-withdrawn">{t('compte:coffre_sante.withdrawn_keep', 'Votre accord est retiré : vous ne pouvez plus ajouter de document de santé. Les documents de santé déjà conservés restent dans Mon Coffre jusqu’à ce que vous les supprimiez.')}</p> : null}
            <div className="flex items-start gap-2">
              <input id={id} type="checkbox" data-testid="coffre-health-checkbox" className="mt-1 h-5 w-5" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
              <label htmlFor={id}>{t('compte:coffre_sante.checkbox', 'J’accepte que mes documents de santé soient conservés dans Mon Coffre dans ces conditions.')}</label>
            </div>
            <p className="text-xs text-slate-700">{t('compte:coffre_sante.version', 'Texte de consentement, version {{v}}', { v: HEALTH_CONSENT_VERSION_PROPOSED })}</p>
            <Button type="submit" data-testid="coffre-health-give" disabled={busy}>{t('compte:coffre_sante.give', 'Enregistrer mon accord')}</Button>
            {problem ? <p role="alert" className="text-red-800">{problem}</p> : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
