// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { useT } from '@/i18n';
import { AIDE_FIELDS } from '@/lib/adminCatalogueFields';

/** PKG-11 / A02 — create or edit an aide (real columns; verification and FALC texts have their own governed screens). */
export default function AdminAideEdit() {
  const { t } = useT('admin');
  return <CatalogueEditor kind="aide" title={t('admin:catalogue.aide.noun', 'aide')} fields={AIDE_FIELDS} listPath="/admin/aides" />;
}
