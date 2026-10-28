import React from 'react';

export function TokenSwatches() {
    return (
        <div className="p-8 space-y-8 bg-background text-foreground">
            <h1 className="text-2xl font-bold mb-6">Foundation / Tokens</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                {/* Background & Foreground */}
                <div className="p-6 rounded-xl border border-border bg-background text-foreground shadow-sm">
                    <h2 className="text-lg font-semibold mb-2">Background</h2>
                    <p className="text-sm">bg-background / text-foreground</p>
                </div>

                {/* Card */}
                <div className="p-6 rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                    <h2 className="text-lg font-semibold mb-2">Card</h2>
                    <p className="text-sm">bg-card / text-card-foreground</p>
                </div>

                {/* Primary */}
                <div className="p-6 rounded-xl border border-border bg-primary text-primary-foreground shadow-sm">
                    <h2 className="text-lg font-semibold mb-2">Primary</h2>
                    <p className="text-sm">bg-primary / text-primary-foreground</p>
                </div>

                {/* Secondary */}
                <div className="p-6 rounded-xl border border-border bg-secondary text-secondary-foreground shadow-sm">
                    <h2 className="text-lg font-semibold mb-2">Secondary</h2>
                    <p className="text-sm">bg-secondary / text-secondary-foreground</p>
                </div>

                {/* Muted */}
                <div className="p-6 rounded-xl border border-border bg-muted text-foreground shadow-sm">
                    <h2 className="text-lg font-semibold mb-2">Muted / Foreground</h2>
                    <p className="text-sm">bg-muted / text-foreground (a11y adjusted)</p>
                </div>

                {/* Border & Ring Examples */}
                <div className="p-6 rounded-xl border-4 border-border bg-background text-foreground shadow-sm">
                    <h2 className="text-lg font-semibold mb-2">Border Example</h2>
                    <p className="text-sm mb-4">border-border</p>

                    <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background">
                        Focus me (ring-ring)
                    </button>
                </div>

            </div>
        </div>
    );
}
