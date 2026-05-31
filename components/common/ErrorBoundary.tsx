/**
 * AFS Advocates — Error Boundary
 *
 * Wraps each major engine/module. If one engine crashes, the rest of
 * the app remains functional. The error is shown in-place with a
 * reset button so the user can try again without reloading.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children:  ReactNode;
  name?:     string;   // Label shown in the error message
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error:    Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.name ?? 'unknown'}]`, error, info);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="error-boundary">
        <p style={{
          fontSize: 11, color: '#c4a030',
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '.14em', textTransform: 'uppercase',
          fontWeight: 700, marginBottom: 10,
        }}>
          ⚠ {this.props.name ?? 'Module'} Error
        </p>
        <p style={{
          fontSize: 14, color: '#c07070',
          fontFamily: 'Inter, sans-serif',
          lineHeight: 1.6, marginBottom: 14,
        }}>
          {this.state.error?.message ?? 'An unexpected error occurred.'}
        </p>
        <button
          onClick={this.reset}
          style={{
            background: 'transparent',
            border: '1px solid #4a1818',
            color: '#c07070',
            borderRadius: 4,
            padding: '7px 16px',
            fontSize: 11,
            fontFamily: 'Inter, sans-serif',
            cursor: 'pointer',
            letterSpacing: '.06em',
          }}
        >
          ⟳ Reset Module
        </button>
      </div>
    );
  }
}
