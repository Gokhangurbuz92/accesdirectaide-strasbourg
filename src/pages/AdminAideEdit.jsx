// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { useT } from '@/i18n';
import { useAdminCatalogueFields } from '@/lib/adminCatalogueFieldsI18n';

/** PKG-11 / A02 — create or edit an aide (real columns; verification and FALC texts have their own governed screens). */
export default function AdminAideEdit() {
  const { t } = useT('admin');
  const { AIDE_FIELDS } = useAdminCatalogueFields();
  return <CatalogueEditor kind="aide" title={t('admin:catalogue.aide.noun', 'aide')} fields={AIDE_FIELDS} listPath="/admin/aides" />;
}
