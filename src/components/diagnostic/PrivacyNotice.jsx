// @ts-nocheck
import { Link } from 'react-router-dom';

/**
 * Provisional LAB wording (owner-supplied proposal, NOT legal approval; release gate for legal basis / retention / notice stays OPEN).
 * Scope kept to what is proven or stated by the owner: answers are transmitted to the server; technical processing information is recorded;
 * sharing is a separate, optional step. It deliberately does NOT say that data stays in the browser, that nothing is stored, or that the service is RGPD-compliant.
 */
export const PRIVACY_TEXT = Object.freeze({
    title: 'Vos données',
    p1: 'Pour réaliser ce diagnostic, vos réponses sont transmises à notre serveur. Des informations techniques sur le traitement sont enregistrées.',
    p2: 'Si vous choisissez de partager votre diagnostic avec une structure, des informations relatives à ce partage peuvent également être enregistrées, selon les autorisations que vous accordez.',
    // Verified in source (src/hooks/useSituation + src/lib/storage.js): the form answers are readable for 24 hours in this browser's localStorage, then removed at
    // the next visit of any page (storage.purgeExpired in src/App.jsx), or at once by « Réinitialiser tout ».
    p3: 'Sur cet appareil, votre navigateur garde aussi vos réponses pour que vous puissiez reprendre dans les 24 heures ; au-delà, elles sont effacées à votre visite suivante. Sur un appareil partagé, utilisez « Réinitialiser tout » pour les effacer tout de suite.',
    falcTitle: 'En mots simples',
    falc: [
        'Pour faire le diagnostic, vos réponses sont envoyées à notre serveur.',
        'Nous gardons des informations techniques sur ce calcul.',
        'Le partage avec une structure est un choix à part.',
        'Si vous partagez, nous pouvons garder des informations sur ce partage. Cela dépend de ce que vous autorisez.',
        'Votre navigateur garde vos réponses 24 heures, pour reprendre plus tard. Ensuite, elles sont effacées à votre visite suivante. Sur un appareil partagé, cliquez sur « Réinitialiser tout ».',
    ],
    link: 'Lire la politique de confidentialité',
});

export default function PrivacyNotice() {
    return (
        <section aria-labelledby="diag-privacy-title" data-testid="privacy-notice" className="mx-auto max-w-xl text-left text-sm text-slate-800">
            <h2 id="diag-privacy-title" className="text-sm font-bold text-slate-900">{PRIVACY_TEXT.title}</h2>
            <p className="mt-1">{PRIVACY_TEXT.p1}</p>
            <p className="mt-2" data-testid="privacy-sharing-sentence">{PRIVACY_TEXT.p2}</p>
            <p className="mt-2" data-testid="privacy-browser-sentence">{PRIVACY_TEXT.p3}</p>
            <details className="mt-2">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{PRIVACY_TEXT.falcTitle}</summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                    {PRIVACY_TEXT.falc.map((l) => <li key={l}>{l}</li>)}
                </ul>
            </details>
            <p className="mt-1">
                <Link to="/politique-confidentialite" className="font-semibold text-indigo-800 underline focus:outline-none focus:ring-2 focus:ring-blue-500">{PRIVACY_TEXT.link}</Link>
            </p>
        </section>
    );
}
