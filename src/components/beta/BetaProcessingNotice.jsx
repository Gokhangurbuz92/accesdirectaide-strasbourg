import { frontendEnv } from '@/config/env';
import { publicContactEmail } from '@/lib/contactEmail';

/**
 * R26: on the privacy, security, cookie and terms pages, what is actually processed TODAY during the restricted public beta — the rest of each page also
 * describes functions that are built but not open yet (accounts, dossiers, messages, documents, appointments, assistant), which must not read as current.
 */
export default function BetaProcessingNotice() {
  if (!frontendEnv.flags.publicBeta) return null;
  const email = publicContactEmail();
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm" aria-labelledby="beta-processing-title" data-testid="beta-processing-notice">
      <h2 id="beta-processing-title" className="text-lg font-semibold">Ce qui est traité aujourd’hui, pendant la bêta publique</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>Vous lisez les fiches sans compte : aucune donnée personnelle ne vous est demandée.</li>
        <li>L’hébergeur (Vercel) garde des journaux techniques, dont l’adresse IP, pendant un jour ; la limitation de débit (Upstash) garde un compteur par adresse IP pendant quelques minutes.</li>
        <li>Votre navigateur garde un cookie de sécurité (<code>__csrf</code>) et, si vous les changez, vos réglages d’affichage.</li>
        {email && <li>Si vous nous écrivez à {email}, votre message est reçu dans notre messagerie (Microsoft Outlook) et sert seulement à vous répondre.</li>}
      </ul>
      <p className="mt-3 text-sm leading-relaxed">
        Ne sont <strong>pas</strong> ouverts : comptes, dossiers, messages, documents, rendez-vous, assistant, mesure d’audience et suivi des erreurs (Sentry).
        Les passages de cette page qui les décrivent s’appliqueront à leur ouverture.
      </p>
    </section>
  );
}
