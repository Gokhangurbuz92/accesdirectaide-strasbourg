// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { useT } from '@/i18n';
import { useAdminCatalogueFields } from '@/lib/adminCatalogueFieldsI18n';

/** PKG-11 / A02 — create or edit a démarche (real columns; verification and FALC texts have their own governed screens). */
export default function AdminDemarcheEdit() {
  const { t } = useT('admin');
  const { DEMARCHE_FIELDS } = useAdminCatalogueFields();
  return <CatalogueEditor kind="demarche" title={t('admin:catalogue.demarche.noun', 'démarche')} fields={DEMARCHE_FIELDS} listPath="/admin/demarches" />;
}
