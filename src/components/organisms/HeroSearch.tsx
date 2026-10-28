import type { FormEvent } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";

export interface HeroSearchProps {
    /** Main heading text */
    title?: string;
    /** Subtitle / secondary text */
    subtitle?: string;
    /** Placeholder for the search input */
    placeholder?: string;
}

export default function HeroSearch({
    title = "Trouvez une aide rapidement.",
    subtitle = "Aides, démarches, structures\u00a0— informations sourcées.",
    placeholder = "Logement, santé, handicap\u2026",
}: HeroSearchProps) {
    const navigate = useNavigate();
    const [query, setQuery] = useState("");

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmed = query.trim();
        if (trimmed) {
            navigate(`/aides?q=${encodeURIComponent(trimmed)}`);
        } else {
            navigate("/aides");
        }
    };

    return (
        <section
            className="relative isolate overflow-hidden py-20 sm:py-28 lg:py-32"
            style={{ background: 'linear-gradient(135deg, #020617 0%, #002D5A 25%, #1e3a8a 50%, #3730a3 75%, #4F46E5 100%)' }}
        >
            {/* Decorative orbs for depth */}
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <div
                    className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-20"
                    style={{ background: 'radial-gradient(circle, #818cf8 0%, transparent 70%)' }}
                />
                <div
                    className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full opacity-15"
                    style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }}
                />
                <div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full opacity-10"
                    style={{ background: 'radial-gradient(ellipse, #a5b4fc 0%, transparent 60%)' }}
                />
            </div>

            {/* Bottom fade to white */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white to-transparent" aria-hidden="true" />

            <div className="relative z-10 mx-auto max-w-3xl px-4 text-center sm:px-6">
                <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl drop-shadow-lg">
                    {title}
                </h1>

                <p className="mt-4 text-base text-blue-100/80 sm:text-lg">
                    {subtitle}
                </p>

                <form
                    onSubmit={handleSubmit}
                    className="mt-8 flex flex-col gap-3 sm:flex-row max-w-2xl mx-auto"
                    role="search"
                >
                    <div className="relative flex-1">
                        <label className="sr-only" htmlFor="hero-search">
                            Rechercher une aide
                        </label>
                        <Search
                            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                            aria-hidden="true"
                        />
                        <input
                            id="hero-search"
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={placeholder}
                            className="w-full rounded-xl border border-white/20 bg-white/95 py-3.5 pl-11 pr-4 text-slate-900 placeholder:text-slate-400 outline-none transition shadow-lg backdrop-blur-sm focus:border-white/40 focus:ring-2 focus:ring-white/30 focus:bg-white"
                        />
                    </div>
                    <button
                        type="submit"
                        className="inline-flex items-center justify-center rounded-xl px-6 py-3.5 text-sm font-bold text-white transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2"
                        style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7c3aed 100%)' }}
                    >
                        Rechercher
                    </button>
                </form>
            </div>
        </section>
    );
}
