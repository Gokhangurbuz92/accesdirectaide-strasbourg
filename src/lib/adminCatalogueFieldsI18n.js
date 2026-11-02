// The field labels of src/lib/adminCatalogueFields.js in the interface language (same fields, names and order; French stays the default text of each key,
// so the French editor is unchanged). Labels are looked up by their French text: a field whose label has no key here keeps its French label.
import { useMemo } from 'react';
import { useT } from '@/i18n';
import { AIDE_FIELDS, DEMARCHE_FIELDS, DISPOSITIF_FIELDS, GUIDE_FIELDS, STRUCTURE_FIELDS } from '@/lib/adminCatalogueFields';

export function useAdminCatalogueFields() {
  const { t, i18n } = useT('admin');
  const lang = i18n.language;
  return useMemo(() => {
    const byFrench = {
      Titre: t('admin:catalogue_fields.titre', 'Titre'),
      Catégorie: t('admin:catalogue_fields.categorie', 'Catégorie'),
      'C’est quoi ?': t('admin:catalogue_fields.cest_quoi', 'C’est quoi ?'),
      'Pour qui ?': t('admin:catalogue_fields.pour_qui', 'Pour qui ?'),
      'Ce que ça aide': t('admin:catalogue_fields.ce_que_ca_aide', 'Ce que ça aide'),
      'Délai indicatif': t('admin:catalogue_fields.delai_indicatif', 'Délai indicatif'),
      'Documents nécessaires': t('admin:catalogue_fields.documents_necessaires', 'Documents nécessaires'),
      'Où demander ?': t('admin:catalogue_fields.ou_demander', 'Où demander ?'),
      'Lien de la demande': t('admin:catalogue_fields.lien_demande', 'Lien de la demande'),
      'Source officielle (adresse web)': t('admin:catalogue_fields.source_url_official', 'Source officielle (adresse web)'),
      'Source (adresse web)': t('admin:catalogue_fields.source_url', 'Source (adresse web)'),
      'Mots-clés': t('admin:catalogue_fields.mots_cles', 'Mots-clés'),
      'Aide d’urgence': t('admin:catalogue_fields.est_urgent', 'Aide d’urgence'),
      Territoires: t('admin:catalogue_fields.territoires', 'Territoires'),
      'Départements (codes INSEE, ex. 67)': t('admin:catalogue_fields.departements', 'Départements (codes INSEE, ex. 67)'),
      'Description courte': t('admin:catalogue_fields.description_courte', 'Description courte'),
      'Contenu détaillé': t('admin:catalogue_fields.contenu_detaille', 'Contenu détaillé'),
      'Où faire la démarche ?': t('admin:catalogue_fields.ou_faire', 'Où faire la démarche ?'),
      'Lien officiel': t('admin:catalogue_fields.lien_officiel', 'Lien officiel'),
      Délai: t('admin:catalogue_fields.delai', 'Délai'),
      Coût: t('admin:catalogue_fields.cout', 'Coût'),
      Nom: t('admin:catalogue_fields.nom', 'Nom'),
      'Type de structure': t('admin:catalogue_fields.type_structure', 'Type de structure'),
      Adresse: t('admin:catalogue_fields.adresse', 'Adresse'),
      'Code postal': t('admin:catalogue_fields.code_postal', 'Code postal'),
      Commune: t('admin:catalogue_fields.ville', 'Commune'),
      Département: t('admin:catalogue_fields.departement', 'Département'),
      Téléphone: t('admin:catalogue_fields.telephone', 'Téléphone'),
      Courriel: t('admin:catalogue_fields.email', 'Courriel'),
      'Site web': t('admin:catalogue_fields.site_web', 'Site web'),
      Horaires: t('admin:catalogue_fields.horaires', 'Horaires'),
      Services: t('admin:catalogue_fields.services', 'Services'),
      'Publics accueillis': t('admin:catalogue_fields.publics_accueillis', 'Publics accueillis'),
      'Catégories d’aide': t('admin:catalogue_fields.categories_aidees', 'Catégories d’aide'),
      'Accessible aux personnes à mobilité réduite': t('admin:catalogue_fields.accessibilite_pmr', 'Accessible aux personnes à mobilité réduite'),
      'Description (facile à lire)': t('admin:catalogue_fields.description_falc', 'Description (facile à lire)'),
      Résumé: t('admin:catalogue_fields.summary_falc', 'Résumé'),
      'Publics concernés': t('admin:catalogue_fields.public', 'Publics concernés'),
      'Montant (tel que l’indique la source officielle)': t('admin:catalogue_fields.montant', 'Montant (tel que l’indique la source officielle)'),
      'Liens officiels': t('admin:catalogue_fields.liens', 'Liens officiels'),
      'Aides liées (identifiant ou adresse de la fiche)': t('admin:catalogue_fields.related_aide_ids', 'Aides liées (identifiant ou adresse de la fiche)'),
      'Structures qui accompagnent (identifiant ou adresse de la fiche)': t('admin:catalogue_fields.related_structure_ids', 'Structures qui accompagnent (identifiant ou adresse de la fiche)'),
      'Résumé (facile à lire)': t('admin:catalogue_fields.resume_falc', 'Résumé (facile à lire)'),
      'Étapes du guide': t('admin:catalogue_fields.contenu_json', 'Étapes du guide'),
      Publics: t('admin:catalogue_fields.publics', 'Publics'),
      Situations: t('admin:catalogue_fields.contexte', 'Situations'),
      'Sources (adresses web)': t('admin:catalogue_fields.sources_urls', 'Sources (adresses web)'),
    };
    const tr = (fields) => Object.freeze(fields.map((f) => Object.freeze({ ...f, label: byFrench[f.label] || f.label })));
    return {
      AIDE_FIELDS: tr(AIDE_FIELDS), DEMARCHE_FIELDS: tr(DEMARCHE_FIELDS), STRUCTURE_FIELDS: tr(STRUCTURE_FIELDS),
      DISPOSITIF_FIELDS: tr(DISPOSITIF_FIELDS), GUIDE_FIELDS: tr(GUIDE_FIELDS),
    };
  }, [t, lang]);   // eslint-disable-line react-hooks/exhaustive-deps -- the labels follow the interface language
}
