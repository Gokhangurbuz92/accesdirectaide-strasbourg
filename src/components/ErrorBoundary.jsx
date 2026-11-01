// @ts-nocheck
import React from 'react';
import { sentryRef } from '@/observability/sentryRef';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { frontendEnv } from '@/config/env';
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';

/**
 * ErrorBoundary Fallback Component
 * 
 * User-friendly error display with recovery options.
 * Does not expose technical details to end users.
 */
// @ts-ignore
function ErrorFallback({ error, resetError }) {
  const { t } = useT('layout');
  const isDevelopment = frontendEnv.runtime.isDev;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full">
        <CardContent className="p-8">
          <div className="flex flex-col items-center text-center">
            {/* Icon */}
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold text-slate-900 mb-3">
              {t('layout:crash.title', 'Une erreur est survenue')}
            </h1>

            {/* Description */}
            <p className="text-slate-600 mb-6 max-w-md">
              {t('layout:crash.text', "Nous sommes désolés, une erreur inattendue s'est produite. Rechargez la page ou revenez à l'accueil ; si l'erreur se répète, signalez-la depuis la page Contact.")}
            </p>

            {/* Development-only error details (for developers: not translated) */}
            {isDevelopment && error && (
              <div className="w-full mb-6 p-4 bg-slate-100 rounded-lg text-start">
                <p className="text-xs font-mono text-slate-700 mb-2">
                  <strong>Erreur (dev only):</strong>
                </p>
                <p className="text-xs font-mono text-red-600 break-all">
                  {error.message}
                </p>
                {error.stack && (
                  <details className="mt-2">
                    <summary className="text-xs text-slate-600 cursor-pointer hover:text-slate-900">
                      Stack trace
                    </summary>
                    <pre className="text-xs text-slate-600 mt-2 overflow-auto max-h-40">
                      {error.stack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Button
                onClick={resetError}
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                {t('layout:retry', 'Réessayer')}
              </Button>
              <Button
                variant="outline"
                onClick={() => window.location.href = '/'}
                className="flex items-center gap-2"
              >
                <Home className="w-4 h-4" />
                {t('layout:backHome', "Retour à l'accueil")}
              </Button>
            </div>

            {/* Support info */}
            <p className="text-sm text-slate-500 mt-6">
              <Trans
                i18n={i18n}
                i18nKey="layout:crash.support"
                defaults="Si le problème persiste, contactez-nous à <0>support@accesdirectaide.fr</0>"
                components={[<a key="support" href="mailto:support@accesdirectaide.fr" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">support@accesdirectaide.fr</a>]}
              />
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * ErrorBoundary Component
 * 
 * Wraps the application to catch React errors and display a fallback UI.
 * Integrates with Sentry for error tracking.
 * 
 * Usage:
 * <ErrorBoundary>
 *   <App />
 * </ErrorBoundary>
 */
class ErrorBoundary extends React.Component {
  constructor(/** @type {string | number | boolean | null | undefined} */ props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(/** @type {string | number | boolean | null | undefined} */ error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(/** @type {unknown} */ error, /** @type {Record<string, string | number | boolean | null | undefined>} */ errorInfo) {
    // Log error to Sentry if loaded
    const Sentry = sentryRef.current;
    if (Sentry && Sentry.captureException) {
      Sentry.captureException(error, {
        contexts: {
          react: {
            componentStack: errorInfo.componentStack,
          },
        },
      });
    }

    // Log to console in development
    if (frontendEnv.runtime.isDev) {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }
  }

  resetError = () => {
    // R8: a page whose code could not be downloaded stays failed in memory (React keeps the rejected import): only a reload fetches it again
    const m = String(this.state.error?.message || '');
    if (/dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch|error loading dynamically/i.test(m) && typeof window !== 'undefined') { window.location.reload(); return; }
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback 
          error={this.state.error} 
          resetError={this.resetError}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
