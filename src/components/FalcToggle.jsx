// @ts-nocheck
import { falcLabel } from '@/lib/falcLabel';
import { useFalc } from '@/contexts/FalcContext';

/**
 * FALC Toggle Component
 * Accessible toggle for switching between normal and FALC (easy-to-read) content
 * Features:
 * - Keyboard navigation (Space/Enter to toggle)
 * - ARIA attributes for screen readers
 * - persistence through the site-wide FALC mode (FalcContext, key « falc-mode »)
 * - Disabled state when FALC unavailable
 */
// @ts-ignore
export default function FalcToggle({ hasFalcContent, onChange, className = '', review = null }) {
  // PKG-11 / Q10: ONE source of truth — the site-wide FALC mode (FalcContext) that the detail pages read. Before, this switch kept its own state and the
  // pages passed an empty onChange: clicking it changed the switch, never the text shown.
  const { isFalcEnabled, toggleFalc } = useFalc();
  const isFalcMode = Boolean(hasFalcContent && isFalcEnabled);

  const handleToggle = () => {
    if (!hasFalcContent) return;
    toggleFalc();
    onChange?.(!isFalcMode);
  };

  const handleKeyDown = (/** @type {{ key: string; preventDefault: () => void; }} */ e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <div className={`falc-toggle-container ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={isFalcMode}
        aria-label={hasFalcContent ? "Activer la version facile à lire (FALC)" : "Version facile à lire non disponible"}
        disabled={!hasFalcContent}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className={`falc-toggle ${isFalcMode ? 'active' : ''} ${!hasFalcContent ? 'disabled' : ''}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 1rem',
          border: '2px solid',
          borderColor: hasFalcContent ? (isFalcMode ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))') : 'hsl(var(--border))',
          borderRadius: '0.5rem',
          backgroundColor: isFalcMode ? 'hsl(var(--primary)/20)' : 'hsl(var(--background))',
          cursor: hasFalcContent ? 'pointer' : 'not-allowed',
          opacity: hasFalcContent ? 1 : 0.6,
          transition: 'all 0.2s ease',
          fontSize: '1rem',
          fontWeight: '500',
        }}
      >
        <span
          className="toggle-icon"
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '2.5rem',
            height: '1.5rem',
            position: 'relative',
            backgroundColor: isFalcMode ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
            borderRadius: '1rem',
            transition: 'background-color 0.2s ease',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: '0.125rem',
              left: isFalcMode ? '1.125rem' : '0.125rem',
              width: '1.25rem',
              height: '1.25rem',
              backgroundColor: 'hsl(var(--background))',
              borderRadius: '50%',
              transition: 'left 0.2s ease',
            }}
          />
        </span>
        <span className="toggle-label">
          {falcLabel(hasFalcContent, review)}
        </span>
      </button>
      {!hasFalcContent && (
        <p
          className="falc-unavailable-message"
          style={{
            marginTop: '0.5rem',
            fontSize: '0.875rem',
            color: 'hsl(var(--muted-foreground))',
            fontStyle: 'italic'
          }}
        >
          La version facile à lire n'est pas encore disponible pour ce contenu.
        </p>
      )}
    </div>
  );
}
