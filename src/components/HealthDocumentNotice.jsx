/**
 * R16 (HDS, ledger #91) — where a file can be attached without a category (message attachments, a professional's dossier documents), the person is told not to
 * send medical documents: no qualified health-data host (HDS) is in place. The server cannot tell a medical document from another PDF, so this notice is
 * guidance, not a guarantee; the decision for professional documents of social and medico-social establishments is with the owner (OWNER R15.3).
 * @param {{ testid?: string }} props
 */
export default function HealthDocumentNotice({ testid = 'health-document-notice' }) {
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950" data-testid={testid}>
      N’envoyez pas de document médical (certificat, compte rendu, ordonnance, dossier MDPH avec éléments de santé) : AccesDirectAide n’a pas encore
      d’hébergeur agréé pour les données de santé (HDS).
    </p>
  );
}
