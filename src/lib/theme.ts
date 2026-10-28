export type Theme = "dark" | "light" | "system"

const THEME_STORAGE_KEY = "ada-theme"

/**
 * Gets the initially stored theme or the system preference
 */
export function getInitialTheme(): Theme {
    if (typeof window === "undefined") return "system"

    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null
    if (storedTheme) {
        return storedTheme
    }

    return "system"
}

/**
 * Applies the theme to the document element
 */
export function applyTheme(theme: Theme) {
    if (typeof window === "undefined") return

    const root = window.document.documentElement
    root.classList.remove("light", "dark")

    if (theme === "system") {
        const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
        root.classList.add(systemTheme)
        return
    }

    root.classList.add(theme)
}

declare global {
    interface Window {
        __ADA_SET_THEME__?: (theme: Theme) => void
        __ADA_TOGGLE_THEME__?: () => void
    }
}

/**
 * Custom temporary dev functions exposed to window
 * As requested in P0-03: No UI toggle component
 */
export function initDevToggleTemp(
    currentTheme: Theme,
    setThemeCallback: (theme: Theme) => void
) {
    if (typeof window === "undefined") return

    window.__ADA_SET_THEME__ = (newTheme: Theme) => {
        setThemeCallback(newTheme)
        localStorage.setItem(THEME_STORAGE_KEY, newTheme)
        applyTheme(newTheme)
        console.log(`[Theme] Set to ${newTheme}`)
    }

    window.__ADA_TOGGLE_THEME__ = () => {
        // We get real computed state, not just stored state
        const isDark = window.document.documentElement.classList.contains("dark")
        const newTheme = isDark ? "light" : "dark"

        window.__ADA_SET_THEME__?.(newTheme)
    }

    // Set initial 
    applyTheme(currentTheme)
}
