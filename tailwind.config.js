
// UI modernisation (24/11/2026): the palette reads CSS variables (src/design/palette.cjs, src/styles/theme-palette.css) — same values in light,
// a complete dark theme and a stronger high-contrast mode without changing the colour classes of the components.
const { paletteFor } = require('./src/design/palette.cjs');
const surfaceBg = { white: 'rgb(var(--cg-white) / <alpha-value>)' };

/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ["class"],
	content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
	theme: {
		extend: {
			fontFamily: {
				heading: ['Geist Sans', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
				body: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
				mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
				sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
			},
			// UI modernisation: one step larger small text (12 → 13 px, 14 → 15 px) — most secondary text of the account screens was 12–14 px
			fontSize: {
				xs: ['0.8125rem', { lineHeight: '1.25rem' }],
				sm: ['0.9375rem', { lineHeight: '1.4rem' }],
			},
			maxWidth: {
				// readable measure for running text (GOV.UK « two-thirds », ~70 characters)
				prose: '42rem',
			},
			backgroundColor: { ...paletteFor('g'), ...surfaceBg },
			gradientColorStops: { ...paletteFor('g'), ...surfaceBg },
			ringOffsetColor: { ...paletteFor('g'), ...surfaceBg },
			borderColor: paletteFor('b'),
			divideColor: paletteFor('b'),
			transitionTimingFunction: {
				apple: 'cubic-bezier(.2,.8,.2,1)',
			},
			transitionDuration: {
				'240': '240ms',
			},
			backgroundImage: {
				// the banner of the public pages (Démarches' navy → blue → indigo, owner's reference, 11/11/2026)
				'ada-hero': 'linear-gradient(135deg, #020617 0%, #002D5A 32%, #1e3a8a 62%, #3730a3 86%, #4F46E5 100%)',
				'ada-hero-glow': 'radial-gradient(circle, rgba(129,140,248,0.55) 0%, rgba(129,140,248,0) 70%)',
				'blueprint-grid': 'linear-gradient(to right, rgba(230,237,247,0.7) 1px, transparent 1px), linear-gradient(to bottom, rgba(230,237,247,0.7) 1px, transparent 1px)',
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			boxShadow: {
				subtle: '0 1px 2px rgba(11,58,106,.05)',
				float: '0 10px 30px -10px rgba(11,58,106,.10)',
				sm: 'var(--shadow-sm)',
				md: 'var(--shadow-md)',
				lg: 'var(--shadow-lg)',
				xl: 'var(--shadow-xl)',
			},
			colors: {
				...paletteFor('t'),
				// UI modernisation — semantic surfaces and text (src/styles/tokens.css: light, dark, high contrast)
				ada: {
					canvas: 'rgb(var(--ada-canvas) / <alpha-value>)',
					surface: 'rgb(var(--ada-surface) / <alpha-value>)',
					sunken: 'rgb(var(--ada-sunken) / <alpha-value>)',
					line: 'rgb(var(--ada-line) / <alpha-value>)',
					'line-strong': 'rgb(var(--ada-line-strong) / <alpha-value>)',
					ink: 'rgb(var(--ada-ink) / <alpha-value>)',
					'ink-2': 'rgb(var(--ada-ink-2) / <alpha-value>)',
					'ink-3': 'rgb(var(--ada-ink-3) / <alpha-value>)',
					action: 'rgb(var(--ada-action) / <alpha-value>)',
					'action-hover': 'rgb(var(--ada-action-hover) / <alpha-value>)',
					'action-soft': 'rgb(var(--ada-action-soft) / <alpha-value>)',
					link: 'rgb(var(--ada-link) / <alpha-value>)',
					accent: 'rgb(var(--ada-accent) / <alpha-value>)',
					danger: 'rgb(var(--ada-danger) / <alpha-value>)',
					'danger-soft': 'rgb(var(--ada-danger-soft) / <alpha-value>)',
				},
				// the classes text-text-body / text-text-muted / bg-surface were used by the header without any definition (no style at all)
				text: {
					body: 'rgb(var(--ada-ink) / <alpha-value>)',
					muted: 'rgb(var(--ada-ink-3) / <alpha-value>)',
				},
				surface: 'rgb(var(--ada-surface) / <alpha-value>)',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				chart: {
					'1': 'hsl(var(--chart-1))',
					'2': 'hsl(var(--chart-2))',
					'3': 'hsl(var(--chart-3))',
					'4': 'hsl(var(--chart-4))',
					'5': 'hsl(var(--chart-5))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				},

				// ✅ Core Brand tokens (from tokens.css)
				brand: {
					primary: 'rgb(var(--color-brand-primary) / <alpha-value>)',
					secondary: 'rgb(var(--color-brand-secondary) / <alpha-value>)',
					highlight: 'rgb(var(--color-brand-highlight) / <alpha-value>)',
					background: 'rgb(var(--color-brand-background) / <alpha-value>)',
				},

				// ✅ Blueprint Trust tokens (namespaced to avoid collisions)
				bt: {
					ink: 'rgb(var(--ada-ink) / <alpha-value>)',
					background: 'rgb(var(--ada-sunken) / <alpha-value>)',
					surface: 'rgb(var(--ada-surface) / <alpha-value>)',
					border: 'rgb(var(--ada-line) / <alpha-value>)',
					primary: 'rgb(var(--ada-action) / <alpha-value>)',
					primaryHover: 'rgb(var(--ada-action-hover) / <alpha-value>)',
					accent: 'rgb(var(--ada-focus) / <alpha-value>)',
					muted: 'rgb(var(--ada-ink-3) / <alpha-value>)',
					success: '#10B981',  // Emerald-500
					warning: '#F59E0B',  // Amber-500
					danger: '#EF4444',   // Red-500
				}
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out'
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
}
