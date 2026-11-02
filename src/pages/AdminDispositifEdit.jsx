// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { useT } from '@/i18n';
import { DISPOSITIF_FIELDS } from '@/lib/adminCatalogueFields';

/** PKG-11 / A02 — create or edit a dispositif (real columns; verification stays with the verification register). */
export default function AdminDispositifEdit() {
  const { t } = useT('admin');
  return <CatalogueEditor kind="dispositif" title={t('admin:catalogue.dispositif.noun', 'dispositif')} fields={DISPOSITIF_FIELDS} listPath="/admin/dispositifs" />;
}
