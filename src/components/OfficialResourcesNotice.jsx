// PKG-1 / D-5 — shown beside an EMPTY public list. The product only publishes records a human reviewer has verified; when none exists it says so and points to the official
// portals themselves (the sites of the product's official-source allow-list, api/lib/services/official-sources.js), instead of showing placeholder or unverified records.
// R32: the texts are in the interface language; the names of the official sites stay as they are.
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';

const PORTALS = [
  ['Service-Public.fr', 'https://www.service-public.fr'],
  ['CAF', 'https://www.caf.fr'],
  ['France Travail', 'https://www.francetravail.fr'],
  ['Ameli (Assurance Maladie)', 'https://www.ameli.fr'],
];

export default function OfficialResourcesNotice() {
  const { t } = useT('shared');
  return (
    <section className="my-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800" data-testid="official-resources-notice" aria-labelledby="official-resources-title">
      <h2 id="official-resources-title" className="text-base font-semibold text-slate-900">{t('shared:official.title', 'Seules les informations vérifiées sont publiées')}</h2>
      <p className="mt-1">{t('shared:official.text', 'Nous ne publions une fiche qu’après sa vérification automatique auprès de sa source officielle. Si rien ne s’affiche ici, aucune fiche vérifiée n’est encore disponible. Vous pouvez consulter directement les sites officiels :')}</p>
      <ul className="mt-2 flex flex-wrap gap-3">
        {PORTALS.map(([label, href]) => (
          <li key={href}><a className="underline" href={href} target="_blank" rel="noopener noreferrer">{label}<span className="sr-only">{t('shared:newWindow', ' (nouvelle fenêtre)')}</span></a></li>
        ))}
      </ul>
      <p className="mt-2"><Trans i18n={i18n} i18nKey="shared:official.emergency" defaults="En cas de danger immédiat : <0>numéros d’urgence</0>." components={[<a key="emergency" className="underline" href="/ressources?emergency=1">numéros d’urgence</a>]} /></p>
    </section>
  );
}
