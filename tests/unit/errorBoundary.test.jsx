import { describe, it, expect, vi } from 'vitest';
import React from 'react';

// Mock all @/ dependencies used by ErrorBoundary.jsx
vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));
vi.mock('@/observability/sentryRef', () => ({
  sentryRef: { current: null },
}));
vi.mock('@/components/ui/button', () => ({
  Button: (props) => React.createElement('button', props, props.children),
}));
vi.mock('@/components/ui/card', () => ({
  Card: (props) => React.createElement('div', props, props.children),
  CardContent: (props) => React.createElement('div', props, props.children),
}));
vi.mock('@/config/env', () => ({
  frontendEnv: { VITE_APP_ENV: 'test' },
}));

import ErrorBoundary from '../../src/components/ErrorBoundary.jsx';

describe('ErrorBoundary', () => {
  it('should be a React component', () => {
    expect(ErrorBoundary).toBeDefined();
    expect(typeof ErrorBoundary).toBe('function');
  });

  it('should have getDerivedStateFromError static method', () => {
    expect(ErrorBoundary.getDerivedStateFromError).toBeDefined();
    expect(typeof ErrorBoundary.getDerivedStateFromError).toBe('function');
  });

  it('should return error state from getDerivedStateFromError', () => {
    const error = new Error('Test error');
    const state = ErrorBoundary.getDerivedStateFromError(error);
    
    expect(state).toEqual({
      hasError: true,
      error: error
    });
  });

  it('should have componentDidCatch method', () => {
    const instance = new ErrorBoundary({});
    expect(instance.componentDidCatch).toBeDefined();
    expect(typeof instance.componentDidCatch).toBe('function');
  });

  it('should have resetError method', () => {
    const instance = new ErrorBoundary({});
    expect(instance.resetError).toBeDefined();
    expect(typeof instance.resetError).toBe('function');
  });

  it('should call setState when resetError is called', () => {
    const instance = new ErrorBoundary({});
    instance.setState = vi.fn();
    
    instance.resetError();
    
    expect(instance.setState).toHaveBeenCalledWith({
      hasError: false,
      error: null
    });
  });
});
