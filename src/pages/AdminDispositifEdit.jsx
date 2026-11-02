// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { useT } from '@/i18n';
import { useAdminCatalogueFields } from '@/lib/adminCatalogueFieldsI18n';

/** PKG-11 / A02 — create or edit a dispositif (real columns; verification stays with the verification register). */
export default function AdminDispositifEdit() {
  const { t } = useT('admin');
  const { DISPOSITIF_FIELDS } = useAdminCatalogueFields();
  return <CatalogueEditor kind="dispositif" title={t('admin:catalogue.dispositif.noun', 'dispositif')} fields={DISPOSITIF_FIELDS} listPath="/admin/dispositifs" />;
}
