import socialReference from '../../../data/reference/social-domains.v1.json';

/** the numbers of the site footer (src/pages/Layout.jsx FOOTER_EMERGENCY), with the same labels from the reference file */
export const EMERGENCY_NUMBERS = Object.freeze(['112', '15', '17', '115', '119', '3919', '3114']);

/** @type {Record<string, string>} */
const LABELS = socialReference.emergency;

/** The emergency numbers as call links (the labels stay in French, like the footer: they name French services). @param {{ testid?: string }} props */
export default function EmergencyNumbers({ testid = 'help-emergency' }) {
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid={testid}>
      {EMERGENCY_NUMBERS.map((n) => (
        <li key={n} className="flex items-baseline gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <a href={`tel:${n}`} dir="ltr" className="ada-target min-w-[3.5rem] font-bold text-red-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded">{n}</a>
          <span lang="fr" className="text-sm text-slate-800">{LABELS[n]}</span>
        </li>
      ))}
    </ul>
  );
}
