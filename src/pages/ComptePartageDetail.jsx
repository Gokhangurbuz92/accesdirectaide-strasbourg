// @ts-nocheck
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import CitizenSharingPanel from '@/components/sharing/CitizenSharingPanel';
import DossierTransparency from '@/components/sharing/DossierTransparency';

/**
 * PKG-1 / K0 — manage a dossier that is attached to the signed-in account (/compte/partages/:shareId).
 * Ownership comes from the account session (no owner secret in the browser): the same sharing panel, the same server rules (invite one organization, remove one, stop sharing, erase).
 * If the dossier is not attached to this account the server answers the same uniform "not found" as for an unknown dossier.
 */
export default function ComptePartageDetail() {
  const { shareId } = useParams();
  const [erased, setErased] = useState(false);
  return (
    <div className="container mx-auto max-w-3xl space-y-4 px-4 py-8" data-testid="compte-partage-detail">
      <SEO title="Gérer un dossier partagé" noindex />
      <Button asChild variant="outline" size="sm"><Link to="/compte/profil">← Mon profil</Link></Button>
      <h1 className="text-2xl font-bold text-slate-900">Gérer ce dossier</h1>
      {erased ? (
        <p role="status" data-testid="partage-erased" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">Le dossier a été supprimé. Certaines traces techniques peuvent être conservées pour respecter la loi.</p>
      ) : (
        <>
          <CitizenSharingPanel shareId={shareId} ownerSecret="" onErased={() => setErased(true)} />
          <DossierTransparency shareId={shareId} />
        </>
      )}
    </div>
  );
}
