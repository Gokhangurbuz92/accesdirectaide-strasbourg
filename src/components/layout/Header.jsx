import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Menu, X, Brain } from "lucide-react";
import ADALogo from "@/components/Brand/ADALogo";
import brand from "@/lib/brand-config";
import { useFalc } from "@/contexts/FalcContext";
import { AuthHeaderActions, AuthMobileActions } from "@/components/auth/AuthHeaderActions";

const NAV_ITEMS = [
  { label: "Accueil", to: "/" },
  { label: "Mon Assistant", to: "/orientation" },
  { label: "Simulateur", to: "/diagnostic" },
  { label: "Les Aides", to: "/aides" },
  { label: "Démarches", to: "/demarches" },
  { label: "Lieux d'accueil", to: "/annuaire" },
];

/**
 * @param {boolean} isActive
 */
function navClassName(isActive) {
  return `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive
    ? "bg-slate-100 text-slate-900"
    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
    }`;
}

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isFalcEnabled, toggleFalc } = useFalc();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white"
      >
        Aller au contenu
      </a>

      {/* Government banner */}
      {brand.features.showGouvBanner && (
        <div
          className="w-full text-center py-1 text-[10px] font-semibold tracking-wider uppercase"
          style={{ backgroundColor: brand.banner.bgColor, color: brand.banner.textColor }}
        >
          {brand.banner.text}
        </div>
      )}

      <header className="fixed top-0 z-50 w-full border-b border-slate-200 bg-white shadow-sm" style={{ top: brand.features.showGouvBanner ? '24px' : 0 }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <NavLink
              to="/"
              className="flex items-center gap-2 rounded-lg flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              onClick={() => setMobileOpen(false)}
              aria-label="Aller à l'accueil"
            >
              <img src={brand.logo} alt={`Logo ${brand.name}`} className="h-8 w-8 flex-shrink-0" />
              <span className="hidden sm:block text-sm font-bold text-slate-900">{brand.name}</span>
              {brand.features.showInstitutionBadge && (
                <span className="hidden md:inline-flex ml-2 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full" style={{ backgroundColor: brand.colors.primaryLight, color: brand.colors.primary }}>
                  {brand.institutionShort}
                </span>
              )}
            </NavLink>

            <nav className="hidden items-center gap-1 lg:flex" aria-label="Navigation principale">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => navClassName(isActive)}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            {/* Auth action links + FALC toggle — desktop */}
            <div className="hidden items-center gap-2 lg:flex">
              <button
                type="button"
                onClick={toggleFalc}
                className={`rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${isFalcEnabled
                    ? 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}
                aria-label={isFalcEnabled ? 'Désactiver le mode lecture simplifiée (FALC)' : 'Activer le mode lecture simplifiée (FALC)'}
                aria-pressed={isFalcEnabled}
                title="Mode lecture simplifiée (FALC)"
              >
                <Brain className="h-5 w-5" aria-hidden="true" />
              </button>
              <AuthHeaderActions />
            </div>

            <button
              type="button"
              className="rounded-lg p-2 text-slate-700 transition hover:bg-slate-100 lg:hidden"
              aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="border-t border-slate-200 bg-white lg:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 sm:px-6" aria-label="Navigation mobile">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => navClassName(isActive)}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}

              {/* Auth + FALC section — mobile */}
              <hr className="my-2 border-slate-200" />
              <button
                type="button"
                onClick={() => { toggleFalc(); setMobileOpen(false); }}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors flex items-center gap-2 ${isFalcEnabled
                    ? 'bg-teal-100 text-teal-700'
                    : 'text-slate-600 hover:bg-slate-50'
                  }`}
                aria-label={isFalcEnabled ? 'Désactiver le mode FALC' : 'Activer le mode FALC'}
                aria-pressed={isFalcEnabled}
              >
                <Brain className="h-4 w-4" aria-hidden="true" />
                {isFalcEnabled ? 'Mode simplifié ✓' : 'Lecture simplifiée'}
              </button>
              <hr className="my-2 border-slate-200" />
              <AuthMobileActions onNavigate={() => setMobileOpen(false)} />
            </nav>
          </div>
        )}
      </header>

      {/* Spacer pour compenser le header fixed + banner */}
      <div className={brand.features.showGouvBanner ? 'h-[104px]' : 'h-20'} aria-hidden="true" />
    </>
  );
}
