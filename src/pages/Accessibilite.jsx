import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';

const linkClass =
  'font-medium text-blue-700 underline decoration-2 underline-offset-2 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2';

export default function Accessibilite() {
  return (
    <>
      {/* R7: the shared SEO component (canonical, social tags) like every other page; it set only a title and a description */}
      <SEO title="Accessibilité" description="Déclaration d’accessibilité d’AccesDirectAide, état de conformité, contact et voies de recours." path="/accessibilite" />

      <PageHeader width="reading" titleId="accessibilite-title" eyebrow="Accessibilité numérique" title="Déclaration d’accessibilité" description="État de conformité d’AccesDirectAide, contact et voies de recours." />
      <article
        className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8"
        aria-labelledby="accessibilite-title"
      >
        <header className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* R26 (owner directive 31/10/2026): only automated and technical checks exist — no formal RGAA audit is under way or scheduled, so none is announced */}
          <p id="accessibilite-status" className="text-lg font-semibold text-slate-900">
            Accessibilité : non conforme — aucun audit de conformité n’a encore été réalisé.
          </p>
          <p className="mt-3 leading-7 text-slate-700">
            Aucun audit complet de conformité au RGAA n’a été réalisé ni programmé à ce jour : seuls des contrôles automatisés et des vérifications
            techniques sont faits pendant le développement. Aucun taux de conformité n’est donc publié. Cette page décrit l’état connu du service
            sans revendiquer une conformité qui n’a pas été auditée.
          </p>
        </header>

        <div className="space-y-10 text-slate-800">
          <section aria-labelledby="engagement-title">
            <h2 id="engagement-title" className="text-2xl font-bold text-slate-950">
              Engagement d’AccesDirectAide
            </h2>
            <p className="mt-3 leading-7">
              AccesDirectAide vise un service utilisable par le plus grand nombre, notamment
              avec un clavier, un lecteur d’écran, un fort niveau de zoom et des contenus
              simplifiés lorsque cela est nécessaire.
            </p>
            <p className="mt-3 leading-7">
              Le référentiel de travail retenu est le RGAA 4.1.2, en cohérence avec les
              critères WCAG 2.1 de niveau A et AA couverts par ce référentiel.
            </p>
          </section>

          <section aria-labelledby="conformite-title">
            <h2 id="conformite-title" className="text-2xl font-bold text-slate-950">
              État de conformité
            </h2>
            <p className="mt-3 leading-7">
              AccesDirectAide est déclaré <strong>non conforme</strong> tant qu’un audit
              d’accessibilité complet et en cours de validité n’a pas permis de mesurer la
              conformité du service.
            </p>
          </section>

          <section aria-labelledby="tests-title">
            <h2 id="tests-title" className="text-2xl font-bold text-slate-950">
              Contrôles faits pendant le développement
            </h2>
            <p className="mt-3 leading-7">
              Des contrôles automatisés et des vérifications techniques sont intégrés au
              développement. Ils ne remplacent pas un audit RGAA complet ni les vérifications
              humaines nécessaires, notamment au clavier et avec les technologies
              d’assistance.
            </p>
            <p className="mt-3 leading-7">
              Les résultats détaillés, les éventuelles non-conformités, les dérogations et
              l’échantillon audité seront publiés après réalisation d’un audit formel.
            </p>
          </section>

          <section aria-labelledby="technologies-title">
            <h2 id="technologies-title" className="text-2xl font-bold text-slate-950">
              Technologies utilisées
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>HTML sémantique</li>
              <li>CSS</li>
              <li>JavaScript</li>
              <li>React</li>
            </ul>
          </section>

          <section aria-labelledby="falc-title">
            <h2 id="falc-title" className="text-2xl font-bold text-slate-950">
              Facile à lire et à comprendre (FALC)
            </h2>
            <p className="mt-3 leading-7">
              Les aides destinées au lancement disposent de contenus simplifiés dédiés. Le
              FALC complète les informations de référence : il ne remplace ni la source
              officielle ni les conditions juridiques applicables.
            </p>
          </section>

          <section aria-labelledby="contact-title">
            <h2 id="contact-title" className="text-2xl font-bold text-slate-950">
              Retour d’information et contact
            </h2>
            <p className="mt-3 leading-7">
              Si vous ne parvenez pas à accéder à un contenu ou à utiliser une fonctionnalité,
              vous pouvez signaler le problème afin qu’une solution accessible ou une
              information équivalente puisse être recherchée.
            </p>
            <p className="mt-3">
              Courriel :{' '}
              <a className={linkClass} href="mailto:contact@accesdirectaide.fr">
                contact@accesdirectaide.fr
              </a>
            </p>
          </section>

          <section aria-labelledby="recours-title">
            <h2 id="recours-title" className="text-2xl font-bold text-slate-950">
              Voies de recours
            </h2>
            <p className="mt-3 leading-7">
              Si vous constatez un défaut d’accessibilité qui vous empêche d’accéder à un
              contenu ou à une fonctionnalité, que vous nous le signalez et que vous
              n’obtenez pas de réponse satisfaisante, vous pouvez saisir le Défenseur des
              droits.
            </p>
            <p className="mt-3">
              <a
                className={linkClass}
                href="https://formulaire.defenseurdesdroits.fr/"
              >
                Saisir le Défenseur des droits
              </a>
            </p>
          </section>

          <section aria-labelledby="amelioration-title">
            <h2 id="amelioration-title" className="text-2xl font-bold text-slate-950">
              Amélioration continue
            </h2>
            <p className="mt-3 leading-7">
              Le schéma pluriannuel et le plan d’actions d’accessibilité seront publiés avec
              des engagements vérifiables dès que leur périmètre aura été formalisé. Cette
              page sera mise à jour après l’audit et à chaque évolution significative.
            </p>
          </section>

          <p className="border-t border-slate-200 pt-6 text-sm text-slate-600">
            Déclaration mise à jour le 19 septembre 2026.
          </p>
        </div>
      </article>
    </>
  );
}
