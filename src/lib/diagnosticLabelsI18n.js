// R39 — the answer labels of the diagnostic form (src/pages/DiagnosticPage.jsx) and of the shared passport that shows them back
// (src/pages/SharedDiagnostic.jsx), in the interface language. One list, so the two screens can never name an answer differently.
// The keys are the values sent to /api/diagnostic and stored in a share: they never change with the language. French is the default text of each key.
import { useMemo } from 'react';
import { useT } from '@/i18n';

/** housing status values, in the order of the form */
export const HOUSING_KEYS = Object.freeze(['tenant', 'tenant_hlm', 'owner', 'free', 'homeless']);
/** employment status values, in the order of the form */
export const EMPLOYMENT_KEYS = Object.freeze(['salarié', 'sans_emploi', 'indépendant', 'retraité', 'étudiant']);

/** @returns {{ housing: Readonly<Record<string, string>>, employment: Readonly<Record<string, string>> }} */
export function useDiagnosticLabels() {
  const { t, i18n } = useT('diagnostic');
  const lang = i18n.language;
  return useMemo(() => ({
    housing: Object.freeze({
      tenant: t('diagnostic:housing.tenant', 'Locataire'),
      tenant_hlm: t('diagnostic:housing.tenant_hlm', 'Locataire HLM'),
      owner: t('diagnostic:housing.owner', 'Propriétaire'),
      free: t('diagnostic:housing.free', 'Hébergé(e) gratuitement'),
      homeless: t('diagnostic:housing.homeless', 'Sans domicile fixe'),
    }),
    employment: Object.freeze({
      'salarié': t('diagnostic:employment.employee', 'Salarié'),
      'sans_emploi': t('diagnostic:employment.jobseeker', 'Sans emploi / Recherche'),
      'indépendant': t('diagnostic:employment.self_employed', 'Indépendant'),
      'retraité': t('diagnostic:employment.retired', 'Retraité'),
      'étudiant': t('diagnostic:employment.student', 'Étudiant'),
    }),
  }), [t, lang]);   // eslint-disable-line react-hooks/exhaustive-deps -- the labels follow the interface language
}
