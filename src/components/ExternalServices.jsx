/**
 * R11 / D05 — the services other public platforms list for a place (data·inclusion open data, api/_services/verification/datainclusion.js publicServices). Each
 * service says WHO says it: « selon France Travail » (a public operator about its own offer) or « déclaré par la structure sur DORA » (the place describing itself).
 * None of it is presented as checked by the State; the export date and its licence are shown, and the place should be contacted before going there.
 * `easy`: the easy-to-read version (short sentences, the names only).
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';

const frDay = (/** @type {string | null | undefined} */ d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };

/** @param {{ data: any, easy?: boolean }} props */
export default function ExternalServices({ data, easy = false }) {
  const services = Array.isArray(data?.services) ? data.services : [];
  if (!services.length) return null;
  if (easy) {
    return (
      <Card>
        <CardContent className="p-6" data-testid="external-services-easy">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Ce que d’autres sites disent de ce lieu</h2>
          <ul className="list-disc pl-5 space-y-1 text-slate-800">
            {services.map((/** @type {any} */ s, /** @type {number} */ i) => <li key={i}>{s.nom}</li>)}
          </ul>
          <p className="text-slate-700 mt-3">Ce sont d’autres sites qui le disent. L’État ne l’a pas vérifié. Appelez le lieu avant d’y aller.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-6" data-testid="external-services">
        <h2 className="text-lg font-bold text-slate-900 mb-1">Services listés par d’autres plateformes publiques</h2>
        <p className="text-sm text-slate-600 mb-4">Chaque information indique qui la publie. Elle n’est pas vérifiée par l’État : contactez la structure pour savoir si le service est toujours proposé.</p>
        <ul className="space-y-4">
          {services.map((/** @type {any} */ s, /** @type {number} */ i) => (
            <li key={i} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
              <p className="font-semibold text-slate-900">{s.nom}</p>
              <p className="text-sm text-slate-700">
                {[s.type, s.frais, ...(s.modes || [])].filter(Boolean).join(' · ')}
              </p>
              {s.themes?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.themes.map((/** @type {string} */ t, /** @type {number} */ j) => <Badge key={j} variant="neutral" className="bg-slate-100 text-slate-700">{t}</Badge>)}
                </div>
              )}
              {s.publics?.length > 0 && <p className="text-sm text-slate-700 mt-1">Pour : {s.publics.join(', ')}</p>}
              <p className="text-xs text-slate-600 mt-1">
                Information {s.attribution || 'publiée par une autre plateforme'}{s.updatedAt ? `, mise à jour le ${frDay(s.updatedAt)}` : ''}.
                {s.link && (
                  <> <a href={s.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-700 underline">Voir chez {s.producer || 'le producteur'}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (nouvelle fenêtre)</span></a></>
                )}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-600 mt-4">
          Rassemblé par <a href={data.dataset} target="_blank" rel="noopener noreferrer" className="underline">data·inclusion<span className="sr-only"> (nouvelle fenêtre)</span></a>
          {data.export ? `, export du ${frDay(data.export)}` : ''}{data.licence ? ` (${data.licence})` : ''}.
        </p>
      </CardContent>
    </Card>
  );
}
