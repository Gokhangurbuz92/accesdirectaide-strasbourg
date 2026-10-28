/**
 * Skip to Content Link
 * Accessibility feature for keyboard navigation
 * Allows users to skip navigation and jump directly to main content
 */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="skip-to-content"
      style={{
        position: 'absolute',
        left: '-9999px',
        zIndex: 9999,
        padding: '1rem 1.5rem',
        backgroundColor: 'hsl(var(--foreground))',
        color: 'hsl(var(--background))',
        textDecoration: 'none',
        borderRadius: '0 0 4px 0',
        fontWeight: 'bold',
        fontSize: '1rem',
        transition: 'left 0.2s',
      }}
      onFocus={(e) => {
        e.target.style.left = '0';
      }}
      onBlur={(e) => {
        e.target.style.left = '-9999px';
      }}
    >
      Aller au contenu principal
    </a>
  );
}
