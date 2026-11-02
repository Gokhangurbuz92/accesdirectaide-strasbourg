import { Phone } from 'lucide-react';
import { useT } from '@/i18n';
import reference from '../../../data/reference/social-domains.v1.json';

const tel = (n) => (n.length === 10 && n.startsWith('0') ? `${n.slice(0, 1)} ${n.slice(1, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : n.length === 6 ? `${n.slice(0, 3)} ${n.slice(3)}` : n);

/**
 * R34 — the official emergency numbers, above the results, when the search describes danger (api/lib/search-safety.js). The same numbers and wording
 * as « Trouver de l'aide par besoin »; only numbers of the reference file are shown, so a wrong server value shows nothing.
 * @param {{ safety: { kind: string, numbers: string[] } | null }} props
 */
export default function SafetyNotice({ safety }) {
  const { t } = useT('reference');
  const numbers = (safety?.numbers || []).filter((n) => reference.emergency[n]);
  if (!numbers.length) return null;
  return (
    <section aria-labelledby="search-safety-title" data-testid="search-safety" data-kind={safety.kind} className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
      <h2 id="search-safety-title" className="text-lg font-semibold text-red-900">{t('reference:emergency.title', 'En cas d’urgence ou de danger')}</h2>
      <p className="mt-1 text-sm text-red-900">{t('reference:emergency.intro', 'Ces numéros officiels sont gratuits. AccesDirectAide ne peut pas intervenir lui-même en urgence.')}</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {numbers.map((n) => (
          <li key={n} className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 shrink-0 text-red-800" aria-hidden="true" />
            <a href={`tel:${n}`} className="ada-target font-semibold text-red-900 underline" dir="ltr">{tel(n)}</a>
            <span lang="fr">{reference.emergency[n]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
