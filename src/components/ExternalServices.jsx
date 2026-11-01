/**
 * R11 / D05 — the services other public platforms list for a place (data·inclusion open data, api/_services/verification/datainclusion.js publicServices). Each
 * service says WHO says it: « selon France Travail » (a public operator about its own offer) or « déclaré par la structure sur DORA » (the place describing itself).
 * None of it is presented as checked by the State; the export date and its licence are shown, and the place should be contacted before going there.
 * `easy`: the easy-to-read version (short sentences, the names only).
 * R32: the interface text follows the interface language; the services' own words (names, types, themes, publics: data·inclusion's labels) stay as published
 * and carry `textAttrs` (lang / dir from the structure's content translation). Who publishes a service is said in the interface language from its
 * `authority` and `producer`; in French it is the server's own words, as before.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { Trans } from 'react-i18next';
import i18n, { formatDate, useLanguage, useT } from '@/i18n';

const frDay = (/** @type {string | null | undefined} */ d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
/** the day of a published date (« 30/10/2026 ») in the interface language — the day as written, whatever the time zone */
const day = (/** @type {string | null | undefined} */ d) => (d ? formatDate(String(d).slice(0, 10), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) || frDay(d) : null);

/** @param {{ data: any, easy?: boolean, textAttrs?: { lang?: string, dir?: string } }} props */
export default function ExternalServices({ data, easy = false, textAttrs = {} }) {
  const { t } = useT('structures');
  const { isSource } = useLanguage();
  const services = Array.isArray(data?.services) ? data.services : [];
  if (!services.length) return null;

  /** who publishes the information: the server's words in French (or when the producer's role is unknown), otherwise the same words in the interface language */
  const attributionOf = (/** @type {any} */ s) => {
    if (!s.attribution) return t('structures:external.by_other', 'publiée par une autre plateforme');
    if (isSource || !s.producer) return s.attribution;
    if (s.authority === 'PLATEFORME_DECLARATIVE') return t('structures:external.by_declarative', 'déclaré par la structure sur {{producer}}', { producer: s.producer });
    if (s.authority === 'ORGANISME_GESTIONNAIRE') return t('structures:external.by_manager', 'selon {{producer}}, qui gère ce service', { producer: s.producer });
    if (s.authority === 'OPERATEUR_PUBLIC') return t('structures:external.by_operator', 'selon {{producer}}', { producer: s.producer });
    return s.attribution;
  };

  if (easy) {
    return (
      <Card>
        <CardContent className="p-6" data-testid="external-services-easy">
          <h2 className="text-lg font-bold text-slate-900 mb-3">{t('structures:external.easy.title', 'Ce que d’autres sites disent de ce lieu')}</h2>
          <ul className="list-disc ps-5 space-y-1 text-slate-800" {...textAttrs}>
            {services.map((/** @type {any} */ s, /** @type {number} */ i) => <li key={i}>{s.nom}</li>)}
          </ul>
          <p className="text-slate-700 mt-3">{t('structures:external.easy.note', 'Ce sont d’autres sites qui le disent. L’État ne l’a pas vérifié. Appelez le lieu avant d’y aller.')}</p>
        </CardContent>
      </Card>
    );
  }
  const datasetLink = (
    <a href={data.dataset} target="_blank" rel="noopener noreferrer" className="underline">data·inclusion<span className="sr-only"> {t('structures:external.new_window', '(nouvelle fenêtre)')}</span></a>
  );
  return (
    <Card>
      <CardContent className="p-6" data-testid="external-services">
        <h2 className="text-lg font-bold text-slate-900 mb-1">{t('structures:external.title', 'Services listés par d’autres plateformes publiques')}</h2>
        <p className="text-sm text-slate-600 mb-4">{t('structures:external.intro', 'Chaque information indique qui la publie. Elle n’est pas vérifiée par l’État : contactez la structure pour savoir si le service est toujours proposé.')}</p>
        <ul className="space-y-4">
          {services.map((/** @type {any} */ s, /** @type {number} */ i) => (
            <li key={i} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
              <p className="font-semibold text-slate-900" {...textAttrs}>{s.nom}</p>
              <p className="text-sm text-slate-700" {...textAttrs}>
                {[s.type, s.frais, ...(s.modes || [])].filter(Boolean).join(' · ')}
              </p>
              {s.themes?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.themes.map((/** @type {string} */ theme, /** @type {number} */ j) => <Badge key={j} variant="neutral" className="bg-slate-100 text-slate-700" {...textAttrs}>{theme}</Badge>)}
                </div>
              )}
              {s.publics?.length > 0 && <p className="text-sm text-slate-700 mt-1">{t('structures:external.for', 'Pour :')} <span {...textAttrs}>{s.publics.join(', ')}</span></p>}
              <p className="text-xs text-slate-600 mt-1">
                {s.updatedAt
                  ? t('structures:external.info_updated', 'Information {{attribution}}, mise à jour le {{date}}.', { attribution: attributionOf(s), date: day(s.updatedAt) })
                  : t('structures:external.info', 'Information {{attribution}}.', { attribution: attributionOf(s) })}
                {s.link && (
                  <> <a href={s.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-700 underline">{s.producer ? t('structures:external.see_at', 'Voir chez {{producer}}', { producer: s.producer }) : t('structures:external.see_at_producer', 'Voir chez le producteur')}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> {t('structures:external.new_window', '(nouvelle fenêtre)')}</span></a></>
                )}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-600 mt-4">
          {data.export
            ? <Trans i18n={i18n} i18nKey="structures:external.gathered_export" defaults="Rassemblé par <0/>, export du {{date}}" values={{ date: day(data.export) }} components={[datasetLink]} />
            : <Trans i18n={i18n} i18nKey="structures:external.gathered" defaults="Rassemblé par <0/>" components={[datasetLink]} />}
          {data.licence ? <> (<span {...textAttrs}>{data.licence}</span>)</> : ''}.
        </p>
      </CardContent>
    </Card>
  );
}
