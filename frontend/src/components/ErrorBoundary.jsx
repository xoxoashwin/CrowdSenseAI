import React from 'react';
import { AlertTriangle, RotateCcw, RefreshCw, ChevronDown, ChevronUp, Home } from 'lucide-react';

/**
 * CrowdSense AI - Robust React Error Boundary
 * Catches unhandled JavaScript runtime and rendering errors in any child component tree.
 * Prevents white-screen crashes and presents a styled recovery UI in the project's forest theme.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Safe console logging for development diagnostics
    console.error('ErrorBoundary caught an unhandled rendering error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  handleClearCacheAndReload = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('Could not clear storage:', e);
    }
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Fallback UI
      return (
        <div className="min-h-screen bg-[#AEC3B0] text-[#263B2B] flex items-center justify-center p-4 sm:p-6 antialiased">
          <div className="max-w-2xl w-full bg-[#F7FAF6] rounded-2xl p-6 sm:p-8 border border-[#D4E0D5] shadow-forest-card space-y-6 animate-in fade-in">
            {/* Header with Alert Icon */}
            <div className="flex items-start gap-4">
              <div className="p-3.5 rounded-2xl bg-[#FDEAE9] border border-[#F5B7B5] text-[#C2413E] shrink-0">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div className="flex-1">
                <h1 className="text-xl sm:text-2xl font-black text-[#263B2B] tracking-tight">
                  Application Encountered an Unexpected Issue
                </h1>
                <p className="text-sm text-[#506354] mt-1.5 leading-relaxed">
                  {this.props.fallbackMessage ||
                    'CrowdSense AI encountered an unexpected rendering error. Your data and SQLite database records remain safe.'}
                </p>
              </div>
            </div>

            {/* Error Message Box */}
            <div className="p-4 rounded-xl bg-[#EBEFEA] border border-[#D4E0D5] text-xs font-mono text-[#263B2B] break-words">
              <strong>Error:</strong> {this.state.error?.message || 'Unknown runtime error'}
            </div>

            {/* Expandable Technical Details */}
            <div>
              <button
                type="button"
                onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#37553A] hover:text-[#263B2B] transition"
              >
                {this.state.showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {this.state.showDetails ? 'Hide technical diagnostics' : 'Show technical diagnostics'}
              </button>

              {this.state.showDetails && (
                <div className="mt-3 p-3.5 rounded-xl bg-[#263B2B] text-[#AEC3B0] text-xs font-mono overflow-auto max-h-60 space-y-2 select-all">
                  <div>
                    <div className="text-emerald-400 font-semibold mb-1">Stack Trace:</div>
                    <pre className="whitespace-pre-wrap">{this.state.error?.stack || 'No stack trace available'}</pre>
                  </div>
                  {this.state.errorInfo?.componentStack && (
                    <div className="pt-2 border-t border-[#37553A]">
                      <div className="text-emerald-400 font-semibold mb-1">Component Stack:</div>
                      <pre className="whitespace-pre-wrap">{this.state.errorInfo.componentStack}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Recovery Action Buttons */}
            <div className="pt-4 border-t border-[#D4E0D5] flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#37553A] hover:bg-[#263B2B] text-white text-xs font-bold transition shadow-xs"
              >
                <RotateCcw className="w-4 h-4" />
                Retry View
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#DCE8DD] hover:bg-[#CADBCB] text-[#263B2B] text-xs font-bold transition"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Application
              </button>

              <button
                type="button"
                onClick={this.handleClearCacheAndReload}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#D4E0D5] hover:bg-[#EBEFEA] text-[#506354] text-xs font-medium transition ml-auto"
              >
                <Home className="w-4 h-4" />
                Reset & Return Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
