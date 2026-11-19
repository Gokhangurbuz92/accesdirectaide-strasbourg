// @ts-nocheck
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, ExternalLink, FileText, MapPin, Phone } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { needLabel } from '@/lib/rightsPublicView';
import reference from '../../../data/reference/social-domains.v1.json';

/**
 * G4 — browser-only orientation: the need TOPICS of the person's choices (src/lib/orientationBrowserOnly.js orientationTopics), each with the official
 * Service-Public fiches, the bodies to ask and the kinds of places of the fiche's « Où s'adresser », from the bundled public view of the Rights Graph (the /droits
 * data). Nothing here is fetched: every element is a link the person may follow. No condition of access, no amount, no claim that a right is held: the body decides.
 * The official texts (fiche titles, advice, body names) stay French (lang="fr"); the frame follows the interface language.
 */
const EMERGENCY = new Map(Object.entries(reference.emergency));
const tel = (n) => (n.length === 10 && n.startsWith('0') ? `${n.slice(0, 1)} ${n.slice(1, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : n);
const LINK = 'inline-flex min-h-11 items-center gap-1.5 font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700';

export default function BrowserOrientationTopics({ topics }) {
  const { t } = useT('diagnostic');
  const { t: tr } = useT('rights');
  const { isSource } = useLanguage();
  const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
  if (!topics || !topics.length) return null;
  return (
    <section aria-labelledby="local-topics-title" data-testid="local-topics" className="rounded-lg border border-slate-300 bg-white p-4">
      <h2 id="local-topics-title" className="text-lg font-semibold text-slate-900">{t('diagnostic:wizard.local.topics_title', 'Les sujets liés à vos choix')}</h2>
      <p className="mt-1 text-sm text-slate-800">{t('diagnostic:wizard.local.topics_intro', 'Pour chaque sujet : les fiches officielles, à qui s’adresser et quoi faire. Ces sujets ne disent pas si une aide vous concerne : seul l’organisme qui reçoit la demande décide.')}</p>
      <ol className="mt-4 space-y-5">
        {topics.map((need) => {
          const numbers = need.numbers.filter((x) => EMERGENCY.has(x));
          const headingId = `local-topic-${need.id}`;
          return (
            <li key={need.id} data-testid="local-topic" data-need={need.id} className="rounded-lg border border-slate-200 p-4">
              <h3 id={headingId} className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
                {needLabel(need.id, tr, need.label)}
                {need.urgent && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">{tr('rights:needs.urgent', 'Urgent')}</span>}
              </h3>
              {numbers.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label={tr('rights:numbers.title', 'Numéros à appeler')}>
                  {numbers.map((x) => (
                    <li key={x} className="flex flex-wrap items-center gap-2">
                      <Phone className="h-4 w-4 shrink-0 text-red-800" aria-hidden="true" />
                      <a href={`tel:${x}`} className="inline-flex min-h-11 items-center font-semibold text-red-900 underline" dir="ltr">{tel(x)}</a>
                      <span {...fr}>{EMERGENCY.get(x)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {need.fiches.length > 0 && (
                <>
                  <p className="mt-3 text-sm font-semibold text-slate-900">{tr('rights:fiches.title', 'Fiches officielles')}</p>
                  <ul className="mt-1 space-y-1" data-testid="local-topic-fiches">
                    {need.fiches.map((f) => (
                      <li key={f.id}>
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                          <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span {...fr}>{f.title || f.id}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                          <span className="sr-only">{tr('rights:fiche.new-tab', '(service-public.gouv.fr, nouvel onglet)')}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {need.bodies.length > 0 && (
                <>
                  <p className="mt-3 text-sm font-semibold text-slate-900">{t('diagnostic:wizard.local.bodies', 'Organismes à contacter')}</p>
                  <ul className="mt-1 flex flex-wrap gap-2" data-testid="local-topic-bodies">
                    {need.bodies.map((b) => <li key={b.id} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"><Building2 className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" /><span {...fr}>{b.label}</span></li>)}
                  </ul>
                </>
              )}
              {need.offices.length > 0 && (
                <>
                  <p className="mt-3 text-sm font-semibold text-slate-900">{tr('rights:offices.title', 'Trouver un lieu d’accueil (« Où s’adresser » de la fiche officielle)')}</p>
                  <ul className="mt-1 space-y-1">
                    {need.offices.map((o) => (
                      <li key={o.type}>
                        <Link to={`/structures?type=${encodeURIComponent(o.type)}`} className={LINK}>
                          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /><span {...fr}>{o.type}</span>
                          <span className="sr-only">{tr('rights:offices.link', ' : chercher dans l’annuaire des lieux')}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {need.actions.length > 0 && (
                <>
                  <p className="mt-3 text-sm font-semibold text-slate-900">{tr('rights:next.title', 'Que faire maintenant')}</p>
                  <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-slate-900">
                    {need.actions.map((a) => <li key={a.text} {...fr}>{a.text}</li>)}
                  </ul>
                </>
              )}
              <p className="mt-3">
                <Link to={`/droits/${need.id}`} className={LINK} aria-describedby={headingId} data-testid="local-topic-more">
                  {t('diagnostic:wizard.local.topic_more', 'Tout sur ce sujet')}<ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
