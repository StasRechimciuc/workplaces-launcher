import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort safety net for the whole app — without this, ANY
 * uncaught exception during render anywhere in the tree (a bad row's
 * fields component, a bug in a brand-new tool type, anything) takes
 * down React entirely, leaving a blank/black window with nothing to
 * recover from short of force-quitting. React error boundaries must be
 * class components — there is no hook equivalent (as of React 18/19).
 *
 * Deliberately a single, top-level boundary, not one per row/modal —
 * the goal here is "the app can never go fully black again," not a
 * fully recoverable per-row UX. A real fix for whatever actually threw
 * should still happen; this is the floor under it, not a substitute.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Still fails loudly in the console — this boundary only stops the
    // crash from reaching a black screen, it doesn't hide the error.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-bg p-8 text-center">
        <p className="text-[14px] font-medium text-text">Something went wrong.</p>
        <p className="max-w-md text-[12.5px] text-text-muted">{this.state.error.message}</p>
        <button
          type="button"
          className="mt-2 flex h-8.5 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
