// @ts-nocheck
import { Link } from 'react-router-dom';
import { useT } from '@/i18n';

/**
 * Provisional LAB wording (owner-supplied proposal, NOT legal approval; release gate for legal basis / retention / notice stays OPEN).
 * Scope kept to what is proven or stated by the owner: answers are transmitted to the server; technical processing information is recorded;
 * sharing is a separate, optional step. It deliberately does NOT say that data stays in the browser, that nothing is stored, or that the service is RGPD-compliant.
 * R40: one list of keys (namespace `diagnostic`) for the screen and for PRIVACY_TEXT; French stays the default text of each key. The other languages
 * translate this wording only: no legal basis, retention period or right is added. « {{reset}} » is the reset button's own label in the interface language.
 */
const privacyText = (t) => {
    const reset = t('diagnostic:form.reset', 'Réinitialiser tout');
    return {
        title: t('diagnostic:privacy.title', 'Vos données'),
        p1: t('diagnostic:privacy.p1', 'Pour réaliser ce diagnostic, vos réponses sont transmises à notre serveur. Des informations techniques sur le traitement sont enregistrées.'),
        p2: t('diagnostic:privacy.p2', 'Si vous choisissez de partager votre diagnostic avec une structure, des informations relatives à ce partage peuvent également être enregistrées, selon les autorisations que vous accordez.'),
        // Verified in source (src/hooks/useSituation + src/lib/storage.js): the form answers are readable for 24 hours in this browser's localStorage, then removed at
        // the next visit of any page (storage.purgeExpired in src/App.jsx), or at once by « Réinitialiser tout ».
        p3: t('diagnostic:privacy.p3', 'Sur cet appareil, votre navigateur garde aussi vos réponses pour que vous puissiez reprendre dans les 24 heures ; au-delà, elles sont effacées à votre visite suivante. Sur un appareil partagé, utilisez « {{reset}} » pour les effacer tout de suite.', { reset }),
        falcTitle: t('diagnostic:privacy.falc_title', 'En mots simples'),
        falc: [
            t('diagnostic:privacy.falc_1', 'Pour faire le diagnostic, vos réponses sont envoyées à notre serveur.'),
            t('diagnostic:privacy.falc_2', 'Nous gardons des informations techniques sur ce calcul.'),
            t('diagnostic:privacy.falc_3', 'Le partage avec une structure est un choix à part.'),
            t('diagnostic:privacy.falc_4', 'Si vous partagez, nous pouvons garder des informations sur ce partage. Cela dépend de ce que vous autorisez.'),
            t('diagnostic:privacy.falc_5', 'Votre navigateur garde vos réponses 24 heures, pour reprendre plus tard. Ensuite, elles sont effacées à votre visite suivante. Sur un appareil partagé, cliquez sur « {{reset}} ».', { reset }),
        ],
        link: t('diagnostic:privacy.link', 'Lire la politique de confidentialité'),
    };
};

/** the French wording (the default text of each key), for the source guards and tests */
const french = (_key, fr, values = {}) => fr.replace(/\{\{(\w+)\}\}/g, (_m, n) => values[n] ?? '');
export const PRIVACY_TEXT = Object.freeze({ ...privacyText(french), falc: Object.freeze(privacyText(french).falc) });

export default function PrivacyNotice() {
    const { t } = useT('diagnostic');
    const text = privacyText(t);
    return (
        <section aria-labelledby="diag-privacy-title" data-testid="privacy-notice" className="mx-auto max-w-xl text-start text-sm text-slate-800">
            <h2 id="diag-privacy-title" className="text-sm font-bold text-slate-900">{text.title}</h2>
            <p className="mt-1">{text.p1}</p>
            <p className="mt-2" data-testid="privacy-sharing-sentence">{text.p2}</p>
            <p className="mt-2" data-testid="privacy-browser-sentence">{text.p3}</p>
            <details className="mt-2">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{text.falcTitle}</summary>
                <ul className="mt-1 list-disc space-y-1 ps-5">
                    {text.falc.map((l) => <li key={l}>{l}</li>)}
                </ul>
            </details>
            <p className="mt-1">
                <Link to="/politique-confidentialite" className="font-semibold text-indigo-800 underline focus:outline-none focus:ring-2 focus:ring-blue-500">{text.link}</Link>
            </p>
        </section>
    );
}
