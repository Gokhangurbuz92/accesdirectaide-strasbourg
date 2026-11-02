// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { useT } from '@/i18n';
import { DEMARCHE_FIELDS } from '@/lib/adminCatalogueFields';

/** PKG-11 / A02 — create or edit a démarche (real columns; verification and FALC texts have their own governed screens). */
export default function AdminDemarcheEdit() {
  const { t } = useT('admin');
  return <CatalogueEditor kind="demarche" title={t('admin:catalogue.demarche.noun', 'démarche')} fields={DEMARCHE_FIELDS} listPath="/admin/demarches" />;
}
