import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';

export default function AssistantFeatureSection() {
  return (
    <section
      className="relative isolate overflow-hidden py-16 text-white"
      style={{ background: 'linear-gradient(225deg, #020617 0%, #002D5A 30%, #1e3a8a 55%, #3730a3 80%, #4F46E5 100%)' }}
    >
      {/* Decorative orbs */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          className="absolute -top-20 -left-20 w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #818cf8 0%, transparent 70%)' }}
        />
      </div>

      {/* Top fade from white */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white to-transparent" aria-hidden="true" />

      <div className="relative z-10 mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="inline-flex rounded-full border border-indigo-300/30 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-200 backdrop-blur-sm">
            Exclusivité AccesDirect
          </p>
          <h2 className="mt-4 text-3xl font-bold drop-shadow-md">Ne cherchez plus, laissez-vous guider.</h2>
          <p className="mt-4 text-blue-100/80">
            Notre assistant vous pose quelques questions simples pour vous orienter vers les aides et démarches les plus pertinentes.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/orientation"
              className="rounded-xl px-5 py-3 text-sm font-bold text-white transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7c3aed 100%)' }}
            >
              Lancer le diagnostic
            </Link>
            <Link
              to="/orientation"
              className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/20 hover:border-white/40"
            >
              En savoir plus
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-white/15 bg-white/10 p-6 backdrop-blur-md shadow-2xl">
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-indigo-200">
            <Bot className="h-5 w-5" />
          </div>
          <div className="space-y-3 text-sm">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white/15 px-4 py-3 text-blue-50 backdrop-blur-sm">
              Bonjour, je peux vous aider à clarifier votre situation.
            </div>
            <div
              className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm px-4 py-3 text-white shadow-md"
              style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7c3aed 100%)' }}
            >
              Je cherche des aides pour le logement.
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white/15 px-4 py-3 text-blue-50 backdrop-blur-sm">
              Analyse en cours…
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
