// @ts-nocheck
/**
 * Automatic verification chain — the lines a person reads on a record (api/lib/publicVisibility.js publicAutoCheck), in the owner's words (D-5 v2, 2026-10-25):
 * « Informations vérifiées automatiquement le [date] à partir de sources officielles. Consulter la source. » Three things are kept apart: the official source
 * (named, linked), the automatic check made by AccesDirectAide (dated — not a validation by the administration, not legal advice), the texts written
 * automatically from the source. Nothing is shown for a record the automatic check never confirmed.
 */
const fr = (d) => { try { return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }); } catch { return null; } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const NAMES = { 'service-public.gouv.fr': 'Service-Public.gouv.fr', 'service-public.fr': 'Service-Public.gouv.fr', 'lannuaire.service-public.gouv.fr': "l'Annuaire de l'administration",
  'annuaire-entreprises.data.gouv.fr': 'le répertoire officiel SIRENE', 'finess.esante.gouv.fr': 'le répertoire national FINESS (ministère de la Santé)' };
const KIND = { ANNUAIRE: "l'Annuaire de l'administration", SIRENE: 'le répertoire officiel SIRENE', FINESS: 'le répertoire national FINESS (ministère de la Santé)' };

/** @param {{ record: any, kind: 'aide' | 'demarche' | 'structure' }} props */
export default function AutoVerificationNote({ record, kind }) {
  const a = record?.verification_auto;
  if (!a?.checkedAt) return null;
  const names = kind === 'structure'
    ? (a.sources || []).map((s) => KIND[s.kind]).filter(Boolean)
    : [NAMES[host(a.sourceUrl)] || host(a.sourceUrl)].filter(Boolean);
  const url = a.sourceUrl || (a.sources || []).find((s) => s.url)?.url || null;
  return (
    <div data-testid="auto-verification-note" role="note" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
      <p>
        <strong>Informations vérifiées automatiquement le {fr(a.checkedAt)} à partir de sources officielles</strong>
        {names.length ? <> : {names.join(' et ')}</> : null}
        {a.importantChangeAt ? <> (dernière modification importante de la source : {fr(a.importantChangeAt)})</> : null}.
      </p>
      {a.textsMode === 'OFFICIAL_EXCERPT' ? (
        <p className="mt-1" data-testid="auto-verification-excerpt">La source officielle a changé : le résumé est pour l’instant un extrait mot pour mot de la fiche officielle. La version facile à lire sera réécrite à partir de la nouvelle version de la source.</p>
      ) : a.textsWrittenAt ? (
        <p className="mt-1">Le résumé et la version facile à lire ont été rédigés automatiquement à partir de la source officielle, puis contrôlés automatiquement.</p>
      ) : null}
      <p className="mt-1 text-emerald-900">Cette vérification est faite par AccesDirectAide : ce n’est ni une validation de l’administration ni un conseil juridique. En cas de doute, la source officielle fait foi.</p>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-medium text-emerald-950 underline underline-offset-2">Consulter la source</a> : null}
    </div>
  );
}
